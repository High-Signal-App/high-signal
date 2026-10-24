"""Hacker News adapter (Algolia API, free, key-less).

Hacker News is the largest tech / startup discourse signal we weren't ingesting
directly (only inside Lab). The Algolia search API is free and key-less. We pull
recent, well-upvoted stories scoped to the three domains, plus Show HN launches
(a startup / product-launch signal). Company names in titles map to tracked
entities downstream; the rest feeds the technology and startup domains
thematically.

Output: Events tagged `source: hackernews`. No key required.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from typing import Any

import httpx

from ..types import Event, SourceDocument
from ..utils import event_hash, parse_published_datetime
from . import registered_feeds
from .news import _article_receipt, _extract_article_text


USER_AGENT = "high-signal/0.1 hackernews-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://hn.algolia.com/api/v1/search_by_date"
ITEM_URL = "https://news.ycombinator.com/item?id="
MIN_POINTS = 10  # curation floor — skip low-signal noise
PAGES = 2  # At most 200 hits per query; the broad catch-up covers only 24 hours.
MAX_ORIGINALS_PER_REFRESH = 20
ORIGINAL_CONCURRENCY = 4
_SOCIAL_HOSTS = {
    "news.ycombinator.com",
    "hn.algolia.com",
    "x.com",
    "twitter.com",
    "reddit.com",
    "old.reddit.com",
    "facebook.com",
    "instagram.com",
    "threads.net",
    "digg.com",
    "mts.now",
    "nitter.click",  # Observed HN link to an X mirror, not an original publisher.
}

# (query, tag, min_points). tag=story for topical front-page items, show_hn for
# launches (kept at a lower floor since launches start small). Broad coverage
# across the three domains — fetch wide, store lean (title + link + metadata).
QUERIES: tuple[tuple[str, str, int], ...] = (
    ("artificial intelligence", "story", MIN_POINTS),
    ("GPU OR datacenter OR semiconductor OR chip", "story", MIN_POINTS),
    ("startup OR funding OR acquisition OR IPO", "story", MIN_POINTS),
    ("cloud OR infrastructure OR kubernetes", "story", MIN_POINTS),
    ("AI agent OR LLM OR model", "story", MIN_POINTS),
    ("robotics OR autonomous", "story", MIN_POINTS),
    ("crypto OR stablecoin OR fintech", "story", MIN_POINTS),
    ("layoffs OR hiring OR enterprise", "story", 20),
    ("open source", "story", 30),
    ("", "show_hn", 8),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def query_specs(since: datetime, now: datetime) -> list[tuple[str, str, int, datetime]]:
    """Algolia query text is not a boolean OR filter. Search alternatives separately."""
    specs = [("", "story", MIN_POINTS, max(since, now - timedelta(hours=24)))]
    seen = {(query.casefold(), tag, points) for query, tag, points, _ in specs}
    for query, tag, points in QUERIES:
        for alternative in re.split(r"\s+OR\s+", query):
            alternative = alternative.strip()
            key = (alternative.casefold(), tag, points)
            if key not in seen:
                seen.add(key)
                specs.append((alternative, tag, points, since))
    return specs


def events_from_response(
    payload: dict[str, Any], since: datetime, min_points: int = MIN_POINTS
) -> list[Event]:
    hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
    return [event for hit in hits if (event := _event_from_hit(hit, since, min_points)) is not None]


def _event_from_hit(hit: Any, since: datetime, min_points: int) -> Event | None:
    if not isinstance(hit, dict):
        return None
    object_id = str(hit.get("objectID") or "").strip()
    title = str(hit.get("title") or "").strip()
    ts = hit.get("created_at_i")
    if not object_id or not title or not isinstance(ts, (int, float)):
        return None
    published = datetime.fromtimestamp(int(ts), tz=timezone.utc)
    if published < since or published > _now() + timedelta(minutes=5):
        return None
    points = hit.get("points") or 0
    comments = hit.get("num_comments") or 0
    if not isinstance(points, int) or points < min_points:
        return None
    ext_url = str(hit.get("url") or "").strip()
    content = "\n".join(
        part
        for part in [
            f"Points: {points} | Comments: {comments}",
            f"Author: {hit.get('author')}" if hit.get("author") else "",
            f"Link: {ext_url}" if ext_url else "",
            "",
            title,
        ]
        if part != ""
    )
    raw_hash = event_hash("hackernews", object_id)
    return Event(
        id=raw_hash[:16],
        source="hackernews",
        source_url=f"{ITEM_URL}{object_id}",
        published_at=published,
        title=f"HN: {title}",
        content=content[:20_000] or None,
        primary_entity_id=None,
        raw_hash=raw_hash,
        source_document=SourceDocument(
            canonical_url=f"{ITEM_URL}{object_id}",
            published_at=published,
            raw_hash=raw_hash,
            raw_text=content[:20_000],
            parsed_fields={
                "sourceClass": "attention_aggregator",
                "evidenceTier": "derived",
                "confidenceContribution": "none",
                "linkedOriginalUrl": ext_url or None,
                "discussionUrl": f"{ITEM_URL}{object_id}",
                "points": points,
                "commentCount": comments,
            },
        ),
    )


class _OriginalMetadata(HTMLParser):
    """Accept explicit article dates; discovery time is never publication proof."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.published: datetime | None = None
        self.headline: str | None = None
        self.og_title: str | None = None
        self.heading: list[str] = []
        self._in_heading = False
        self._json_script: list[str] | None = None
        self._scope: list[tuple[str, dict[str, str | None]]] = []

    @property
    def title(self) -> str | None:
        value = self.headline or self.og_title or " ".join(self.heading)
        return " ".join(value.split()) if value and len(value) <= 500 else None

    @property
    def title_basis(self) -> str:
        return (
            "article_jsonld" if self.headline else "og_title" if self.og_title else "page_heading"
        )

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        self._remember_scope(tag, values)
        field = str(values.get("property") or values.get("name") or "").lower()
        if tag == "meta" and field == "og:title" and values.get("content"):
            self.og_title = values["content"]
        if tag == "h1" and not self.heading:
            self._in_heading = True
        if tag == "meta" and field in {"article:published_time", "datepublished", "pubdate"}:
            value = values.get("content")
            if value and self.published is None:
                self.published = parse_published_datetime(value)
        if tag == "script" and values.get("type") == "application/ld+json":
            self._json_script = []

    def handle_data(self, data: str) -> None:
        if self._in_heading:
            self.heading.append(data)
        if self._json_script is not None:
            self._json_script.append(data)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self._scope) - 1, -1, -1):
            if self._scope[index][0] == tag:
                self._scope = self._scope[:index]
                break
        if tag == "h1":
            self._in_heading = False
        if tag != "script" or self._json_script is None:
            return
        encoded = "".join(self._json_script)
        self._json_script = None
        try:
            value = json.loads(encoded)
        except (ValueError, RecursionError):
            return
        self._read_article_date(value)

    def _remember_scope(self, tag: str, values: dict[str, str | None]) -> None:
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self._scope.append((tag, values))
        if tag == "time" and self.published is None and self._article_publication_scope():
            self.published = parse_published_datetime(values.get("datetime") or "")

    def _article_publication_scope(self) -> bool:
        # WordPress marks the surrounding metadata element as datePublished.
        # A comment may also contain an article/time, so header + publication
        # semantics are necessary and comment/modified scopes are excluded.
        tags = {tag for tag, _ in self._scope}
        if not {"article", "header"}.issubset(tags):
            return False
        props = [str(attrs.get("itemprop") or "").lower().split() for _, attrs in self._scope]
        if not any("datepublished" in prop for prop in props):
            return False
        if any("datemodified" in prop for prop in props):
            return False
        contexts = (
            " ".join(str(attrs.get(key) or "") for key in ("id", "class", "itemtype"))
            for _, attrs in self._scope
        )
        return not any(
            re.search(r"(?:^|[\W_])(?:comments?|replies|reply)(?:$|[\W_])", context, re.I)
            for context in contexts
        )

    def _read_article_date(self, value: Any, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(value, list):
            for item in value:
                self._read_article_date(item, depth + 1)
        elif isinstance(value, dict):
            kinds = value.get("@type", [])
            if isinstance(kinds, str):
                kinds = [kinds]
            if isinstance(kinds, list) and any(
                kind in {"Article", "NewsArticle", "BlogPosting", "TechArticle", "Report"}
                for kind in kinds
                if isinstance(kind, str)
            ):
                date = value.get("datePublished")
                if isinstance(date, str) and self.published is None:
                    self.published = parse_published_datetime(date)
                headline = value.get("headline")
                if isinstance(headline, str) and headline.strip() and self.headline is None:
                    self.headline = headline
            for item in value.values():
                if isinstance(item, (list, dict)):
                    self._read_article_date(item, depth + 1)


def _original_url(value: str) -> str | None:
    try:
        public = registered_feeds.public_url(value)
        parts = urlsplit(public)
        host = (parts.hostname or "").lower().removeprefix("www.")
        if any(host == blocked or host.endswith("." + blocked) for blocked in _SOCIAL_HOSTS):
            return None
        query = [
            (key, val)
            for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if not re.match(r"^utm_|^ref$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$", key, re.I)
        ]
        netloc = host
        if parts.port and parts.port != (443 if parts.scheme == "https" else 80):
            netloc = f"{host}:{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, urlencode(query), "")).rstrip("/")
    except (ValueError, registered_feeds.UnsafeFeedUrl):
        return None


async def linked_originals(events: list[Event], *, since: datetime | None = None) -> list[Event]:
    """Retain bounded public reporting; HN discussion never becomes its proof."""
    since = since or _now() - timedelta(days=7)
    candidates: dict[str, list[Event]] = {}
    recent = _now() - timedelta(hours=24)
    ranked = sorted(
        events,
        key=lambda event: (
            event.published_at >= recent,
            (event.source_document.parsed_fields or {}).get("points", 0)
            if event.source_document
            else 0,
            event.published_at,
            event.id,
        ),
        reverse=True,
    )
    for event in ranked:
        fields = event.source_document.parsed_fields if event.source_document else None
        url = _original_url(str((fields or {}).get("linkedOriginalUrl") or ""))
        if url:
            candidates.setdefault(url, []).append(event)
    semaphore = asyncio.Semaphore(ORIGINAL_CONCURRENCY)
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}, timeout=20
    ) as client:

        async def retrieve(url: str, discussions: list[Event]) -> Event | None:
            async with semaphore:
                try:
                    page = await registered_feeds.fetch_public_document(client, url)
                    canonical = _original_url(page.url)
                    if not canonical:
                        return None
                    metadata = _OriginalMetadata()
                    metadata.feed(page.text)
                    title = metadata.title
                    if not title:
                        return None
                    body = _extract_article_text(page.text, title)
                    now = _now()
                    published = metadata.published
                    if (
                        published is None
                        or published < since
                        or published > now + timedelta(minutes=5)
                    ):
                        return None
                    document = _article_receipt(body, title, canonical, published)
                    if not document:
                        return None
                    document.fetched_at = now
                    document.parsed_fields = {
                        **(document.parsed_fields or {}),
                        "discoveredBy": "hackernews",
                        "discussionUrl": discussions[0].source_url,
                        "discussionUrls": [event.source_url for event in discussions],
                        "publicationDateBasis": "publisher_metadata",
                        "publisherTitleBasis": metadata.title_basis,
                    }
                    host = urlsplit(canonical).hostname or "unknown"
                    identity = event_hash(f"news:hackernews-original:{host}", canonical)
                    return Event(
                        id=identity[:16],
                        source=f"news:hackernews-original:{host}",
                        source_url=canonical,
                        published_at=published,
                        title=title,
                        content=document.raw_text,
                        raw_hash=identity,
                        source_document=document,
                    )
                except (
                    httpx.HTTPError,
                    ValueError,
                    TimeoutError,
                    registered_feeds.PublicFeedFetchError,
                    registered_feeds.UnsafeFeedUrl,
                ) as exc:
                    LOGGER.debug("hackernews original unavailable: %s", type(exc).__name__)
                    return None

        retrieved = await asyncio.gather(
            *(
                retrieve(url, discussions)
                for url, discussions in list(candidates.items())[:MAX_ORIGINALS_PER_REFRESH]
            )
        )
    return _deduplicate_originals(retrieved)


