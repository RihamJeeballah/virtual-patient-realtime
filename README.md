# Virtual Patient — Realtime (FastAPI + OpenAI Realtime API)

This is a production-ready scaffold to migrate your Streamlit prototype to a real-time,
low-latency voice conversation app using the OpenAI Realtime API (WebRTC).

## Features
- FastAPI backend with endpoints:
  - `GET /api/cases` → list cases from `/cases`
  - `POST /api/session` → creates a short-lived OpenAI Realtime session with patient-specific instructions
- Static frontend (HTML/JS/CSS) served from `/app`
- WebRTC client connects browser mic → OpenAI Realtime → streams audio reply back
- Case content is injected into the model's `instructions` for patient role-play

## Quickstart

1) Create `.env` in `backend/` (or copy `.env.example`):
```env
OPENAI_API_KEY=sk-...
ALLOWED_ORIGINS=http://localhost:8000
MODEL_REALTIME=gpt-4o-realtime-preview-2024-10-01
DEFAULT_TTS_VOICE=verse
```

2) Install and run the backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

3) Open the app:
- Browser → http://localhost:8000/app
- Select a case → Click **Connect** → grant microphone permission → talk naturally

## Deploying
- **Render/Railway/Fly.io**: deploy FastAPI; set env vars; ensure your custom domain uses HTTPS (required for mic).
- **CORS**: set `ALLOWED_ORIGINS` to your frontend origin(s).
- **Avatars**: place PNGs in `frontend/avatars/` and map them to case IDs in `frontend/app.js` if needed.

## Notes
- This setup uses **OpenAI Realtime** to collapse STT+LLM+TTS into one streaming model (near sub-second latency).
- The behavior mirrors your Streamlit app's patient persona and case structure.
- For compliance logging, add a DB (e.g., PostgreSQL) and store session events on your backend.
