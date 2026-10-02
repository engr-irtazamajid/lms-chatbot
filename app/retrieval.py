"""Hybrid search over the course chunks.

vector   cosine similarity between the question and each chunk's stored embedding (1.0 = identical)
keyword  BM25 over the same chunks, so exact terms ("TDD", "context rot") rank well
gate     a chunk is used if its vector score is at least STRONG_VECTOR_SCORE, or if it shares
         at least half of the question's meaningful words AND scores at least MIN_VECTOR_SCORE.
         One shared everyday word is not enough: "current time in pakistan" shares only "time"
         with the slides. Off-topic questions therefore get "not covered" without calling the
         LLM. If embeddings are down, the keyword rule applies on its own.
The two rankings are merged with reciprocal rank fusion. If the embedding server is
unreachable, search carries on with keywords only.
"""
from __future__ import annotations

import logging
import math
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

import config
from app.embeddings import get_embedder
from ingestion.build import META_FIELDS

log = logging.getLogger(__name__)

STOPWORDS = set("""
a about after again all also am an and any are as at be been before being both but by can could
course courses covers cover covered covering did do does doing done each explain for from get give
had has have having he her here hers how i if in into is it its just know learn learning let like
me module modules more most my no not now of on one or other our out over please same she should
show so some such tell than that the their them then there these they this those through to too
topic topics under up us very want was we were what when where which while who why will with would
you your yours study studying teach teaches taught find mean means meaning
write make create generate draft compose build help need give
""".split())
SUFFIXES = ("ing", "ed", "es", "s", "e")


def stem(w: str) -> str:
    for suf in SUFFIXES:
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def terms(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[a-z0-9]+", text.lower()):
        if w in STOPWORDS or len(w) < 2:
            continue
        out.append(stem(w))
    return out


@dataclass
class Hit:
    text: str
    score: float          # vector cosine similarity
    keyword: float        # BM25 score
    meta: dict
    fused: float = 0.0    # reciprocal-rank-fusion score used for ordering
    matched: tuple[str, ...] = ()   # question terms found in the chunk


class _Index:
    def __init__(self):
        db = sqlite3.connect(f"file:{config.CATALOG_DB}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT * FROM chunks ORDER BY rowid").fetchall()
        db.close()
        self.docs = [r["text"] for r in rows]
        self.metas = [{f: r[f] for f in META_FIELDS} for r in rows]
        self.vectors = (np.vstack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
                        if rows else np.zeros((0, 1), dtype=np.float32))
        self.tokens = [terms(d) for d in self.docs]
        self.avg_len = sum(map(len, self.tokens)) / max(1, len(self.tokens))
        df = Counter(t for toks in self.tokens for t in set(toks))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def bm25(self, q_terms: list[str], i: int, k1: float = 1.4, b: float = 0.75) -> float:
        tf = Counter(self.tokens[i])
        size = len(self.tokens[i])
        return sum(self.idf.get(t, 0) * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * size / self.avg_len))
                   for t in q_terms if t in tf)


@lru_cache(maxsize=1)
def _index() -> _Index:
    return _Index()


def search(query: str, k: int = config.TOP_K, module_ids: list[str] | None = None,
           info: dict | None = None) -> list[Hit]:
    """`info`, if given, is filled with search statistics for the trace panel."""
    info = info if info is not None else {}
    idx = _index()
    allowed = [i for i, m in enumerate(idx.metas) if not module_ids or m["module_id"] in module_ids]
    q_terms = terms(query)
    info.update(terms=sorted(set(q_terms)), index_size=len(idx.docs), searched=len(allowed),
                vector_search=False, candidates=0, passed_gate=0)
    if not allowed:
        return []

    vec: dict[int, float] = {}
    try:
        q = np.asarray(get_embedder().embed_query(query), dtype=np.float32)
        scores = idx.vectors[allowed] @ q                 # vectors are normalised: dot = cosine
        top = np.argsort(-scores)[:max(k * 3, 10)]
        vec = {allowed[j]: float(scores[j]) for j in top}
        info["vector_search"] = True
    except Exception as exc:  # embedding server down: keywords still work
        log.warning("Embeddings unavailable, keyword search only: %s", exc)
    kw = {i: idx.bm25(q_terms, i) for i in allowed}

    vec_rank = {i: r for r, i in enumerate(sorted(vec, key=vec.get, reverse=True))}
    kw_rank = {i: r for r, i in enumerate(sorted((i for i in kw if kw[i] > 0), key=kw.get, reverse=True))}

    def fused(i: int) -> float:
        return sum(1 / (60 + rank[i]) for rank in (vec_rank, kw_rank) if i in rank)

    q_set = set(q_terms)
    needed = max(1, math.ceil(len(q_set) / 2))
    hits = []
    candidates = sorted(set(vec_rank) | set(kw_rank), key=fused, reverse=True)
    info.update(candidates=len(candidates), keywords_needed=needed,
                min_vector=config.MIN_VECTOR_SCORE, strong_vector=config.STRONG_VECTOR_SCORE)
    for i in candidates:
        shared = q_set & set(idx.tokens[i])
        lexical = len(shared) >= needed
        score = vec.get(i, 0.0)
        if vec:   # embeddings available: a keyword match must also be close in meaning
            ok = score >= config.STRONG_VECTOR_SCORE or (lexical and score >= config.MIN_VECTOR_SCORE)
        else:
            ok = lexical
        if ok:
            hits.append(Hit(idx.docs[i], score, kw.get(i, 0.0), idx.metas[i], fused(i), tuple(sorted(shared))))
    info["passed_gate"] = len(hits)
    return hits[:k]
