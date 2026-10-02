"""Route each question to the right answer source.

greeting        fixed welcome
about           who the assistant is and what it can do (name from BOT_NAME)
exercise_quiz   fixed reply: the module has exercises and a quiz; nothing else is revealed
list_courses    catalog (SQLite)
list_modules    catalog
module_overview catalog
topic_overview  catalog
duration        catalog
content         hybrid search + LLM, grounded and short
not_covered     nothing relevant found: say so and list the courses on offer
stopped         the learner pressed Stop while the LLM was answering

Catalog answers never pass through the LLM, so it cannot invent a course or module.
Every reply carries a trace (steps, timings, chunks used, tokens) for the RAG details panel.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field

import config
from app import llm
from app.catalog import Catalog, Mentions, get_catalog
from app.retrieval import search, terms
from app.trace import Trace

GREETING = re.compile(r"^\s*(hi|hello|hey|salam|assalam\w*|good (morning|afternoon|evening)|thanks?( you)?|thank you)\W*$", re.I)
# Questions about the bot itself. The whole message must be one of these (an optional "hi" in
# front is fine), so a course question that merely contains "you" never lands here.
ABOUT_BOT = re.compile(
    r"^\W*((hi|hello|hey|salam)\W+)?("
    r"what('?s| is) your name|your name|who are you|who r u|what are you|introduce yourself|"
    r"tell me about yourself|what can you (do|help( me)? with)|how can you help( me)?|"
    r"what do you do|what are you for|help|are you (a |an )?(bot|robot|human|ai|person|real|chatbot)"
    r")\W*$", re.I)
EXERCISE_WORDS = re.compile(r"\b(exercises?|quiz(zes)?|mcqs?|assignments?|homework|practice questions?|test questions?)\b", re.I)
ANSWER_WORDS = re.compile(r"\b(answers?|solutions?|solve|solved|cheat)\b", re.I)
LIST_COURSES = re.compile(
    r"(\b(list|show)\b.*\bcourses\b|\b(what|which)\s+courses\s+(do you|are|can|exist|does)\b|"
    r"\b(available|all)\s+courses\b|\bcourses\s+(do you|are)\s+(have|offer|available|there)\b|"
    r"^\s*courses\??\s*$)", re.I)
MODULE_WORDS = re.compile(r"\b(modules?|syllabus|outline|structure|curriculum|contents?)\b", re.I)
OVERVIEW_WORDS = re.compile(r"\b(about|cover|covers|covered|topics?|overview|what is in|what's in|teach|learn)\b", re.I)
DURATION_WORDS = re.compile(r"\b(how long|duration|minutes|hours|time does|time will|length)\b", re.I)

# Words that don't count as a new subject in a follow-up, as search stems ("minutes" → "minut").
FOLLOW_UP_TERMS = set(terms("long duration hour hours minute minutes time quiz quizzes exercise exercises"))

WELCOME = ("Hi! I can tell you what our courses cover, which modules and topics they contain, "
           "and where to find a subject. What would you like to know?")
NO_CATALOG = "I couldn't find that in our courses."
LMS_SOURCE = "LMS course data"


@dataclass
class Reply:
    text: str
    intent: str
    sources: list[dict] = field(default_factory=list)
    trace: dict = field(default_factory=dict)


# ------------------------------------------------------------------ formatting helpers
def _where(cat: Catalog, m: dict, code: str | None = None) -> str:
    course = cat.course(m["course_id"])["title"]
    return f"{course} → {m['title']}" + (f", topic {code}" if code else "")


def _course_list(cat: Catalog) -> str:
    lines = []
    for c in cat.courses():
        n = len(cat.modules(c["id"]))
        lines.append(f"• {c['title']}" + (f" ({n} modules)" if n else ""))
    return "\n".join(lines)


def _module_list(cat: Catalog, course: dict) -> str:
    mods = cat.modules(course["id"])
    if not mods:
        return (f"{course['title']} is available on the platform, but I don't have its module "
                f"details yet. Please check the course page.")
    lines = [f"{course['title']} has {len(mods)} modules:"]
    for i, m in enumerate(mods, 1):
        extra = f" — {m['topic_count']} topics, {m['total_minutes']} min" if m["has_material"] else ""
        lines.append(f"{i}. {m['title']}{extra}")
    return "\n".join(lines)


def _module_overview(cat: Catalog, m: dict) -> str:
    if not m["has_material"]:
        return f"{_where(cat, m)} is listed on the platform, but I don't have its material yet."
    topics = cat.topics(m["id"])
    lines = [f"{m['title']} ({cat.course(m['course_id'])['title']}) — {m['topic_count']} topics, "
             f"about {m['total_minutes']} minutes.", m["description"] or "", "", "Topics:"]
    lines += [f"• {t['code']} {t['title']} ({t['minutes']} min)" for t in topics]
    lines += ["", "It also includes exercises and a quiz, which you'll find on the course page."]
    return "\n".join(l for l in lines if l is not None)


def _topic_overview(cat: Catalog, t: dict) -> str:
    m = cat.module(t["module_id"])
    return (f"{t['code']} {t['title']} is part of {_where(cat, m)} ({t['minutes']} min). "
            f"After it, learners can: {t['outcome']}\n\n"
            f"For the full lesson, open {m['title']} on the course page.")


# ------------------------------------------------------------------ sources
def _module_source(cat: Catalog, m: dict, code: str | None = None, page: int | None = None) -> dict:
    return {"course_title": cat.course(m["course_id"])["title"], "module_title": m["title"],
            "topic_code": code or "", "page": page or (1 if m["source_file"] else 0),
            "file": m["source_file"] or LMS_SOURCE}


def _catalog_sources(cat: Catalog, found: Mentions) -> list[dict]:
    if found.topics:
        return [_module_source(cat, cat.module(t["module_id"]), t["code"], t["page"]) for t in found.topics]
    if found.modules:
        return [_module_source(cat, m) for m in found.modules]
    if found.course:
        return [{"course_title": found.course["title"], "module_title": "", "topic_code": "",
                 "page": 0, "file": LMS_SOURCE}]
    return []


def _hit_source(cat: Catalog, meta: dict) -> dict:
    file = cat.module(meta["module_id"])["source_file"] if meta["module_id"] else None
    return {**{k: meta.get(k) for k in ("course_title", "module_title", "topic_code", "page")},
            "file": file or LMS_SOURCE}


# ------------------------------------------------------------------ main entry
def respond(message: str, history: list[dict] | None = None, cancel: threading.Event | None = None) -> Reply:
    """`cancel` is set when the learner presses Stop (the browser closes the request)."""
    history = history or []
    trace = Trace(models={"llm": config.LLM_MODEL, "embedding": config.EMBEDDING_MODEL
                          if config.EMBEDDING_BACKEND == "api" else config.EMBEDDING_BACKEND})
    reply = _route(message, history, trace, cancel)
    reply.trace = trace.to_dict()
    return reply


def _route(message: str, history: list[dict], trace: Trace, cancel: threading.Event | None = None) -> Reply:
    cat = get_catalog()
    text = message.strip()[: config.MAX_QUESTION_CHARS]

    def done(reply_text: str, intent: str, rule: str, sources: list[dict] | None = None) -> Reply:
        trace.steps.append({"tool": "router", "intent": intent, "rule": rule, "ms": 0.0})
        return Reply(reply_text, intent, sources or [])

    if not text or GREETING.match(text):
        return done(WELCOME, "greeting", "greeting pattern")
    if ABOUT_BOT.match(text):
        return done(_about_reply(cat), "about", "question about the assistant")

    with trace.step("catalog.find", source="catalog.db") as s:
        found = cat.find(text)
        # Follow-ups with no subject of their own ("how long is it?", "and the quiz?") reuse what the
        # previous question named. A message that names a new subject ("and the agent loop?") does not.
        own_subject = set(terms(text)) - FOLLOW_UP_TERMS
        if found.empty and not own_subject:
            prev = next((h["content"] for h in reversed(history) if h.get("role") == "user"), "")
            if prev:
                found = cat.find(prev)
                s["follow_up_of"] = prev[:120]
        s.update(course=found.course["title"] if found.course else None,
                 modules=[m["title"] for m in found.modules], topics=[t["code"] for t in found.topics])

    sources = _catalog_sources(cat, found)

    # 1. Exercises and quizzes: confirm they exist, reveal nothing else.
    if EXERCISE_WORDS.search(text) or (ANSWER_WORDS.search(text) and (found.topics or found.modules)):
        return done(_exercise_reply(cat, found), "exercise_quiz", "exercise/quiz words", sources)

    # 2. Catalog questions
    if LIST_COURSES.search(text):
        return done("Here are the courses currently available:\n" + _course_list(cat), "list_courses",
                    "list-courses pattern", [{"course_title": c["title"], "module_title": "", "topic_code": "",
                                              "page": 0, "file": LMS_SOURCE} for c in cat.courses()])
    if DURATION_WORDS.search(text) and not found.empty:
        return done(_duration_reply(cat, found), "duration", "duration words + catalog match", sources)
    if found.topics and not found.modules and len(found.topics) == 1:
        return done(_topic_overview(cat, found.topics[0]), "topic_overview", "one topic code", sources)
    if found.modules and (OVERVIEW_WORDS.search(text) or MODULE_WORDS.search(text) or len(text.split()) <= 4):
        return done("\n\n".join(_module_overview(cat, m) for m in found.modules), "module_overview",
                    "module named", sources)
    if found.course and (MODULE_WORDS.search(text) or OVERVIEW_WORDS.search(text) or len(text.split()) <= 4):
        intro = f"{found.course['title']}: {found.course['description']}\n\n" if found.course["description"] else ""
        return done(intro + _module_list(cat, found.course), "list_modules", "course named", sources)
    if MODULE_WORDS.search(text) and re.search(r"\b(what|which|list|show|how many)\b", text, re.I) \
            and not OVERVIEW_WORDS.search(text):
        return done("\n\n".join(_module_list(cat, c) for c in cat.courses()), "list_modules",
                    "module-list words", sources)

    # 3. Content questions: grounded search + LLM
    trace.steps.append({"tool": "router", "intent": "content", "rule": "no catalog rule matched", "ms": 0.0})
    return _content_reply(cat, text, found, history, trace, cancel)


def _about_reply(cat: Catalog) -> str:
    courses = ", ".join(c["title"] for c in cat.courses())
    return (f"I'm {config.BOT_NAME}, an assistant for the courses on this training platform. "
            "I'm an AI, not a person.\n\n"
            "I can:\n"
            "• list the courses, their modules and topics, and how long they take\n"
            "• give a short overview of what a module or topic covers\n"
            "• point you to where a subject is taught (course → module → topic)\n\n"
            "I don't teach topics in depth or share exercise or quiz answers; for that, open the course itself. "
            f"Courses available right now: {courses}.")


def _exercise_reply(cat: Catalog, found: Mentions) -> str:
    tail = ("I can't share exercise or quiz questions or answers, but I'm happy to tell you "
            "what the module covers.")
    # Exercises and quizzes belong to a module, not to a topic.
    if found.topics:
        t = found.topics[0]
        m = cat.module(t["module_id"])
        return (f"Topic {t['code']} {t['title']} is part of {_where(cat, m)}. That module includes exercises "
                f"and a quiz, which you'll find on the course page. {tail}")
    if found.modules:
        names = ", ".join(_where(cat, m) for m in found.modules)
        return f"Yes — {names} includes exercises and a quiz. You'll find them on the course page. {tail}"
    return f"Each module includes exercises and a quiz, which you'll find on its course page. {tail}"


def _duration_reply(cat: Catalog, found: Mentions) -> str:
    if found.topics:
        t = found.topics[0]
        return f"{t['code']} {t['title']} takes about {t['minutes']} minutes ({_where(cat, cat.module(t['module_id']))})."
    if found.modules:
        return "\n".join(f"{_where(cat, m)}: about {m['total_minutes']} minutes across {m['topic_count']} topics."
                         if m["has_material"] else f"{_where(cat, m)}: I don't have its duration yet."
                         for m in found.modules)
    mods = [m for m in cat.modules(found.course["id"]) if m["has_material"]]
    if not mods:
        return f"I don't have the duration of {found.course['title']} yet. Please check the course page."
    total = sum(m["total_minutes"] for m in mods)
    return (f"The modules of {found.course['title']} I have material for add up to about {total} minutes "
            f"(roughly {total / 60:.1f} hours) of topic time.")


def _content_reply(cat: Catalog, text: str, found: Mentions, history: list[dict], trace: Trace,
                   cancel: threading.Event | None = None) -> Reply:
    module_ids = [m["id"] for m in found.modules] or None
    with trace.step("hybrid_search", scope=[m["title"] for m in found.modules] or "all modules") as s:
        hits = search(text, module_ids=module_ids, info=s)
    trace.chunks = [{**_hit_source(cat, h.meta), "kind": h.meta["kind"], "vector": round(h.score, 3),
                     "bm25": round(h.keyword, 2), "fused": round(h.fused, 4), "matched": list(h.matched),
                     "text": h.text} for h in hits]
    if not hits:
        trace.fallback = "no course material passed the relevance gate"
        return Reply(f"{NO_CATALOG} Here's what we currently offer:\n{_course_list(cat)}\n\n"
                     "Ask me about any of these and I'll tell you what it covers.", "not_covered")

    sources = [_hit_source(cat, h.meta) for h in hits]
    with trace.step("llm.generate", model=config.LLM_MODEL, context_chunks=len(hits),
                    context_chars=len(llm.build_context([h.text for h in hits])),
                    timeout_s=config.LLM_TIMEOUT_SECONDS) as s:
        result = llm.answer(text, [h.text for h in hits], history, cancel)
        s["ok"] = result is not None
    if cancel is not None and cancel.is_set():
        trace.fallback = "stopped by the learner"
        return Reply("Stopped.", "stopped", sources)
    if result is not None:
        trace.tokens = result.tokens
    if result is None:
        trace.fallback = "LLM unreachable or timed out: answered from the catalog"
        reply = _extractive(cat, hits)               # LLM down: still answer from the catalog
    elif "NOT_COVERED" in result.text:
        trace.fallback = "LLM found the material does not answer the question"
        return Reply(f"{NO_CATALOG} Here's what we currently offer:\n{_course_list(cat)}", "not_covered")
    else:
        reply = result.text
    with trace.step("exercise_guard", hashes=cat.guard_size) as s:
        blocked = cat.leaks_exercise_text(reply)
        s["result"] = "blocked" if blocked else "passed"
    if blocked:
        trace.fallback = "reply matched exercise wording and was replaced"
        reply = _extractive(cat, hits)               # never let exercise wording through
    return Reply(reply, "content", sources)


def _extractive(cat: Catalog, hits) -> str:
    """Fallback without the LLM: prefer a specific topic among the top 3 hits."""
    hit = next((h for h in hits[:3] if h.meta["kind"] == "topic" and h.keyword > 0), hits[0])
    meta = hit.meta
    if meta["kind"] == "topic":
        t = next(t for t in cat.topics(meta["module_id"]) if t["code"] == meta["topic_code"])
        return _topic_overview(cat, t)
    if meta["kind"] in {"module", "extra"}:
        m = cat.module(meta["module_id"])
        return f"This is covered in {_where(cat, m)}. {m['description'] or ''}".strip()
    return f"This is covered in {meta['course_title']}. Ask me about its modules for more detail."
