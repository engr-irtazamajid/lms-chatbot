# LMS course chatbot

A course guide for the courses on **smartworking.training**. Learners ask what a course, module or
topic covers, how long it takes, or where a subject is taught. The bot answers from the module
PDFs: catalog facts come straight from a database, and "what is X about?" questions get a short,
grounded overview from a local LLM, with the course → module → topic to study.

It never reveals exercise or quiz questions or answers, and it never answers from general
knowledge. New courses are added by adding their PDFs and re-running ingestion; no model training.

Everything is free and open source and runs on a normal laptop CPU.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Setup (once)](#setup-once)
- [Running it](#running-it)
- [Tests](#tests)
- [Using the chat UI](#using-the-chat-ui)
- [Adding or updating a course](#adding-or-updating-a-course)
- [Configuration](#configuration)
- [API](#api)
- [Project structure](#project-structure)
- [Exercise and quiz safety](#exercise-and-quiz-safety)
- [Troubleshooting](#troubleshooting)
- [Docker](#docker)
- [Not built yet](#not-built-yet)

---

## How it works

```text
INGESTION (python ingest.py)                       ANSWERING (uvicorn app.main:app)

data/lms_snapshot.json ─┐                          browser: React chat UI (frontend/)
data/pdfs/<slug>/*.pdf ─┴─► parse slides (pdfminer)         │  POST /api/chat
                            remove exercise text            ▼
                            match PDF → LMS module     router ──► catalog answer (SQLite, no LLM)
                            embed chunks (Ollama)        │
                                    │                    └──► hybrid search (BM25 + vectors)
                                    ▼                              │ relevance gate
                            build/catalog.db                       ▼
                            (catalog + chunks + vectors)    LLM via Ollama (qwen3:8b)
                                                                   │
                                                            exercise guard → reply + trace
```

| Question | Answered from | Example |
|---|---|---|
| Courses, modules, topics, durations | Catalog (SQLite) only, never the LLM | "What modules are in Basic - Foundations?" |
| What a topic or subject is about | Hybrid search, then the LLM in 2–4 sentences | "What is context rot?" |
| Exercises or quizzes | Fixed reply: the module has them on the course page | "What's the B05 exercise?" |
| Who the bot is | Fixed reply | "What is your name?" |
| Not in any course, or off-topic | Says so and lists the courses on offer | "Do you have a Kubernetes course?" |

If the LLM is down or times out, content questions still get a short answer from the catalog.
If the embedding model is down, search carries on with keywords only.

**Tech stack:** Python, FastAPI, SQLite, numpy, pdfminer.six, Ollama (`qwen3:8b` for answers,
`nomic-embed-text` for embeddings) through the OpenAI-compatible API, and a React + TypeScript +
Vite + Tailwind + shadcn/ui front end. None of the Python packages need the Microsoft Visual C++
runtime.

---

## Requirements

| Tool | Version | Used for |
|---|---|---|
| Python | 3.11 or newer (tested on 3.14) | API, ingestion, tests |
| Node.js | 20 LTS or newer (tested on 24 LTS) | Building the chat UI |
| Ollama | Current release, from [ollama.com](https://ollama.com) | Runs the LLM and the embedding model |

About 6 GB of free disk for the two models, and 8 GB of RAM or more (16 GB recommended).

---

## Setup (once)

Commands are for **Windows PowerShell**, run from the project folder. macOS/Linux equivalents are
shown where they differ.

**1. Download the models**

```powershell
ollama pull qwen3:8b            # writes the answers (about 5 GB)
ollama pull nomic-embed-text    # embeddings for search (about 270 MB)
```

**2. Python environment**

```powershell
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env
```

If PowerShell refuses to run the activate script, allow local scripts once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**3. Build the chat UI**

```powershell
cd frontend
npm install
npm run build                   # writes frontend/dist, which the API serves at /
cd ..
```

**4. Build the course data**

Ollama must be running (it embeds the search chunks).

```powershell
python ingest.py
```

Expected output:

```text
OK: 5 modules, 31 search chunks, embeddings = api:nomic-embed-text
warning: production-engineering: no PDF folder; only catalog details will be available
Report: ...\build\ingest_report.json
```

---

## Running it

```powershell
.venv\Scripts\activate
uvicorn app.main:app --port 8000
```

Open **http://127.0.0.1:8000** and click **Ask Course Guide** at the bottom right.

| Task | Command |
|---|---|
| Start the app (API + UI) | `uvicorn app.main:app --port 8000` |
| Rebuild the data after a PDF or course change | `python ingest.py`, then restart the server |
| Rebuild the UI after a front-end change | `cd frontend; npm run build` |
| Work on the UI with live reload | API running on :8000, then `cd frontend; npm run dev` and open http://localhost:5173 |
| Run the tests | `python -m pytest -q` |
| Lint the UI | `cd frontend; npm run lint` |
| Check the server | `Invoke-RestMethod http://127.0.0.1:8000/health` (macOS/Linux: `curl http://127.0.0.1:8000/health`) |

The server reads `build/` once at startup, so `python ingest.py` can run while it's up; restart the
server to use the new build. The first answer after starting can be slower while Ollama loads the
model (the server starts loading it straight away).

On a laptop CPU, catalog answers are instant and LLM answers take roughly 40–60 seconds.

---

## Tests

```powershell
python -m pytest -q
```

49 tests, offline, in about 30 seconds. They use a built-in hash embedder instead of Ollama, an
unreachable LLM address, and a temporary build folder, so they never touch the real `build/`.

They cover: parsing of all five PDFs (topics, minutes, role chips), that no exercise text reaches
the index or any trace, question routing (including off-topic and prompt-injection questions),
follow-up questions, the API and the RAG trace, keyword-only fallback, context trimming, Stop
cancelling the LLM, and fail-closed ingestion.

---

## Using the chat UI

**Display modes:** the buttons in the chat header switch between them.

- **Floating:** a window at the bottom right; drag its top-left corner to resize.
- **Docked:** a full-height side panel that pushes the page aside; drag its left edge to resize.
- **Full screen:** the full layout with the sidebar. `Esc` goes back.
- On phones it always fills the screen.

**Chats** are kept until you delete them. The sidebar groups them by date and has a search box;
open any chat to carry on. Each chat's ⋯ menu has **Rename** and **Delete**. Chats are stored in
the browser (localStorage), not on the server, so another browser or device has its own history.

**While asking:**

- **Stop** cancels an answer, and the LLM stops working on it too.
- **Edit** (hover a question) replaces everything after it and asks again.
- **Copy** and **Regenerate** appear when you hover an answer.
- Each chat answers independently, so you can switch chats while one is waiting.

**RAG details** under each answer show:

- **Pipeline:** each step with its time (catalog lookup → router → hybrid search → LLM → exercise
  guard).
- **Chunks:** source PDF and page, vector and BM25 scores, matched words, and the chunk text.
- **Usage:** prompt and completion tokens, speed and models.

The sidebar's **Index** panel shows what's indexed: chunks, PDFs, models, thresholds and build
time. **Settings** has the theme (light, dark, system), the RAG details switch and *Clear all*.

The page around the widget is a stand-in course page for local testing; only the widget is meant
for the real site.

---

## Adding or updating a course

1. **Course and modules:** add them to `data/lms_snapshot.json`, in the same shape as the LMS API
   response. The public endpoints `GET https://api.smartworking.training/api/courses?status=PUBLISHED`
   and `GET https://api.smartworking.training/api/courses/<slug>` return this data without a login.
2. **PDFs:** put one slide deck per module in `data/pdfs/<course-slug>/` (the slug from the LMS,
   e.g. `basic-foundations`). File names don't matter: each PDF is matched to its module by the
   title on its cover.
3. **Build:** run `python ingest.py`, check `build/ingest_report.json`, and restart the server.

Ingestion is **fail-closed**: if any PDF fails a check, `build/` is left exactly as it was and
the errors are printed. The checks include:

- unreadable cover;
- topic minutes not adding up to the cover total;
- missing role chips;
- a title that matches no module.

If a title can't be matched automatically, map it in `data/module_overrides.json`:

```json
{"basic-foundations/module-x.pdf": "<lms module id>"}
```

The parser expects the current slide layout (cover, "at a glance", topic slides with an EXERCISE
band and role chips, planning reference, closing slide). A course with a different template
fails ingestion safely until the parser is extended for it.

---

## Configuration

All settings live in `.env` (copied from `.env.example`). Defaults are in `config.py`.

| Variable | Default | Purpose |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Any OpenAI-compatible server (Ollama, llama.cpp, a hosted API) |
| `LLM_API_KEY` | `ollama` | Key for that server (Ollama ignores it) |
| `LLM_MODEL` | `qwen3:8b` | Model that writes content answers |
| `LLM_TIMEOUT_SECONDS` | `120` | After this, fall back to a catalog answer |
| `LLM_REASONING_EFFORT` | *(blank)*; `.env.example` sets `none` | `none` turns off qwen3's thinking mode; leave blank for other models |
| `EMBEDDING_BACKEND` | `api` | `api` for real use; `hash` is for tests only |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model (re-run ingestion after changing it) |
| `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY` | same as the LLM | Use a different server for embeddings |
| `TOP_K` | `3` | Chunks passed to the LLM |
| `LLM_CHUNK_CHARS` | `700` | Most characters kept from each chunk (prompt size drives speed) |
| `STRONG_VECTOR_SCORE` | `0.70` | Similarity at which a chunk counts without a shared keyword |
| `MIN_VECTOR_SCORE` | `0.55` | Similarity a keyword match also needs |
| `BOT_NAME` | `Course Guide` | Name used in replies and in the UI |
| `ALLOWED_ORIGINS` | *(none)*; `.env.example` sets the site and localhost | Comma-separated CORS origins |
| `RATE_LIMIT_PER_MINUTE` | `20` | Questions per IP per minute |
| `MAX_QUESTION_CHARS` | `500` | Longest accepted question |
| `BUILD_DIR` | `build` | Where ingestion writes |

**Switching the LLM:** change `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`; nothing else changes.
**Switching the embedding model:** change `EMBEDDING_MODEL`, run `python ingest.py`, and
recalibrate the two vector scores. The server refuses to start if the build was made with a
different embedding model.

---

## API

| Method and path | Body / response |
|---|---|
| `POST /api/chat` | Body `{"message": "...", "history": [{"role": "user" \| "assistant", "content": "..."}]}` (message ≤ 500 characters, history ≤ 20 turns). Returns `{"reply", "intent", "sources", "trace"}`. Closing the request cancels the answer. |
| `GET /api/index` | What is indexed: courses, modules, PDFs, chunk counts, models, thresholds, bot name. |
| `GET /health` | `{"status": "ok", "courses": <n>}` |
| `GET /` | The chat UI (from `frontend/dist`). |

`intent` is one of `greeting`, `about`, `exercise_quiz`, `list_courses`, `list_modules`,
`module_overview`, `topic_overview`, `duration`, `content`, `not_covered`, `stopped`.

---

## Project structure

| Path | Responsibility |
|---|---|
| `config.py` | All settings, read from `.env`. |
| `ingest.py` | One-command ingestion: validate, build, report, fail-closed swap of `build/`. |
| `ingestion/pdf_parser.py` | Reads a slide deck into structured data and strips exercise text. |
| `ingestion/matcher.py` | Matches each PDF to its LMS module by title. |
| `ingestion/build.py` | Writes `catalog.db`: catalog tables, search chunks and their vectors. |
| `app/main.py` | FastAPI app: chat API, index info, health, CORS, rate limit, serves the UI. |
| `app/chat.py` | Routes each question to an intent and builds the reply and its trace. |
| `app/catalog.py` | Catalog lookups, detecting courses/modules/topics in a question, exercise guard. |
| `app/retrieval.py` | Hybrid search (BM25 + embeddings) with the relevance gate. |
| `app/llm.py` | System prompt and the streaming, cancellable LLM call. |
| `app/embeddings.py` | Embeddings through the OpenAI-compatible API; `hash` backend for tests. |
| `app/trace.py` | Records pipeline steps, chunks and tokens for the RAG details panel. |
| `frontend/` | React chat UI (`src/components/chat/` for the chat, `src/lib/` for API, storage, theme). |
| `data/lms_snapshot.json` | Courses and modules as returned by the LMS API. |
| `data/pdfs/<course-slug>/` | One PDF per module. |
| `tests/test_chatbot.py` | All tests. |
| `build/` | Generated by `python ingest.py`. Never edit by hand. |

---

## Exercise and quiz safety

Learners must never see exercise or quiz content. Three independent defences:

1. **Ingestion:** the EXERCISE band on every topic slide and the exercises table are removed
   before anything is indexed. Only hashed 6-word phrases of that text are kept, for defence 3.
2. **Routing:** questions about exercises, quizzes, answers or solutions get a fixed reply (the
   module includes exercises and a quiz on the course page) before search or the LLM run.
3. **Output guard:** every LLM reply is checked against the hashed exercise phrases and replaced
   with a catalog answer if it matches.

The LLM is also told to use only the retrieved course material and to ignore instructions in the
learner's message. Prices and exercise counts are not stored or mentioned.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Answers carry a "short catalog answer" badge | The LLM timed out or isn't reachable. Check Ollama is running (`ollama ps`) and the model is pulled (`ollama list`). The RAG details show the reason. |
| `python ingest.py` says "Build failed" | Ollama isn't running or `nomic-embed-text` isn't pulled. `build/` was not changed. |
| `python ingest.py` says "build/ is in use" | Another program has a file in `build/` open (e.g. a database viewer). Close it and run again. |
| Server won't start: "build/ was made with … embeddings" | `EMBEDDING_MODEL` changed since the last ingestion. Run `python ingest.py`. |
| Page says "The chat UI isn't built yet" | Run `cd frontend; npm install; npm run build`, then restart the server. |
| Answers are slow | Normal on a CPU (about 40–60 s). Lower `TOP_K` or `LLM_CHUNK_CHARS`, or use a smaller non-thinking model in `LLM_MODEL`. |
| `npm` or `node` not found | Install Node.js LTS and open a new terminal. |

---

## Docker

The image builds the UI and runs the API. The LLM and embeddings stay on an OpenAI-compatible
server, configured through the same environment variables.

```powershell
python ingest.py                         # build/ is copied into the image
docker build -t lms-chatbot .
docker run -p 8000:8000 --env-file .env -e LLM_BASE_URL=http://host.docker.internal:11434/v1 lms-chatbot
```

The Docker image has not been tested yet.

---

## Not built yet

- **Live course fetch:** courses and modules still come from `data/lms_snapshot.json`; the public
  endpoints above could replace it.
- **Automatic PDF download:** module files need a logged-in session, so PDFs are copied by hand.
- **Production Engineering content:** its six modules are listed, but there are no PDFs yet.
- **Deployment and embedding on smartworking.training:** waiting on the hosting choice.
- **On hold until decided:** role-based answers (role relevance is already stored per topic),
  mentioning prices, and mentioning exercise counts.
