import os
import re
import json
import base64
from io import BytesIO
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

import httpx
from openai import OpenAI

# ---------------------------------------------------------
# Load environment
# ---------------------------------------------------------
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
CASES_DIR = BASE_DIR / "cases"
FRONTEND_DIR = BASE_DIR / "frontend"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("ERROR: OPENAI_API_KEY not set in Railway variables.")

# ---------------------------------------------------------
# Remove ALL proxy variables (Railway injects them)
# ---------------------------------------------------------
for proxy_var in [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "NO_PROXY", "no_proxy",
]:
    if proxy_var in os.environ:
        del os.environ[proxy_var]

# ---------------------------------------------------------
# Disable httpx trust in proxy environment variables
# ---------------------------------------------------------
http_client = httpx.Client(trust_env=False)

# ---------------------------------------------------------
# Import instructions builder
# ---------------------------------------------------------
from backend.instructions import build_patient_instructions

# ---------------------------------------------------------
# OpenAI Client
# ---------------------------------------------------------
client = OpenAI(
    api_key=OPENAI_API_KEY,
    http_client=http_client,  # <-- disables proxy loading
)

MODEL_REALTIME = os.getenv(
    "MODEL_REALTIME", "gpt-4o-realtime-preview-2024-10-01"
)
MODEL_CHAT = os.getenv("MODEL_CHAT", "gpt-4o")
MODEL_TTS = os.getenv("MODEL_TTS", "gpt-4o-mini-tts")
MODEL_TRANSCRIBE = os.getenv("MODEL_TRANSCRIBE", "gpt-4o-mini-transcribe")
DEFAULT_TTS_VOICE = os.getenv("DEFAULT_TTS_VOICE", "verse")

# ---------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------
app = FastAPI(title="Virtual Patient (Realtime)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Static file serving
# ---------------------------------------------------------
app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="app")
app.mount(
    "/app/avatars",
    StaticFiles(directory=str(FRONTEND_DIR / "avatars")),
    name="avatars",
)


@app.get("/app/avatars.json")
def get_avatar_map():
    avatars_path = FRONTEND_DIR / "avatars.json"
    if not avatars_path.exists():
        raise HTTPException(404, "avatars.json not found")
    with open(avatars_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------
# Case Processing Utilities
# ---------------------------------------------------------
def parse_case_md(md_text: str) -> Dict[str, str]:
    sections = re.split(r"^##\s+", md_text, flags=re.MULTILINE)
    case = {"title": sections[0].strip("# \n")}
    for sec in sections[1:]:
        parts = sec.split("\n", 1)
        header = parts[0].strip()
        body = parts[1].strip() if len(parts) > 1 else ""
        case[header] = body
    return case


def load_all_cases():
    cases: Dict[str, Dict[str, Any]] = {}
    for p in sorted(CASES_DIR.glob("*.md")):
        with p.open("r", encoding="utf-8") as f:
            case = parse_case_md(f.read())
        cases[p.stem] = case
    return cases


CASE_CACHE = load_all_cases()

# ---------------------------------------------------------
# API Models
# ---------------------------------------------------------
class SessionRequest(BaseModel):
    case_id: str
    language: str = "English"
    voice: Optional[str] = None


class ChatTurn(BaseModel):
    role: str
    content: str


class TextReplyRequest(BaseModel):
    case_id: str
    language: str = "English"
    gender: Optional[str] = "male"
    history: List[ChatTurn]


# ---------------------------------------------------------
# Routes
# ---------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def root():
    return HTMLResponse(
        '<meta http-equiv="refresh" content="0; url=/app/index.html" />'
    )


@app.get("/api/cases")
def list_cases():
    return [
        {"id": cid, "title": c.get("title", cid.replace("_", " ").title())}
        for cid, c in CASE_CACHE.items()
    ]


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = CASE_CACHE.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    return case


# ---------------------------------------------------------
# Create realtime session (for future use)
# ---------------------------------------------------------
@app.post("/api/session")
def create_session(req: SessionRequest):
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    instructions = build_patient_instructions(case, req.language)
    voice = req.voice or DEFAULT_TTS_VOICE

    try:
        resp = client.realtime.sessions.create(
            model=MODEL_REALTIME,
            modalities=["audio", "text"],
            voice=voice,
            instructions=instructions,
        )
        return JSONResponse(resp.model_dump())

    except Exception as e:
        raise HTTPException(500, f"Failed to create session: {e}")


# ---------------------------------------------------------
# Generate text + TTS audio  (already working)
# ---------------------------------------------------------
@app.post("/api/text_reply")
def text_reply(req: TextReplyRequest):
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    lang_rule = (
        "You must respond ONLY in English."
        if req.language == "English"
        else "يجب عليك الرد باللغة العربية فقط."
    )

    system_prompt = f"""
You are a real patient in a medical encounter.
{lang_rule}

Rules:
- Always respond as the patient
- Short replies (1–2 sentences)
- Emotional but realistic
- Reveal symptoms gradually
- Never reveal diagnosis
- Use only information from the case

Case:
{json.dumps(case, ensure_ascii=False, indent=2)}
""".strip()

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt}
    ]
    for turn in req.history[-20:]:
        messages.append({"role": turn.role, "content": turn.content})

    # Chat response
    try:
        chat = client.chat.completions.create(
            model=MODEL_CHAT,
            messages=messages,
            temperature=0.8,
            max_tokens=250,
        )
        reply_text = chat.choices[0].message.content.strip()

    except Exception as e:
        raise HTTPException(500, f"LLM error: {e}")

    # Choose TTS voice
    voice = "alloy" if (req.gender or "").lower() == "female" else "verse"

    # Generate audio
    try:
        audio = client.audio.speech.create(
            model=MODEL_TTS,
            voice=voice,
            input=reply_text,
        )
        audio_bytes = audio.read()
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    except Exception:
        audio_b64 = None

    return {"reply": reply_text, "audio_b64": audio_b64}


