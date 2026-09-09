"""Bounded read-only context retrieval for fresh issuer announcements."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from . import audit
from .digg_verify import title_alignment
from .extract.entities import gazetteer_match
from .types import Event, SourceDocument
from .utils import event_hash

MAX_LOOKUPS = 6


def _retained_event(row: object, title: str, now: datetime) -> Event | None:
    if not isinstance(row, dict):
        return None
    url, text, source = row.get("url"), row.get("retainedContent"), row.get("retainedSource")
    headline, date = row.get("title"), row.get("seendate")
    if not all(isinstance(value, str) for value in [url, text, source, headline, date]):
        return None
    if len(text) < 500 or title_alignment(title, headline) < 0.6:
        return None
    try:
        parsed = urlsplit(url)
        published = datetime.fromisoformat(date.replace("Z", "+00:00"))
        if not published.tzinfo or not now - timedelta(days=3) <= published <= now:
            return None
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    raw_hash = event_hash(source, url, date, text)
    return Event(
        id=raw_hash[:16],
        source=source,
        source_url=url,
        title=headline,
        published_at=published,
        content=text[:30_000],
        raw_hash=raw_hash,
        source_document=SourceDocument(
            canonical_url=url,
            published_at=published,
            raw_text=text[:30_000],
            parsed_fields={"retrievedFrom": "retained_corpus"},
        ),
    )


def load_retained_corroboration(events: list[Event]) -> tuple[list[Event], dict[str, int]]:
    metrics = {
        "related_evidence_lookups": 0,
        "related_evidence_failures": 0,
        "related_events_loaded": 0,
    }
    seen_entities: set[str] = set()
    seen_urls = {event.source_url for event in events}
    related: list[Event] = []
    now = datetime.now(timezone.utc)
    for event in sorted(events, key=lambda item: item.published_at, reverse=True):
        metadata = event.source_document.parsed_fields if event.source_document else {}
        if not metadata or metadata.get("documentKind") != "issuer_announcement":
            continue
        if not event.primary_entity_id or event.primary_entity_id in seen_entities:
            continue
        if not event.title or not 20 <= len(event.title) <= 400:
            continue
        if metrics["related_evidence_lookups"] >= MAX_LOOKUPS:
            break
        seen_entities.add(event.primary_entity_id)
        metrics["related_evidence_lookups"] += 1
        payload = audit.fetch_related_evidence(event.title)
        if payload is None or not isinstance(payload.get("evidence"), list):
            metrics["related_evidence_failures"] += 1
            continue
        for row in payload["evidence"][:50]:
            retained = _retained_event(row, event.title, now)
            if retained and retained.source_url not in seen_urls:
                if event.primary_entity_id in gazetteer_match(retained.title or ""):
                    retained.primary_entity_id = event.primary_entity_id
                seen_urls.add(retained.source_url)
                related.append(retained)
    metrics["related_events_loaded"] = len(related)
    return related, metrics
