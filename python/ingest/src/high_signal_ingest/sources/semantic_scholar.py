"""Semantic Scholar Graph API adapter.

Public, rate-limited research-paper search over a curated set of AI hardware,
inference, datacenter, and frontier-model queries. This is a research weak
signal and corroboration lane, not a replacement for the Lab paper pipeline.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 semantic-scholar-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
FIELDS = ",".join(
    [
        "paperId",
        "title",
        "abstract",
        "url",
        "year",
        "publicationDate",
        "authors",
        "citationCount",
        "isOpenAccess",
        "openAccessPdf",
    ]
)


@dataclass(frozen=True)
class PaperQuery:
    query: str
    entity_id: str | None = None


QUERIES = [
    PaperQuery("large language model inference gpu datacenter", "NVDA"),
    PaperQuery("mixture of experts inference serving"),
    PaperQuery("high bandwidth memory artificial intelligence accelerator", "SK_HYNIX"),
    PaperQuery("photonic computing transformer accelerator", "LIGHTMATTER"),
    PaperQuery("ai datacenter power cooling efficiency"),
]


def _parse_date(value: str | None, year: int | None = None) -> datetime:
    if value:
        try:
            return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if year:
        return datetime(year, 1, 1, tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def events_from_response(
    query: PaperQuery, payload: dict[str, Any], since: datetime
) -> list[Event]:
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        paper_id = str(row.get("paperId") or "").strip()
        title = str(row.get("title") or "").strip()
        url = str(row.get("url") or f"https://www.semanticscholar.org/paper/{paper_id}").strip()
        published = _parse_date(row.get("publicationDate"), row.get("year"))
        if not paper_id or not title or published < since:
            continue
        authors = row.get("authors") if isinstance(row.get("authors"), list) else []
        author_names = ", ".join(
            str(author.get("name") or "").strip()
            for author in authors[:5]
            if isinstance(author, dict) and author.get("name")
        )
        abstract = str(row.get("abstract") or "").strip()
        citation_count = row.get("citationCount")
        content = "\n".join(
            part
            for part in [
                f"Query: {query.query}",
                f"Authors: {author_names}" if author_names else "",
                f"Citations: {citation_count}" if citation_count is not None else "",
                abstract,
            ]
            if part
        )
        raw_hash = event_hash("semantic-scholar", query.query, paper_id)
        out.append(
            Event(
                id=raw_hash[:16],
                source="semantic-scholar",
                source_url=url,
                published_at=published,
                title=f"Research paper: {title}",
                content=content[:20_000] or None,
                primary_entity_id=query.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 30, queries: list[PaperQuery] | None = None) -> list[Event]:
    year_floor = datetime.now(timezone.utc).year - 1
    since = datetime.now(timezone.utc).replace(year=year_floor, month=1, day=1)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    if api_key:
        headers["x-api-key"] = api_key
    out: list[Event] = []
    with httpx.Client(headers=headers, timeout=20.0, follow_redirects=True) as client:
        for query in queries or QUERIES:
            try:
                response = client.get(
                    API_URL,
                    params={
                        "query": query.query,
                        "limit": 10,
                        "fields": FIELDS,
                        "year": f"{year_floor}-",
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("semantic scholar fetch failed query=%s error=%s", query.query, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(query, payload, since))
    return out