def _deduplicate_originals(retrieved: list[Event | None]) -> list[Event]:
    # Two distinct links can redirect to the same publisher article.
    unique: dict[str, Event] = {}
    for event in retrieved:
        if event:
            existing = unique.get(event.source_url)
            if existing and existing.source_document and event.source_document:
                first = existing.source_document.parsed_fields or {}
                second = event.source_document.parsed_fields or {}
                first["discussionUrls"] = list(
                    dict.fromkeys(
                        [*first.get("discussionUrls", []), *second.get("discussionUrls", [])]
                    )
                )
                existing.source_document.parsed_fields = first
            else:
                unique[event.source_url] = event
    return list(unique.values())


def fetch_all(days: int = 7) -> list[Event]:
    now = _now()
    since = now - timedelta(days=days)
    out: list[Event] = []
    seen: set[str] = set()
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20,
        follow_redirects=True,
    ) as client:
        for query, tag, min_points, query_since in query_specs(since, now):
            numeric = f"created_at_i>{int(query_since.timestamp())},points>={min_points}"
            for page in range(PAGES):
                params = {"tags": tag, "numericFilters": numeric, "hitsPerPage": 100, "page": page}
                if query:
                    params["query"] = query
                try:
                    resp = client.get(API_URL, params=params)
                    resp.raise_for_status()
                    payload = resp.json()
                except (httpx.HTTPError, ValueError) as exc:
                    LOGGER.debug(
                        "hackernews query=%r page=%d failed: %s", query, page, type(exc).__name__
                    )
                    break
                if not isinstance(payload, dict):
                    break
                page_events = events_from_response(payload, query_since, min_points)
                for event in page_events:
                    if event.id not in seen:
                        seen.add(event.id)
                        out.append(event)
                hits = payload.get("hits")
                if not isinstance(hits, list) or len(hits) < 100:
                    break
    # A publisher failure must not discard the original discussion observations.
    try:
        return [*out, *asyncio.run(linked_originals(out, since=since))]
    except Exception as exc:
        LOGGER.warning("hackernews original retrieval unavailable: %s", type(exc).__name__)
        return out
