"""All settings come from .env so nothing is hard-coded per environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")



# Paths
DATA_DIR = ROOT / "data"
PDF_DIR = DATA_DIR / "pdfs"                 # data/pdfs/<course-slug>/*.pdf
SNAPSHOT_FILE = DATA_DIR / "lms_snapshot.json"
BUILD_DIR = Path(os.getenv("BUILD_DIR", ROOT / "build"))   # tests point this at a temp folder
CATALOG_DB = BUILD_DIR / "catalog.db"       # catalog tables + search chunks with their vectors
REPORT_FILE = BUILD_DIR / "ingest_report.json"

# LLM (OpenAI-compatible)
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:8b")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))
# Sent as reasoning_effort when set; "none" turns off thinking in models like qwen3. Blank = not sent.
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "").strip()

# Embeddings (OpenAI-compatible /v1/embeddings; same server as the LLM unless set)
EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "api")          # "hash" is for tests only
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "").strip() or LLM_BASE_URL
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "").strip() or LLM_API_KEY
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")

# Retrieval
# On a CPU, reading the prompt is the slow part (about 20 tokens/s for qwen3:8b on a laptop CPU),
# so the LLM gets a few short chunks: TOP_K chunks of at most LLM_CHUNK_CHARS characters each.
TOP_K = int(os.getenv("TOP_K", "3"))
LLM_CHUNK_CHARS = int(os.getenv("LLM_CHUNK_CHARS", "700"))
# Calibrated for nomic-embed-text: off-topic questions scored ≤0.63, close paraphrases 0.70–0.75.
STRONG_VECTOR_SCORE = float(os.getenv("STRONG_VECTOR_SCORE", "0.70"))
# A keyword match also needs at least this similarity, so one shared everyday word ("time")
# doesn't pass. Off-topic questions with a shared word scored 0.44–0.51; on-topic ≥0.61.
MIN_VECTOR_SCORE = float(os.getenv("MIN_VECTOR_SCORE", "0.55"))

# What the bot calls itself in replies and in the UI.
BOT_NAME = os.getenv("BOT_NAME", "Course Guide").strip() or "Course Guide"

# API
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "20"))
MAX_QUESTION_CHARS = int(os.getenv("MAX_QUESTION_CHARS", "500"))
