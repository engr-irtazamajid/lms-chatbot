"""Read-only access to build/catalog.db plus detection of courses, modules and topics in text."""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from functools import lru_cache

import config
from ingestion.pdf_parser import shingles

FILLER = {"and", "the", "of", "a", "an", "to", "for", "with", "basic", "module", "course"}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


@dataclass
class Mentions:
    course: dict | None = None
    modules: list[dict] = field(default_factory=list)
    topics: list[dict] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not (self.course or self.modules or self.topics)


class Catalog:
    def __init__(self, path=config.CATALOG_DB):
        # Everything is read once and the file closed: request threads never share a SQLite
        # connection, and a running server doesn't lock build/ against re-ingestion on Windows.
        # A new build is picked up when the server restarts.
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            self._courses = [dict(r) for r in db.execute("SELECT * FROM courses ORDER BY position")]
            self._modules = [dict(r) for r in db.execute("SELECT * FROM modules ORDER BY course_id, position")]
            self._topics = [dict(r) for r in db.execute("SELECT * FROM topics ORDER BY module_id, position")]
            self._guard = {r[0] for r in db.execute("SELECT hash FROM guard_shingles")}
            self.embedding_backend = db.execute(
                "SELECT value FROM meta WHERE key='embedding_backend'").fetchone()[0]
            self._index_info = self._build_index_info(db)
        finally:
            db.close()

    # ------------------------------------------------------------ lookups
    def courses(self) -> list[dict]:
        return self._courses

    def course(self, course_id: str) -> dict:
        return next(c for c in self._courses if c["id"] == course_id)

    def modules(self, course_id: str) -> list[dict]:
        return [m for m in self._modules if m["course_id"] == course_id]

    def module(self, module_id: str) -> dict:
        return next(m for m in self._modules if m["id"] == module_id)

    def topics(self, module_id: str) -> list[dict]:
        return [t for t in self._topics if t["module_id"] == module_id]

    # ------------------------------------------------------------ detection
    def find(self, text: str) -> Mentions:
        found = Mentions()
        words = _words(text)
        low = text.lower()

        for c in self._courses:
            key = _words(c["title"]) - FILLER
            if (key and key <= words) or c["slug"] in low:
                found.course = c

        for code in re.findall(r"\bb\s?0?(\d{1,2})\b", low):
            code = f"B{int(code):02d}"
            found.topics += [t for t in self._topics if t["code"] == code]

        letters = set(re.findall(r"\bmodules?\s+([a-z])\b", low))
        letters |= set(re.findall(r"\bmodules?\s+[a-z]\s*(?:&|and)\s*([a-z])\b", low))
        for m in self._modules:
            label_letters = set(re.findall(r"[a-z]", (m["slide_label"] or "").lower()))
            title_words = _words(m["title"]) - FILLER
            if (letters & label_letters) or (title_words and title_words <= words):
                if found.course is None or m["course_id"] == found.course["id"]:
                    found.modules.append(m)
        return found

    # ------------------------------------------------------------ guard
    def leaks_exercise_text(self, text: str) -> bool:
        return bool(shingles(text) & self._guard)

    @property
    def guard_size(self) -> int:
        return len(self._guard)

    # ------------------------------------------------------------ index details for the UI
    def index_info(self) -> dict:
        """Counts and file names only: no chunk text and no exercise data beyond a hash count."""
        return self._index_info

    def _build_index_info(self, db: sqlite3.Connection) -> dict:
        meta = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM meta")}
        kinds = {r["kind"]: r["n"] for r in db.execute("SELECT kind, COUNT(*) AS n FROM chunks GROUP BY kind")}
        per_module = {r["module_id"]: r["n"] for r in
                      db.execute("SELECT module_id, COUNT(*) AS n FROM chunks GROUP BY module_id")}
        courses = []
        for c in self._courses:
            mods = [{"title": m["title"], "slide_label": m["slide_label"], "file": m["source_file"],
                     "topics": m["topic_count"] or 0, "minutes": m["total_minutes"] or 0,
                     "topic_range": m["topic_range"], "chunks": per_module.get(m["id"], 0),
                     "has_material": bool(m["has_material"])} for m in self.modules(c["id"])]
            courses.append({"title": c["title"], "slug": c["slug"], "level": c["level"], "modules": mods})
        return {"built_at": meta.get("built_at"), "embedding_backend": self.embedding_backend,
                "embedding_dim": int(meta["embedding_dim"]) if meta.get("embedding_dim") else None,
                "parser": meta.get("parser"), "chunks": sum(kinds.values()), "chunks_by_kind": kinds,
                "courses": courses, "topics": len(self._topics),
                "pdfs": sum(1 for m in self._modules if m["source_file"]),
                "guard_hashes": len(self._guard)}


@lru_cache(maxsize=1)
def get_catalog() -> Catalog:
    return Catalog()
