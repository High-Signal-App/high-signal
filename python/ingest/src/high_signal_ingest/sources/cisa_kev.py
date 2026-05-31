"""CISA Known Exploited Vulnerabilities adapter.

KEV is intentionally narrower than NVD: it only tracks vulnerabilities CISA
has accepted as exploited in the wild. Treat these as high-quality security
risk candidates, not a broad CVE firehose.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Iterator

import httpx

from ..seed import load_entities
from ..types import Event


USER_AGENT = "high-signal/0.1 cisa-kev-ingest"
LOGGER = logging.getLogger(__name__)
CATALOG_URL = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
JSON_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_date_added(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        LOGGER.debug("cisa kev invalid dateAdded=%s", value)
        return None


def _catalog_url(cve_id: str) -> str:
    return f"{CATALOG_URL}?search_api_fulltext={cve_id}"


def _notes_urls(notes: str) -> list[str]:
    return re.findall(r"https?://[^\s;,)]+", notes or "")


@lru_cache(maxsize=1)
def _exact_entity_terms() -> dict[str, str]:
    out: dict[str, str] = {}
    for entity in load_entities():
        terms = [entity.name, *entity.aliases]
        for term in terms:
            normalized = term.strip().lower()
            if len(normalized) >= 4:
                out[normalized] = entity.id
    return out


def _resolve_primary_entity(vendor: str, product: str) -> str | None:
    terms = _exact_entity_terms()
    for value in (vendor, product):
        entity_id = terms.get(value.strip().lower())
        if entity_id:
            return entity_id
    return None


def event_from_vulnerability(row: dict[str, Any]) -> Event | None:
    cve_id = str(row.get("cveID") or "").strip()
    published_at = _parse_date_added(str(row.get("dateAdded") or ""))
    if not cve_id or published_at is None:
        return None

    vendor = str(row.get("vendorProject") or "").strip()
    product = str(row.get("product") or "").strip()
    name = str(row.get("vulnerabilityName") or "").strip()
    description = str(row.get("shortDescription") or "").strip()
    action = str(row.get("requiredAction") or "").strip()
    due_date = str(row.get("dueDate") or "").strip()
    ransomware = str(row.get("knownRansomwareCampaignUse") or "").strip()
    cwes = row.get("cwes") or []
    cwe_text = ", ".join(str(cwe) for cwe in cwes if cwe)
    note_urls = _notes_urls(str(row.get("notes") or ""))

    title_parts = [part for part in [vendor, product, name or cve_id] if part]
    title = " / ".join(title_parts)
    content_parts = [
        f"CVE: {cve_id}",
        f"Vendor/project: {vendor}" if vendor else "",
        f"Product: {product}" if product else "",
        f"Known ransomware campaign use: {ransomware}" if ransomware else "",
        f"Due date: {due_date}" if due_date else "",
        f"CWE: {cwe_text}" if cwe_text else "",
        description,
        f"Required action: {action}" if action else "",
        f"References: {' '.join(note_urls)}" if note_urls else "",
    ]
    content = "\n".join(part for part in content_parts if part)
    raw_hash = _hash("cisa-kev", cve_id, str(row.get("dateAdded") or ""))

    return Event(
        id=raw_hash[:16],
        source="cisa-kev",
        source_url=_catalog_url(cve_id),
        published_at=published_at,
        title=f"CISA KEV: {title}",
        content=content[:20_000] or None,
        primary_entity_id=_resolve_primary_entity(vendor, product),
        raw_hash=raw_hash,
    )


def fetch_all(days: int = 7, url: str = JSON_URL) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        response = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=20.0)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("cisa kev fetch failed error=%s", exc)
        return []

    events: list[Event] = []
    for row in payload.get("vulnerabilities", []):
        if not isinstance(row, dict):
            continue
        event = event_from_vulnerability(row)
        if event is None or event.published_at < since:
            continue
        events.append(event)
    return events


def fetch_recent(days: int = 7) -> Iterator[Event]:
    yield from fetch_all(days=days)