# ---------------------------------------------------------
# NEW: Voice endpoint for push-to-talk mode
# ---------------------------------------------------------
@app.post("/api/voice_reply")
async def voice_reply(
    audio: UploadFile = File(...),
    case_id: str = Form(...),
    language: str = Form("English"),
    gender: Optional[str] = Form("male"),
    history: str = Form("[]"),
):
    """
    Accepts microphone audio, transcribes it, generates a reply, and returns
    both text + TTS audio. Signature matches the frontend FormData.
    """

    case = CASE_CACHE.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    # --- 1) Transcribe doctor audio ---
    try:
        raw_bytes = await audio.read()
        buf = BytesIO(raw_bytes)
        buf.name = audio.filename or "speech.webm"

        transcription = client.audio.transcriptions.create(
            model=MODEL_TRANSCRIBE,
            file=buf,
        )
        user_text = transcription.text.strip()

    except Exception as e:
        raise HTTPException(500, f"Transcription error: {e}")

    # --- 2) Rebuild history (from JSON string) ---
    try:
        history_list: List[Dict[str, str]] = json.loads(history) if history else []
    except Exception:
        history_list = []

    # Append the new doctor message obtained from speech
    history_list.append({"role": "user", "content": user_text})

    # --- 3) Build system prompt exactly like text_reply ---
    lang_rule = (
        "You must respond ONLY in English."
        if language == "English"
        else "يجب عليك الرد باللغة العربية فقط."
    )

    system_prompt = f"""
You are a real patient in a medical encounter.
{lang_rule}

Rules:
- Always respond as the patient
- Short replies (1–2 sentences)
- Emotional but realistic
- Reveal symptoms gradually
- Never reveal diagnosis
- Use only information from the case

Case:
{json.dumps(case, ensure_ascii=False, indent=2)}
""".strip()

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt}
    ]
    for t in history_list[-20:]:
        messages.append({"role": t["role"], "content": t["content"]})

    # --- 4) Ask Chat model ---
    try:
        chat = client.chat.completions.create(
            model=MODEL_CHAT,
            messages=messages,
            temperature=0.8,
            max_tokens=250,
        )
        reply_text = chat.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(500, f"LLM error: {e}")

    # --- 5) TTS for patient reply ---
    voice = "alloy" if (gender or "").lower() == "female" else "verse"
    try:
        audio_out = client.audio.speech.create(
            model=MODEL_TTS,
            voice=voice,
            input=reply_text,
        )
        audio_bytes = audio_out.read()
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    except Exception:
        audio_b64 = None

    return {
        "transcript": user_text,
        "reply": reply_text,
        "audio_b64": audio_b64,
    }
