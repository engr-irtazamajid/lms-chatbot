"""Match a parsed PDF to an LMS module.

PDF covers say "Module D & E – Building and Retrieval concepts"; the LMS API says
"Building Retrieval Concepts". Titles are compared as word sets without filler words.
If a title ever fails to match, add the PDF to data/module_overrides.json:
    {"basic-foundations/module-x.pdf": "<lms module id>"}
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import config

FILLER = {"and", "the", "of", "a", "an", "to", "for", "with"}
OVERRIDES_FILE = config.DATA_DIR / "module_overrides.json"


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if w not in FILLER}


def similarity(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / len(wa | wb) if wa and wb else 0.0


def load_overrides() -> dict[str, str]:
    if OVERRIDES_FILE.exists():
        return json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
    return {}


def match_module(course_slug: str, pdf_path: Path, pdf_module_name: str,
                 lms_modules: list[dict], overrides: dict[str, str]) -> tuple[dict | None, float]:
    key = f"{course_slug}/{pdf_path.name}"
    if key in overrides:
        hit = next((m for m in lms_modules if m["id"] == overrides[key]), None)
        return hit, 1.0 if hit else 0.0
    scored = sorted(((similarity(pdf_module_name, m["title"]), m) for m in lms_modules),
                    key=lambda s: s[0], reverse=True)
    if scored and scored[0][0] >= 0.75:
        return scored[0][1], scored[0][0]
    return None, scored[0][0] if scored else 0.0
