"""Parse one module slide deck (PDF) into structured data.

The decks share one layout (verified on Modules A, B, C, D & E and F):
  page 1            cover: program, "Module X – Name", level, topic range, description, stats
  "... at a glance" topic codes, titles and minutes
  "MODULE X · ... · Bnn"  one topic slide each: outcome, bullets, diagram, EXERCISE band, role chips
  "PLANNING REFERENCE"    exercises table  -> skipped entirely
  "END OF MODULE X"       what learners can do after + what comes next
  anything else           extra slide (e.g. Module F "Six non-negotiables for the demo and labs")

Exercise text is never returned in indexable fields. It only feeds `exercise_shingles`,
a set of hashes used by the output guard to block leaks.

PDFs are read with pdfminer.six (pure Python, no C++ runtime needed on Windows). pdfminer
measures y from the page bottom; everything here uses y from the top, like the slide itself.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTCurve, LTPage, LTTextLine

FOOTER_Y = 505            # copyright line and page number sit below this
HEADER_MAX_Y = 45         # small orange header line
ROLE_CODES = ["FS", "BE", "FE", "QA", "DO", "DE", "DS", "PB", "SEC", "EM"]
CHIP_COLOURS = {"#ff5722": "core", "#ffd9cc": "relevant", "#f4f5f7": "none"}
BULLET_MAX_X = 58         # bullet column starts at x≈54 on every topic slide

TOPIC_HEADER = re.compile(r"^MODULE\s+(.+?)\s+·\s+(.+?)\s+·\s+(B\d{2})$")
MODULE_LINE = re.compile(r"^Module\s+(.+?)\s+[–-]\s+(.+)$")


@dataclass
class Line:
    y: float
    x: float
    x1: float
    size: float
    text: str
    y1: float = 0.0       # bottom edge

    @property
    def cx(self) -> float:
        return (self.x + self.x1) / 2


@dataclass
class Fill:
    """A filled shape (chip, band, box) with its colour as #rrggbb."""
    x0: float
    y0: float
    x1: float
    y1: float
    colour: str


@dataclass
class Topic:
    code: str
    title: str
    outcome: str = ""
    bullets: list[str] = field(default_factory=list)
    diagram: list[str] = field(default_factory=list)
    minutes: int | None = None
    has_exercise: bool = False
    roles: dict[str, str] = field(default_factory=dict)
    page: int = 0


@dataclass
class ModuleDeck:
    source_file: str
    program: str = ""
    module_label: str = ""         # "A", "D & E"
    module_name: str = ""          # "Model Fundamentals"
    level: str = ""                # "Level 1: Foundations"
    topic_range: str = ""          # "B01–B08"
    description: str = ""
    cover_topics: int | None = None
    cover_minutes: int | None = None
    topics: list[Topic] = field(default_factory=list)
    after_module: list[str] = field(default_factory=list)
    next_title: str = ""
    next_text: str = ""
    takeaway: str = ""
    extras: list[dict] = field(default_factory=list)
    exercise_shingles: set[str] = field(default_factory=set)
    page_types: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- helpers
def _walk(obj):
    yield obj
    if not isinstance(obj, LTTextLine) and hasattr(obj, "__iter__"):
        for child in obj:
            yield from _walk(child)


def _hex(colour) -> str | None:
    """pdfminer colours are gray (1 value), RGB (3) or CMYK (4), each 0–1."""
    if isinstance(colour, (int, float)):
        colour = (colour,)
    if not isinstance(colour, (tuple, list)) or not all(isinstance(c, (int, float)) for c in colour):
        return None                         # pattern fills etc.
    if len(colour) == 1:
        rgb = colour * 3
    elif len(colour) == 3:
        rgb = colour
    elif len(colour) == 4:
        c, m, y, k = colour
        rgb = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    else:
        return None
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in rgb)


def _page_content(page: LTPage) -> tuple[list[Line], list[Fill]]:
    height = page.height
    lines, fills = [], []
    for obj in _walk(page):
        if isinstance(obj, LTTextLine):
            text = obj.get_text().strip()
            top = height - obj.y1
            if not text or top >= FOOTER_Y:
                continue
            first = next((c for c in obj if isinstance(c, LTChar)), None)
            lines.append(Line(top, obj.x0, obj.x1, round(first.size, 2) if first else 0.0, text,
                              height - obj.y0))
        elif isinstance(obj, LTCurve) and obj.fill and (colour := _hex(obj.non_stroking_color)):
            fills.append(Fill(obj.x0, height - obj.y1, obj.x1, height - obj.y0, colour))
    return lines, fills


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("▪", "")).strip()


def shingles(text: str, n: int = 6) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {hashlib.sha1(" ".join(words[i:i + n]).encode()).hexdigest()[:12]
            for i in range(max(0, len(words) - n + 1))}


