"""Embedding backends.

api   real use: any OpenAI-compatible /v1/embeddings server (Ollama by default, model
      nomic-embed-text). Configured only by .env, like the LLM.
hash  offline test backend only: bag of words/bigrams, no download, no server.
Ingestion and the app must use the same backend; ingest records it and the app checks.
"""
from __future__ import annotations

import hashlib
import re
from functools import lru_cache

import numpy as np

import config

# Some embedding models expect a task prefix; texts without it match noticeably worse.
PREFIXES = {  # substring of the model name: (document prefix, query prefix)
    "nomic-embed": ("search_document: ", "search_query: "),
    "bge": ("", "Represent this sentence for searching relevant passages: "),
}
BATCH = 32


def _normalise(vectors) -> list[list[float]]:
    m = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    return (m / np.where(norms == 0, 1, norms)).tolist()


class HashEmbedder:
    name = "hash"
    dim = 2048

    def _vec(self, text: str) -> list[float]:
        words = re.findall(r"[a-z0-9]+", text.lower())
        grams = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
        v = np.zeros(self.dim, dtype=np.float32)
        for g in grams:
            v[int(hashlib.md5(g.encode()).hexdigest(), 16) % self.dim] += 1.0
        n = np.linalg.norm(v)
        return (v / n if n else v).tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


class ApiEmbedder:
    def __init__(self, base_url: str, api_key: str, model: str):
        from openai import OpenAI
        self.name = f"api:{model}"
        self.model = model
        self.client = OpenAI(base_url=base_url, api_key=api_key, timeout=30, max_retries=0)
        self.doc_prefix, self.query_prefix = next(
            (p for key, p in PREFIXES.items() if key in model.lower()), ("", ""))

    def _embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for i in range(0, len(texts), BATCH):
            resp = self.client.embeddings.create(model=self.model, input=texts[i:i + BATCH])
            out += [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
        return _normalise(out)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed([self.doc_prefix + t for t in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._embed([self.query_prefix + text])[0]


@lru_cache(maxsize=1)
def get_embedder():
    if config.EMBEDDING_BACKEND == "hash":
        return HashEmbedder()
    if config.EMBEDDING_BACKEND == "api":
        return ApiEmbedder(config.EMBEDDING_BASE_URL, config.EMBEDDING_API_KEY, config.EMBEDDING_MODEL)
    raise ValueError(f"Unknown EMBEDDING_BACKEND '{config.EMBEDDING_BACKEND}' (use 'api' or 'hash')")
