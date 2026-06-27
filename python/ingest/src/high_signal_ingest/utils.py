"""Small shared helpers used across the analysis layer (dedupe / grouping /
opportunities / data_directory / pipeline). Kept dependency-light (only `types`)
so any module can import it without a cycle."""

from __future__ import annotations

import calendar
import hashlib
from datetime import datetime, timezone

from .types import Event


def event_hash(*parts: str) -> str:
    """Deterministic dedup-key hash for an event — SHA256 over ␟-joined parts.
    Shared so every source adapter uses the identical scheme."""
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse an ISO-8601 datetime (tolerating a trailing ``Z`` and date-only
    forms) and normalise to UTC. Returns None on failure."""
    if not value:
        return None
    for candidate in (value[:19].replace("Z", "+00:00"), value[:10]):
        try:
            dt = datetime.fromisoformat(candidate)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def rss_published(entry: object) -> datetime | None:
    """UTC publish time of a feedparser entry, using its pre-normalised
    ``*_parsed`` struct_time (handles RFC822 and ISO-8601 uniformly)."""
    st = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not st:
        return None
    return datetime.fromtimestamp(calendar.timegm(st), tz=timezone.utc)


def source_family(source: str) -> str:
    """Collapse a source id to its family: ``legistar:phoenix`` → ``legistar``,
    ``macro-rates:fred:dgs10`` → ``macro-rates``."""
    return (source or "unknown").split(":", 1)[0]


def event_text(ev: Event, max_content_chars: int = 600) -> str:
    """The standard text blob for matching/classification — title plus a bounded
    slice of content. One definition so every caller uses the same shape."""
    return f"{ev.title or ''}\n{(ev.content or '')[:max_content_chars]}"
