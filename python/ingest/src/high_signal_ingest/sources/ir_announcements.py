"""Bounded retrieval of explicitly dated announcements from an issuer page."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urldefrag

import httpx

from ..types import Event, SourceDocument
from ..utils import event_hash

MAX_ANNOUNCEMENTS = 3
RELEASE_PATH = re.compile(r"/(?:news-release-details|press-releases?|news-releases?)/.+", re.I)


class _PageMetadata(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.dates: list[str] = []
        self.json_blocks: list[str] = []
        self._json = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.links.append(str(values["href"]))
        if tag == "meta" and (values.get("property") or values.get("itemprop")) in {
            "article:published_time",
            "datePublished",
        }:
            self.dates.append(values.get("content") or "")
        if tag == "script" and values.get("type") == "application/ld+json":
            self._json = True
            self.json_blocks.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._json = False

    def handle_data(self, data: str) -> None:
        if self._json:
            self.json_blocks[-1] += data


def announcement_links(html: str, page_url: str) -> list[str]:
    page = _PageMetadata()
    page.feed(html)
    origin = urlsplit(page_url)
    links: list[str] = []
    for href in page.links:
        url = urldefrag(urljoin(page_url, href))[0]
        parsed = urlsplit(url)
        if (
            parsed.scheme == "https"
            and parsed.netloc == origin.netloc
            and RELEASE_PATH.search(parsed.path)
            and url != urldefrag(page_url)[0]
            and url not in links
        ):
            links.append(url)
    return links[:MAX_ANNOUNCEMENTS]


def _json_dates(value: object) -> list[str]:
    if isinstance(value, list):
        return [date for item in value for date in _json_dates(item)]
    if not isinstance(value, dict):
        return []
    date = value.get("datePublished")
    return ([date] if isinstance(date, str) else []) + _json_dates(value.get("@graph"))


def _published_date(html: str) -> datetime | None:
    page = _PageMetadata()
    page.feed(html)
    for block in page.json_blocks:
        try:
            page.dates.extend(_json_dates(json.loads(block)))
        except ValueError:
            continue
    for value in page.dates:
        try:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return date.replace(tzinfo=date.tzinfo or timezone.utc).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def announcement_event(entity_id: str, url: str, html: str, now: datetime) -> Event | None:
    import trafilatura

    published = _published_date(html)
    if published is None or not now - timedelta(days=3) <= published <= now:
        return None
    doc = trafilatura.bare_extraction(html, url=url, include_comments=False, with_metadata=True)
    if doc is None or not doc.title or not doc.text or len(doc.text) < 500:
        return None
    text = doc.text[:30_000]
    raw_hash = event_hash("ir-announcement", entity_id, url, text)
    return Event(
        id=raw_hash[:16],
        source=f"ir:{entity_id}",
        source_url=url,
        published_at=published,
        title=doc.title,
        content=text,
        primary_entity_id=entity_id,
        raw_hash=raw_hash,
        source_document=SourceDocument(
            canonical_url=url,
            fetched_at=now,
            published_at=published,
            raw_hash=raw_hash,
            raw_text=text,
            parsed_fields={
                "documentKind": "issuer_announcement",
                "dateBasis": "explicit_publication_metadata",
            },
        ),
    )


async def retrieve_announcements(
    entity_id: str, page_url: str, html: str, client: httpx.AsyncClient
) -> list[Event]:
    events: list[Event] = []
    now = datetime.now(timezone.utc)
    for url in announcement_links(html, page_url):
        try:
            response = await client.get(url, follow_redirects=False)
            response.raise_for_status()
            if urlsplit(str(response.url)).netloc != urlsplit(page_url).netloc:
                continue
            event = await asyncio.to_thread(
                announcement_event, entity_id, str(response.url), response.text, now
            )
            if event:
                events.append(event)
        except (httpx.HTTPError, ValueError):
            continue
    return events
