"""Build the chatbot's data:  python ingest.py

Reads   data/lms_snapshot.json          courses + modules (from the LMS API)
        data/pdfs/<course-slug>/*.pdf    one slide deck per module
Writes  build/catalog.db (catalog + search chunks), build/ingest_report.json

The new build is written to a temporary folder and only replaces build/ when every
PDF parsed cleanly and matched an LMS module, so a bad file never breaks the live data.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import config
from ingestion.build import build
from ingestion.matcher import load_overrides, match_module
from ingestion.pdf_parser import parse_deck


def main() -> int:
    snapshot = json.loads(config.SNAPSHOT_FILE.read_text(encoding="utf-8"))
    courses = {c["slug"]: c for c in snapshot["courses"]}
    overrides = load_overrides()
    report: dict = {"courses": [], "errors": [], "warnings": []}
    matched = []

    for folder in sorted(p for p in config.PDF_DIR.iterdir() if p.is_dir()):
        course = courses.get(folder.name)
        if not course:
            report["errors"].append(f"{folder.name}/: no course with this slug in lms_snapshot.json")
            continue
        entry = {"slug": course["slug"], "title": course["title"], "modules": []}
        used: set[str] = set()
        for pdf in sorted(folder.glob("*.pdf")):
            deck = parse_deck(str(pdf))
            module, score = match_module(course["slug"], pdf, deck.module_name, course["modules"], overrides)
            item = {"pdf": pdf.name, "slide_module": f"Module {deck.module_label} – {deck.module_name}",
                    "lms_module": module["title"] if module else None, "match_score": round(score, 2),
                    "topics": [{"code": t.code, "title": t.title, "minutes": t.minutes,
                                "has_exercise": t.has_exercise, "roles": t.roles} for t in deck.topics],
                    "total_minutes": deck.cover_minutes, "extras": [e["title"] for e in deck.extras],
                    "problems": deck.problems}
            entry["modules"].append(item)
            if deck.problems:
                report["errors"].append(f"{pdf.name}: {deck.problems}")
            if not module:
                report["errors"].append(f"{pdf.name}: '{deck.module_name}' matches no LMS module "
                                        f"(best score {score:.2f}); add it to data/module_overrides.json")
            elif module["id"] in used:
                report["errors"].append(f"{pdf.name}: second PDF for LMS module '{module['title']}'")
            else:
                used.add(module["id"])
                matched.append((course, module, deck))
        for m in course["modules"]:
            if m["id"] not in used:
                report["warnings"].append(f"{course['slug']}: LMS module '{m['title']}' has no PDF yet")
        report["courses"].append(entry)

    for slug in courses:
        if not (config.PDF_DIR / slug).is_dir():
            report["warnings"].append(f"{slug}: no PDF folder; only catalog details will be available")

    if report["errors"]:
        print(json.dumps(report["errors"], indent=2))
        print("\nIngestion stopped: build/ was NOT changed.")
        return 1

    config.BUILD_DIR.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="build-", dir=config.BUILD_DIR.parent))
    try:
        stats = build(snapshot, matched, tmp)
    except Exception as exc:  # e.g. the embedding server is not running
        shutil.rmtree(tmp, ignore_errors=True)
        print(f"Build failed: {exc}\n\nIngestion stopped: build/ was NOT changed.")
        return 1
    report["stats"] = stats
    (tmp / "ingest_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    # Swap: move the old build aside first. On Windows, if another program has a file in build/
    # open, the move fails before anything is deleted, so build/ stays intact.
    old = None
    if config.BUILD_DIR.exists():
        old = config.BUILD_DIR.with_name(f"{config.BUILD_DIR.name}-old-{int(time.time())}")
        try:
            config.BUILD_DIR.rename(old)
        except OSError as exc:
            shutil.rmtree(tmp, ignore_errors=True)
            print(f"build/ is in use by another program ({exc.strerror}). Close it and run "
                  "python ingest.py again.\n\nIngestion stopped: build/ was NOT changed.")
            return 1
    tmp.rename(config.BUILD_DIR)
    if old:
        shutil.rmtree(old, ignore_errors=True)

    print(f"OK: {len(matched)} modules, {stats['chunks']} search chunks, embeddings = {stats['embedding_backend']}")
    for w in report["warnings"]:
        print("warning:", w)
    print(f"Report: {config.REPORT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
