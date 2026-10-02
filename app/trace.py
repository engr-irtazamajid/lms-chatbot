"""What happened while answering one question, for the RAG details panel in the UI.

Only data that is safe for a learner to see goes in here: routing decisions, timings,
which course chunks were used (course material only), token counts and model names.
Exercise text never reaches this object; the guard reports a pass/block flag only.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class Trace:
    steps: list[dict] = field(default_factory=list)
    chunks: list[dict] = field(default_factory=list)
    tokens: dict | None = None
    models: dict = field(default_factory=dict)
    fallback: str | None = None          # why the LLM answer was not used, if it wasn't
    _start: float = field(default_factory=time.perf_counter)

    @contextmanager
    def step(self, tool: str, **detail):
        """Time one pipeline step. Yields its detail dict so the step can add results."""
        t0 = time.perf_counter()
        entry = {"tool": tool, **detail}
        try:
            yield entry
        finally:
            entry["ms"] = round((time.perf_counter() - t0) * 1000, 1)
            self.steps.append(entry)

    def to_dict(self) -> dict:
        return {"steps": self.steps, "chunks": self.chunks, "tokens": self.tokens,
                "models": self.models, "fallback": self.fallback,
                "total_ms": round((time.perf_counter() - self._start) * 1000, 1)}