def _page_type(index: int, lines: list[Line]) -> str:
    if index == 0:
        return "cover"
    header = next((l.text for l in lines if l.y < HEADER_MAX_Y), "")
    title = next((l.text for l in lines if 45 <= l.y <= 75 and l.size >= 20), "")
    if title.lower().endswith("at a glance"):
        return "glance"
    if header.upper().startswith("PLANNING REFERENCE"):
        return "exercises_table"
    if header.upper().startswith("END OF MODULE"):
        return "closing"
    if TOPIC_HEADER.match(header):
        return "topic"
    return "extra"


def _role_chips(lines: list[Line], fills: list[Fill], height: float,
                problems: list[str], code: str) -> dict[str, str]:
    words = [l for l in lines if l.text in ROLE_CODES and l.y > height * 0.8]
    chips = [f for f in fills if f.x1 - f.x0 < 200]
    roles: dict[str, str] = {}
    for w in words:
        cx, cy = w.cx, (w.y + w.y1) / 2
        colour = None
        for f in chips:                    # last shape drawn under the code wins
            if f.x0 <= cx <= f.x1 and f.y0 <= cy <= f.y1:
                colour = f.colour
        if colour is None:
            continue                       # e.g. a role code used as diagram text
        roles[w.text] = CHIP_COLOURS.get(colour, f"unknown:{colour}")
    missing = [r for r in ROLE_CODES if r not in roles]
    if missing:
        problems.append(f"{code}: role chips missing {missing}")
    return roles


# ---------------------------------------------------------------- page parsers
def _parse_cover(lines: list[Line], deck: ModuleDeck) -> None:
    for l in lines:
        if l.size >= 35:
            deck.program = l.text
        elif 18 <= l.size <= 24 and (m := MODULE_LINE.match(l.text)):
            deck.module_label, deck.module_name = m.group(1).strip(), m.group(2).strip()
    level_line = next((l for l in lines if "Topics" in l.text and "·" in l.text), None)
    if level_line:
        left, right = level_line.text.split("·", 1)
        deck.level = left.strip()
        deck.topic_range = right.replace("Topics", "").strip()
    numbers = [l for l in lines if l.size >= 18 and l.text.isdigit()]
    first_number_y = min((n.y for n in numbers), default=1e9)
    start_y = level_line.y + 10 if level_line else 0
    deck.description = _clean(" ".join(
        l.text for l in sorted(lines, key=lambda l: (l.y, l.x))
        if start_y < l.y < first_number_y - 5 and 11 <= l.size <= 14))
    for label in (l for l in lines if l.text in {"topics", "minutes"}):
        near = min(numbers, key=lambda n: abs(n.cx - label.cx), default=None)
        if near is not None:
            if label.text == "topics":
                deck.cover_topics = int(near.text)
            else:
                deck.cover_minutes = int(near.text)


def _parse_glance(lines: list[Line]) -> dict[str, dict]:
    codes = [l for l in lines if re.fullmatch(r"B\d{2}", l.text)]
    mins = [l for l in lines if re.fullmatch(r"\d+ min", l.text)]
    result = {}
    for c in codes:
        m = min((m for m in mins if abs(m.y - c.y) < 4 and 0 < m.x - c.x < 420),
                key=lambda m: m.x - c.x, default=None)
        t = next((t for t in lines if t.size >= 12.5 and -16 < t.y - c.y < -4 and 20 < t.x - c.x < 60), None)
        result[c.text] = {"minutes": int(m.text.split()[0]) if m else None,
                          "title": t.text if t else ""}
    return result


def _parse_topic(page: LTPage, lines: list[Line], fills: list[Fill], index: int, deck: ModuleDeck) -> Topic:
    header = next(l for l in lines if l.y < HEADER_MAX_Y)
    code = TOPIC_HEADER.match(header.text).group(3)
    title = next((l.text for l in lines if 45 <= l.y <= 75 and l.size >= 20), "")
    topic = Topic(code=code, title=title, page=index + 1)

    outcome = next((l for l in lines if l.text.startswith("OUTCOME")), None)
    if outcome:
        topic.outcome = _clean(outcome.text[len("OUTCOME"):])
    roles_line = next((l for l in lines if l.text == "ROLES"), None)
    exercise = next((l for l in lines if l.text.startswith("EXERCISE")), None)

    band_top = exercise.y - 6 if exercise else (roles_line.y - 2 if roles_line else FOOTER_Y)
    band_bottom = roles_line.y - 2 if roles_line else FOOTER_Y
    if exercise:
        topic.has_exercise = True
        band_text = " ".join(l.text for l in lines if band_top <= l.y < band_bottom)
        deck.exercise_shingles |= shingles(band_text.replace("EXERCISE", " "))

    content_top = (outcome.y + 10) if outcome else 80
    content = [l for l in lines if content_top < l.y < band_top]
    for l in sorted((l for l in content if l.x < BULLET_MAX_X), key=lambda l: l.y):
        if l.text.startswith("▪") or not topic.bullets:
            topic.bullets.append(_clean(l.text))
        else:
            topic.bullets[-1] += " " + _clean(l.text)
    topic.diagram = [_clean(l.text) for l in sorted(content, key=lambda l: (round(l.y / 3), l.x))
                     if l.x >= BULLET_MAX_X]
    topic.roles = _role_chips(lines, fills, page.height, deck.problems, code)
    return topic


