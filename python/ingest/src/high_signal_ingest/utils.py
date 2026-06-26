"""Small shared helpers used across the analysis layer (dedupe / grouping /
opportunities / data_directory / pipeline). Kept dependency-light (only `types`)
so any module can import it without a cycle."""

from __future__ import annotations

from .types import Event


def source_family(source: str) -> str:
    """Collapse a source id to its family: ``legistar:phoenix`` → ``legistar``,
    ``macro-rates:fred:dgs10`` → ``macro-rates``."""
    return (source or "unknown").split(":", 1)[0]


def event_text(ev: Event, max_content_chars: int = 600) -> str:
    """The standard text blob for matching/classification — title plus a bounded
    slice of content. One definition so every caller uses the same shape."""
    return f"{ev.title or ''}\n{(ev.content or '')[:max_content_chars]}"
