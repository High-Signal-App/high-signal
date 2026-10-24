"""Bounded read-only context retrieval for fresh issuer announcements."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from . import audit
from .dedupe import canonical_url
from .digg_verify import title_alignment
from .extract.entities import event_entity_ids
from .types import Event, SourceDocument
from .story_match import match_story
from .utils import event_hash

MAX_LOOKUPS = 24
MAX_STORY_MATCHES = 6
_ROUTINE_EARNINGS_NOTICE = re.compile(
    r"\bto (?:report|release|announce)\b.*\b(?:results|earnings)\b"
    r"|\bannounces?\b.*\b(?:timing|availability|schedule)\b.*\b(?:results|earnings)\b"
    r"|\b(?:schedules?|announces?)\b.*\b(?:earnings|results)\s+(?:call|conference|date)\b"
    r"|\bto (?:host|hold|webcast)\b.*\b(?:conference|earnings|results)\s+call\b"
    r"|\b(?:earnings|results)\s+(?:\d{4}\s+)?date\s*(?:&(?:amp;)?|and)\s*time\b"
    r"|\b(?:earnings|results)\s+(?:preview|announcement\s+schedule)\b",
    re.I,
)
_MATCH_FAILURES = {
    "model_unavailable",
    "audit_unavailable",
    "invalid_response",
    "invalid_event_description",
    "invalid_passage_selection",
}


def _retained_event(row: object, title: str, now: datetime) -> Event | None:
    if not isinstance(row, dict):
        return None
    url, text, source = row.get("url"), row.get("retainedContent"), row.get("retainedSource")
    headline, date = row.get("title"), row.get("seendate")
    if not all(isinstance(value, str) for value in [url, text, source, headline, date]):
        return None
    # Broad research recall; the audited same-event matcher below decides
    # association. This threshold never grants claim support.
    if len(text) < 500 or title_alignment(title, headline) < 0.25:
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


def _issuer_compatible(announcement: Event, candidate: Event) -> bool:
    # Research for one issuer must not spend its budget on another company's
    # earnings merely because both titles contain "quarter" and "results".
    # Use the title and tight lead, as entity attribution does; distant related
    # article rails and spillover companies do not establish issuer relevance.
    return announcement.primary_entity_id in event_entity_ids(candidate.title, candidate.content)


def _admit_retained_rows(
    rows: list[object],
    event: Event,
    now: datetime,
    candidates: dict[tuple[str, str], tuple[float, Event, Event]],
    metrics: dict[str, int],
) -> None:
    """Admit issuer-relevant rows and keep the fullest record for each URL pair."""
    announcement_url = canonical_url(event.source_url)
    for row in rows:
        retained = _retained_event(row, event.title, now)
        if not retained:
            continue
        candidate_url = canonical_url(retained.source_url)
        if candidate_url == announcement_url:
            continue
        if not _issuer_compatible(event, retained):
            metrics["related_candidates_rejected_entity"] += 1
            continue
        pair = (announcement_url, candidate_url)
        candidate = (title_alignment(event.title, retained.title or ""), event, retained)
        previous = candidates.get(pair)
        if previous:
            metrics["related_candidate_pairs_deduplicated"] += 1
        # Several feeds can retain one URL. Compare that pair once, using
        # its fullest eligible retained body rather than the first wrapper.
        if not previous or len(retained.content or "") > len(previous[2].content or ""):
            candidates[pair] = candidate


def _research_candidates(
    events: list[Event], metrics: dict[str, int]
) -> list[tuple[float, Event, Event]]:
    seen_announcements: set[str] = set()
    candidates: dict[tuple[str, str], tuple[float, Event, Event]] = {}
    now = datetime.now(timezone.utc)
    for event in sorted(events, key=lambda item: item.published_at, reverse=True):
        metadata = event.source_document.parsed_fields if event.source_document else {}
        if not metadata or metadata.get("documentKind") != "issuer_announcement":
            continue
        announcement_url = canonical_url(event.source_url)
        if not event.primary_entity_id or announcement_url in seen_announcements:
            continue
        if not event.title or not 20 <= len(event.title) <= 400:
            continue
        if _ROUTINE_EARNINGS_NOTICE.search(event.title):
            metrics["related_seed_notices_skipped"] += 1
            seen_announcements.add(announcement_url)
            continue
        if metrics["related_evidence_lookups"] >= MAX_LOOKUPS:
            break
        seen_announcements.add(announcement_url)
        metrics["related_evidence_lookups"] += 1
        payload = audit.fetch_related_evidence(event.title)
        if payload is None or not isinstance(payload.get("evidence"), list):
            metrics["related_evidence_failures"] += 1
            continue
        _admit_retained_rows(payload["evidence"][:50], event, now, candidates, metrics)
    return list(candidates.values())


def load_retained_corroboration(events: list[Event]) -> tuple[list[Event], dict[str, int]]:
    """Associate research on existing representatives, returning only new URLs.

    Callers supply the exact-URL-deduplicated events and partition by entity
    afterwards. Research anchors grant no semantic proof or origin credit.
    """
    metrics = {
        "related_evidence_lookups": 0,
        "related_evidence_failures": 0,
        "related_events_loaded": 0,
        "related_existing_events_associated": 0,
        "related_story_match_requests": 0,
        "related_story_match_failures": 0,
        "related_seed_notices_skipped": 0,
        "related_candidates_rejected_entity": 0,
        "related_candidate_pairs_deduplicated": 0,
    }
    existing = {canonical_url(event.source_url): event for event in events}
    candidates = _research_candidates(events, metrics)
    related: list[Event] = []
    associated_urls: set[str] = set()
    for _, event, retained in sorted(candidates, key=lambda pair: pair[0], reverse=True):
        url = canonical_url(retained.source_url)
        representative = existing.get(url)
        if url in associated_urls or (representative and representative.research_story_anchor):
            continue
        if metrics["related_story_match_requests"] >= MAX_STORY_MATCHES:
            break
        metrics["related_story_match_requests"] += 1
        matched, reason = match_story(event, retained)
        if reason in _MATCH_FAILURES:
            metrics["related_story_match_failures"] += 1
        if not matched:
            continue
        # Reuse the actual fetched representative without changing its retained
        # text, document receipt or identity. Partitioning afterwards keeps a
        # joint-company report with its accepted issuer research anchor.
        target = representative or retained
        target.primary_entity_id = event.primary_entity_id
        target.research_story_anchor = event.source_url
        associated_urls.add(url)
        if representative:
            metrics["related_existing_events_associated"] += 1
        else:
            related.append(retained)
    metrics["related_events_loaded"] = len(related)
    return related, metrics
