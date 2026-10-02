"""HTTP API the LMS website will call, plus the chat UI.

Run:  uvicorn app.main:app --port 8000
GET  /           chat UI (React build in frontend/dist; build it with: cd frontend; npm run build)
POST /api/chat   {"message": "...", "history": [{"role": "user"|"assistant", "content": "..."}]}
                 → {"reply", "intent", "sources", "trace"}
GET  /api/index  what is indexed: courses, modules, PDFs, chunk counts, embedding model
GET  /health
"""
from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
from app import llm
from app.catalog import get_catalog
from app.chat import respond
from app.embeddings import get_embedder

UI_DIR = config.ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    cat = get_catalog()                  # fails fast if build/ is missing
    if cat.embedding_backend != get_embedder().name:
        raise RuntimeError(f"build/ was made with '{cat.embedding_backend}' embeddings but the app is "
                           f"configured for '{get_embedder().name}'. Re-run python ingest.py.")
    threading.Thread(target=llm.warm_up, daemon=True).start()   # don't block startup on a model load
    yield


app = FastAPI(title="LMS course chatbot", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS,
                   allow_methods=["POST", "GET"], allow_headers=["Content-Type"])


class Turn(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)
    history: list[Turn] = Field(default_factory=list, max_length=20)


class ChatOut(BaseModel):
    reply: str
    intent: str
    sources: list[dict]
    trace: dict


_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(ip: str) -> None:
    now, window = time.monotonic(), _hits[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= config.RATE_LIMIT_PER_MINUTE:
        raise HTTPException(429, "Too many questions in a minute. Please wait a moment.")
    window.append(now)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "courses": len(get_catalog().courses())}


@app.get("/api/index")
def index_info() -> dict:
    return {**get_catalog().index_info(), "bot_name": config.BOT_NAME,
            "llm_model": config.LLM_MODEL, "top_k": config.TOP_K,
            "min_vector_score": config.MIN_VECTOR_SCORE, "strong_vector_score": config.STRONG_VECTOR_SCORE}


@app.post("/api/chat", response_model=ChatOut)
async def chat(body: ChatIn, request: Request) -> ChatOut:
    _rate_limit(request.client.host if request.client else "unknown")
    # The answer is worked out in a thread. If the browser goes away (the learner pressed Stop),
    # `cancel` tells the LLM call to close its stream so the model stops right away.
    cancel = threading.Event()
    task = asyncio.ensure_future(asyncio.to_thread(
        respond, body.message, [t.model_dump() for t in body.history], cancel))
    while not task.done():
        await asyncio.wait({task}, timeout=0.5)
        if not task.done() and not cancel.is_set() and await request.is_disconnected():
            cancel.set()
    r = task.result()
    return ChatOut(reply=r.text, intent=r.intent, sources=r.sources, trace=r.trace)


# The UI is mounted last so the API routes above always win.
if (UI_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=UI_DIR, html=True), name="ui")
else:
    @app.get("/", include_in_schema=False)
    def ui_missing() -> HTMLResponse:
        return HTMLResponse("<p>The chat UI isn't built yet. Run <code>cd frontend; npm install; "
                            "npm run build</code>, then restart the server. The API is at /api/chat.</p>")
