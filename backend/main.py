import os
import re
import json
import base64
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

# Correct import (VERY IMPORTANT FOR RAILWAY)
from backend.instructions import build_patient_instructions

# ---------------------------------------------------------------
# Environment + Paths
# ---------------------------------------------------------------
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
CASES_DIR = BASE_DIR / "cases"
FRONTEND_DIR = BASE_DIR / "frontend"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("ERROR: OPENAI_API_KEY not set in Railway Variables.")

client = OpenAI(api_key=OPENAI_API_KEY)

MODEL_REALTIME = os.getenv("MODEL_REALTIME", "gpt-4o-realtime-preview-2024-10-01")
MODEL_CHAT = os.getenv("MODEL_CHAT", "gpt-4o")
MODEL_TTS = os.getenv("MODEL_TTS", "gpt-4o-mini-tts")
DEFAULT_TTS_VOICE = os.getenv("DEFAULT_TTS_VOICE", "verse")

# ---------------------------------------------------------------
# FastAPI App + CORS
# ---------------------------------------------------------------
app = FastAPI(title="Virtual Patient (Realtime)")

allow_origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------
# Serve static frontend
# ---------------------------------------------------------------
app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="app")
app.mount("/app/avatars", StaticFiles(directory=str(FRONTEND_DIR / "avatars")), name="avatars")


@app.get("/app/avatars.json")
def get_avatar_map():
    avatars_path = FRONTEND_DIR / "avatars.json"
    if not avatars_path.exists():
        raise HTTPException(404, "avatars.json not found")
    with open(avatars_path, "r", encoding="utf-8") as f:
        return json.load(f)

# ---------------------------------------------------------------
# Case parsing utilities
# ---------------------------------------------------------------
def parse_case_md(md_text: str) -> Dict[str, str]:
    sections = re.split(r"^##\s+", md_text, flags=re.MULTILINE)
    case: Dict[str, Any] = {"title": sections[0].strip("# \n")}
    for sec in sections[1:]:
        parts = sec.split("\n", 1)
        header = parts[0].strip()
        body = parts[1].strip() if len(parts) > 1 else ""
        case[header] = body
    return case


def load_all_cases():
    cases = {}
    for p in sorted(CASES_DIR.glob("*.md")):
        with p.open("r", encoding="utf-8") as f:
            case = parse_case_md(f.read())
        cases[p.stem] = case
    return cases


CASE_CACHE = load_all_cases()

# ---------------------------------------------------------------
# Models
# ---------------------------------------------------------------
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


# ---------------------------------------------------------------
# Routes
# ---------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def root():
    return HTMLResponse('<meta http-equiv="refresh" content="0; url=/app/index.html" />')


@app.get("/api/cases")
def list_cases():
    return [{"id": cid, "title": c["title"]} for cid, c in CASE_CACHE.items()]


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = CASE_CACHE.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    return case


# ---------------------------------------------------------------
# Realtime session creation
# ---------------------------------------------------------------
@app.post("/api/session")
def create_realtime_session(req: SessionRequest):
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    instructions = build_patient_instructions(case, req.language)
    voice = req.voice or DEFAULT_TTS_VOICE

    try:
        resp = client.realtime.sessions.create(
            model=MODEL_REALTIME,
            voice=voice,
            modalities=["audio", "text"],
            instructions=instructions,
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to create session: {e}")

    return JSONResponse(resp.model_dump())


# ---------------------------------------------------------------
# Text reply (Chat + TTS)
# ---------------------------------------------------------------
@app.post("/api/text_reply")
def text_reply(req: TextReplyRequest):
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    lang_instruction = (
        "You must respond ONLY in English."
        if req.language == "English"
        else "يجب عليك الرد باللغة العربية فقط."
    )

    system_prompt = f"""
You are a real patient in a clinical encounter.
{lang_instruction}

Rules:
- First-person emotional patient
- Short answers (1–2 sentences)
- Reveal symptoms gradually
- Only answer from the case information
- No numbers unless asked

Case:
{json.dumps(case, ensure_ascii=False, indent=2)}
""".strip()

    messages = [{"role": "system", "content": system_prompt}]
    for turn in req.history[-20:]:
        messages.append({"role": turn.role, "content": turn.content})

    try:
        c = client.chat.completions.create(
            model=MODEL_CHAT,
            messages=messages,
            temperature=0.8,
            max_tokens=250,
        )
        reply = c.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(500, f"LLM error: {e}")

    voice = "alloy" if req.gender.lower() == "female" else "verse"

    try:
        audio = client.audio.speech.create(
            model=MODEL_TTS,
            voice=voice,
            input=reply,
        )
        audio_bytes = audio.read()
        audio_b64 = base64.b64encode(audio_bytes).decode()
    except:
        audio_b64 = None

    return {"reply": reply, "audio_b64": audio_b64}
