"""Write the catalog and the search index into one SQLite file in a build folder.

Search chunks and their embedding vectors live in the `chunks` table. At a few hundred chunks
an exact in-memory comparison (numpy) is instant, so no vector database is needed.
"""
from __future__ import annotations

import html
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.embeddings import get_embedder
from ingestion.pdf_parser import ModuleDeck

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE courses (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, level TEXT, description TEXT, position INTEGER);
CREATE TABLE modules (
  id TEXT PRIMARY KEY, course_id TEXT, title TEXT, position INTEGER,
  slide_label TEXT, slide_name TEXT, level_text TEXT, topic_range TEXT,
  total_minutes INTEGER, topic_count INTEGER, description TEXT,
  after_module TEXT, next_title TEXT, next_text TEXT, takeaway TEXT,
  has_material INTEGER, source_file TEXT);
CREATE TABLE topics (
  module_id TEXT, code TEXT, title TEXT, minutes INTEGER, outcome TEXT,
  has_exercise INTEGER, page INTEGER, position INTEGER, PRIMARY KEY (module_id, code));
CREATE TABLE topic_roles (module_id TEXT, code TEXT, role TEXT, relevance TEXT);
CREATE TABLE guard_shingles (hash TEXT PRIMARY KEY);
CREATE TABLE chunks (
  id TEXT PRIMARY KEY, kind TEXT, course_slug TEXT, course_title TEXT, module_id TEXT,
  module_title TEXT, topic_code TEXT, page INTEGER, text TEXT, embedding BLOB);
"""
META_FIELDS = ("kind", "course_slug", "course_title", "module_id", "module_title", "topic_code", "page")


def clean_course_description(raw_html: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw_html or ""))
    # Exercise counts are withheld until confirmed (open question): drop "· 23 exercises".
    text = re.sub(r"·?\s*\d+\s+exercises?", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def _module_chunk(course: dict, module: dict, deck: ModuleDeck) -> str:
    topics = "; ".join(f"{t.code} {t.title} ({t.minutes} min)" for t in deck.topics)
    parts = [
        f"Course: {course['title']}. Module: {module['title']} (Module {deck.module_label} in the slides).",
        f"{deck.level}. {len(deck.topics)} topics, {deck.cover_minutes} minutes.",
        deck.description,
        f"Topics: {topics}.",
        "After this module learners can: " + " ".join(deck.after_module),
        f"Next: {deck.next_title}. {deck.next_text}" if deck.next_title else "",
        deck.takeaway,
    ]
    return "\n".join(p for p in parts if p)


def _topic_chunk(course: dict, module: dict, t) -> str:
    return "\n".join([
        f"Course: {course['title']}. Module: {module['title']}. Topic {t.code}: {t.title}.",
        f"Outcome: {t.outcome}",
        "Key points: " + " ".join(t.bullets),
        "Worked example on the slide: " + " · ".join(t.diagram),
    ])


def build(snapshot: dict, matched: list[tuple[dict, dict, ModuleDeck]], out_dir: Path) -> dict:
    """matched = [(course, lms_module, deck)]. Returns stats for the report."""
    out_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(out_dir / "catalog.db")
    db.executescript(SCHEMA)
    embedder = get_embedder()
    db.execute("INSERT INTO meta VALUES ('embedding_backend', ?)", (embedder.name,))

    decks_by_module = {m["id"]: d for _, m, d in matched}
    ids, docs, metas = [], [], []

    for c_pos, course in enumerate(snapshot["courses"]):
        if course.get("status") != "PUBLISHED":
            continue
        desc = clean_course_description(course.get("description_html", ""))
        db.execute("INSERT INTO courses VALUES (?,?,?,?,?,?)",
                   (course["id"], course["slug"], course["title"], course.get("level"), desc, c_pos))
        if desc:
            ids.append(f"course:{course['id']}")
            docs.append(f"Course: {course['title']}. {desc}")
            metas.append({"kind": "course", "course_slug": course["slug"], "course_title": course["title"],
                          "module_id": "", "module_title": "", "topic_code": "", "page": 0})

        for m_pos, module in enumerate(course.get("modules", [])):
            if not module.get("isPublished", True):
                continue
            deck = decks_by_module.get(module["id"])
            db.execute(
                "INSERT INTO modules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (module["id"], course["id"], module["title"], m_pos,
                 deck.module_label if deck else None, deck.module_name if deck else None,
                 deck.level if deck else None, deck.topic_range if deck else None,
                 deck.cover_minutes if deck else None, len(deck.topics) if deck else None,
                 deck.description if deck else None,
                 json.dumps(deck.after_module) if deck else None,
                 deck.next_title if deck else None, deck.next_text if deck else None,
                 deck.takeaway if deck else None, 1 if deck else 0,
                 Path(deck.source_file).name if deck else None))
            if not deck:
                continue
            base = {"course_slug": course["slug"], "course_title": course["title"],
                    "module_id": module["id"], "module_title": module["title"]}
            ids.append(f"module:{module['id']}")
            docs.append(_module_chunk(course, module, deck))
            metas.append({**base, "kind": "module", "topic_code": "", "page": 1})
            for t_pos, t in enumerate(deck.topics):
                db.execute("INSERT INTO topics VALUES (?,?,?,?,?,?,?,?)",
                           (module["id"], t.code, t.title, t.minutes, t.outcome,
                            int(t.has_exercise), t.page, t_pos))
                db.executemany("INSERT INTO topic_roles VALUES (?,?,?,?)",
                               [(module["id"], t.code, r, v) for r, v in t.roles.items()])
                ids.append(f"topic:{module['id']}:{t.code}")
                docs.append(_topic_chunk(course, module, t))
                metas.append({**base, "kind": "topic", "topic_code": t.code, "page": t.page})
            for e in deck.extras:
                ids.append(f"extra:{module['id']}:{e['page']}")
                docs.append(f"Course: {course['title']}. Module: {module['title']}. {e['title']}. {e['text']}")
                metas.append({**base, "kind": "extra", "topic_code": "", "page": e["page"]})
            db.executemany("INSERT OR IGNORE INTO guard_shingles VALUES (?)",
                           [(h,) for h in deck.exercise_shingles])

    vectors = embedder.embed_documents(docs) if docs else []
    db.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("built_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        ("embedding_dim", str(len(vectors[0]) if vectors else 0)),
        ("parser", "pdfminer.six"),
    ])
    db.executemany(f"INSERT INTO chunks VALUES (?,{','.join('?' * len(META_FIELDS))},?,?)",
                   [(i, *(m[f] for f in META_FIELDS), d, np.asarray(v, dtype=np.float32).tobytes())
                    for i, m, d, v in zip(ids, metas, docs, vectors)])
    db.commit()
    db.close()
    return {"chunks": len(docs), "embedding_backend": embedder.name}
