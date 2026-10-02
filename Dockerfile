# Backend + chat UI image. build/ must be produced first with: python ingest.py

# 1. Build the React UI
FROM node:24-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend ./
RUN npm run build

# 2. Python API, serving the built UI at /
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# The LLM and the embedding model are served by an OpenAI-compatible server (Ollama or a free
# API tier) set in the environment: LLM_BASE_URL, LLM_MODEL, EMBEDDING_MODEL, ...
COPY config.py ./
COPY app ./app
COPY ingestion ./ingestion
COPY --from=ui /ui/dist ./frontend/dist
COPY build ./build
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