def _parse_closing(lines: list[Line], deck: ModuleDeck) -> None:
    for l in sorted(lines, key=lambda l: l.y):
        if l.x < BULLET_MAX_X and l.y > 150:
            if l.text.startswith("▪") or not deck.after_module:
                deck.after_module.append(_clean(l.text))
            else:
                deck.after_module[-1] += " " + _clean(l.text)
    right = sorted((l for l in lines if l.x > 550 and l.y > 120), key=lambda l: l.y)
    if right and right[0].text.upper().startswith("NEXT"):
        deck.next_title = right[0].text.split(":", 1)[-1].strip()
        deck.next_text = _clean(" ".join(l.text for l in right[1:]))
    deck.takeaway = next((l.text for l in lines if l.size >= 16 and l.y > 380), "")


def _parse_exercises_table(lines: list[Line], deck: ModuleDeck) -> set[str]:
    body = [l for l in lines if l.y > 170]
    # Only the "Exercise" column (x≈330–840); the ID, Topic and Min columns are not exercise text.
    exercise_col = [l for l in body if 300 < l.x < 840]
    deck.exercise_shingles |= shingles(" ".join(l.text for l in exercise_col))
    return {l.text for l in body if re.fullmatch(r"B\d{2}", l.text)}


def _parse_extra(lines: list[Line], index: int, deck: ModuleDeck) -> None:
    title = next((l.text for l in lines if 45 <= l.y <= 75 and l.size >= 20), "")
    text = _clean(" ".join(l.text for l in sorted(lines, key=lambda l: (round(l.y / 3), l.x)) if l.y > 75))
    deck.extras.append({"title": title, "text": text, "page": index + 1})


# ---------------------------------------------------------------- entry point
def parse_deck(path: str) -> ModuleDeck:
    deck = ModuleDeck(source_file=str(path))
    glance: dict[str, dict] = {}
    table_codes: set[str] = set()
    for i, page in enumerate(extract_pages(path, laparams=LAParams())):
        lines, fills = _page_content(page)
        kind = _page_type(i, lines)
        deck.page_types.append(kind)
        if kind == "cover":
            _parse_cover(lines, deck)
        elif kind == "glance":
            glance = _parse_glance(lines)
        elif kind == "topic":
            deck.topics.append(_parse_topic(page, lines, fills, i, deck))
        elif kind == "closing":
            _parse_closing(lines, deck)
        elif kind == "exercises_table":
            table_codes = _parse_exercises_table(lines, deck)
        else:
            _parse_extra(lines, i, deck)

    for t in deck.topics:
        t.minutes = glance.get(t.code, {}).get("minutes")
        t.has_exercise = t.has_exercise or t.code in table_codes
    # The guard must only flag wording unique to exercises, never legitimate slide content.
    deck.exercise_shingles -= shingles(" ".join(indexable_texts(deck)))
    _validate(deck, glance)
    return deck


def indexable_texts(deck: ModuleDeck) -> list[str]:
    texts = [deck.description, deck.next_text, deck.takeaway, *deck.after_module]
    texts += [e["text"] for e in deck.extras]
    for t in deck.topics:
        texts += [t.title, t.outcome, *t.bullets, *t.diagram]
    return [t for t in texts if t]


def _validate(deck: ModuleDeck, glance: dict[str, dict]) -> None:
    p = deck.problems
    if not deck.module_name:
        p.append("cover: module name not found")
    codes = [t.code for t in deck.topics]
    if set(codes) != set(glance):
        p.append(f"glance topics {sorted(glance)} != topic slides {codes}")
    if deck.cover_topics is not None and deck.cover_topics != len(codes):
        p.append(f"cover says {deck.cover_topics} topics, found {len(codes)}")
    total = sum(t.minutes or 0 for t in deck.topics)
    if deck.cover_minutes is not None and total != deck.cover_minutes:
        p.append(f"topic minutes add to {total}, cover says {deck.cover_minutes}")
    for t in deck.topics:
        if not t.outcome:
            p.append(f"{t.code}: no outcome")
        if not t.bullets:
            p.append(f"{t.code}: no bullets")
        bad = {r: v for r, v in t.roles.items() if v.startswith("unknown")}
        if bad:
            p.append(f"{t.code}: unknown chip colours {bad}")
