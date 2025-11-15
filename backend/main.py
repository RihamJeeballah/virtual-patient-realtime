import os, re, json, base64
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import openai
from openai import OpenAI

from instructions import build_patient_instructions

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
CASES_DIR = BASE_DIR / "cases"
FRONTEND_DIR = BASE_DIR / "frontend"

import os
from dotenv import load_dotenv

if not os.getenv("RAILWAY_ENVIRONMENT"):
    load_dotenv()

openai.api_key = os.getenv("OPENAI_API_KEY")

MODEL_REALTIME = os.getenv("MODEL_REALTIME", "gpt-4o-realtime-preview-2024-10-01")
DEFAULT_TTS_VOICE = os.getenv("DEFAULT_TTS_VOICE", "verse")
MODEL_CHAT = os.getenv("MODEL_CHAT", "gpt-4o")              # for text chat (keyboard)
MODEL_TTS = os.getenv("MODEL_TTS", "gpt-4o-mini-tts")       # for voice reply

# ⚠️ Keep legacy-style client for Realtime (already working for you)
openai.api_key = OPENAI_API_KEY
client = openai

# ✅ New typed client for chat + TTS
sdk = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="Virtual Patient (Realtime)")

# --- CORS ---
allowed = os.getenv("ALLOWED_ORIGINS", "")
allow_origins = [o.strip() for o in allowed.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Serve static frontend ---
app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="app")
app.mount("/app/avatars", StaticFiles(directory=str(FRONTEND_DIR / "avatars")), name="avatars")

# ✅ Explicitly serve avatars.json
@app.get("/app/avatars.json")
def get_avatar_map():
    avatars_path = FRONTEND_DIR / "avatars.json"
    if not avatars_path.exists():
        raise HTTPException(status_code=404, detail="avatars.json not found")
    with open(avatars_path, "r", encoding="utf-8") as f:
        return json.load(f)


# --- Case loader utilities ---
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

class SessionRequest(BaseModel):
    case_id: str
    language: str = "English"
    voice: Optional[str] = None  # "verse" | "alloy" etc.

class ChatTurn(BaseModel):
    role: str
    content: str

class TextReplyRequest(BaseModel):
    case_id: str
    language: str = "English"                # "English" | "Arabic"
    gender: Optional[str] = "male"           # "male" | "female"
    history: List[ChatTurn]                  # [{role:"user"/"assistant", content:"..."}]

@app.get("/", response_class=HTMLResponse)
def root():
    return HTMLResponse('<meta http-equiv="refresh" content="0; url=/app/index.html" />')

@app.get("/api/cases")
def list_cases():
    return [{"id": cid, "title": c.get("title", cid.replace("_", " ").title())}
            for cid, c in CASE_CACHE.items()]

@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = CASE_CACHE.get(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    return case

@app.post("/api/session")
def create_realtime_session(req: SessionRequest):
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, detail="Case not found")

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
        raise HTTPException(500, detail=f"Failed to create session: {e}")

    return JSONResponse(resp.model_dump())

@app.post("/api/text_reply")
def text_reply(req: TextReplyRequest):
    # Build system prompt close to your Streamlit logic
    case = CASE_CACHE.get(req.case_id)
    if not case:
        raise HTTPException(404, "Case not found")

    lang_instruction = (
        "You must always reply in English only."
        if req.language == "English"
        else "يجب عليك دائمًا الرد باللغة العربية فقط."
    )

    system_prompt = f"""
You are role-playing a real patient during a clinical encounter.
{lang_instruction}
Follow these rules:
- First-person, natural lay language.
- Reveal information gradually (1–2 sentences).
- Use uncertainty when appropriate.
- Do not give numbers or clinical metrics unless explicitly asked.
- Base responses only on this case:
{json.dumps(case, ensure_ascii=False, indent=2)}
    """.strip()

    messages = [{"role": "system", "content": system_prompt}]
    for turn in req.history[-20:]:
        messages.append({"role": turn.role, "content": turn.content})

    # Chat completion
    try:
        c = sdk.chat.completions.create(
            model=MODEL_CHAT,
            messages=messages,
            temperature=0.8,
            max_tokens=300
        )
        reply = c.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(500, detail=f"LLM error: {e}")

    # TTS voice selection (close to Streamlit choices)
    voice = "alloy" if (req.gender or "").lower() == "female" else "verse"

    try:
        audio = sdk.audio.speech.create(
            model=MODEL_TTS,
            voice=voice,
            input=reply
        )
        audio_bytes = audio.read()  # bytes
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    except Exception as e:
        # If TTS fails, still return text
        audio_b64 = None

    return {"reply": reply, "audio_b64": audio_b64}
