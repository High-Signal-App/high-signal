"""Targeted, bounded verification for material Digg discoveries.

Digg supplies the discovery title only. This module searches GDELT for matching
original articles, retrieves those publisher URLs, and hands only the retrieved
documents to the normal candidate generator. Digg/X pages are never scraped and
never become evidence.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import audit
from .sources.news import _extract_article_text
from .types import Event, SourceDocument
from .utils import event_hash


GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
MAX_REQUESTS_PER_POLL = 3
MAX_ARTICLES_PER_REQUEST = 4
SOCIAL_OR_ATTENTION_HOSTS = {"digg.com", "x.com", "twitter.com"}
STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "for",
    "from",
    "in",
    "is",
    "of",
    "on",
    "the",
    "to",
    "with",
}


def title_tokens(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 3 and token not in STOP_WORDS
    }


def title_alignment(discovery_title: str, candidate_title: str) -> float:
    expected = title_tokens(discovery_title)
    actual = title_tokens(candidate_title)
    if not expected or not actual:
        return 0.0
    return len(expected & actual) / len(expected)


def discovery_query(title: str) -> str:
    tokens = sorted(title_tokens(title))[:10]
    return " ".join(tokens)


def _allowed_original_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if parsed.scheme not in {"http", "https"} or not host:
        return None
    if host in SOCIAL_OR_ATTENTION_HOSTS:
        return None
    return value


def discover_articles(request: dict[str, Any], client: httpx.Client) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for url in request.get("sourceUrls", []):
        allowed = _allowed_original_url(url)
        if allowed:
            candidates.append({"url": allowed, "title": request.get("title", "")})

    response = client.get(
        GDELT_DOC_API,
        params={
            "query": discovery_query(str(request.get("title") or "")),
            "mode": "artlist",
            "maxrecords": 20,
            "format": "json",
            "timespan": "1d",
        },
    )
    response.raise_for_status()
    payload = response.json()
    for article in payload.get("articles", []) if isinstance(payload, dict) else []:
        if not isinstance(article, dict):
            continue
        url = _allowed_original_url(article.get("url"))
        title = str(article.get("title") or "")
        if not url or title_alignment(str(request.get("title") or ""), title) < 0.45:
            continue
        candidates.append({**article, "url": url, "title": title})

    by_host: dict[str, dict[str, Any]] = {}
    for article in candidates:
        host = (urlsplit(article["url"]).hostname or "").lower().removeprefix("www.")
        if host and host not in by_host:
            by_host[host] = article
    return list(by_host.values())[:MAX_ARTICLES_PER_REQUEST]


def _published_at(value: object, fallback: datetime) -> datetime:
    if isinstance(value, str):
        for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(value, fmt).astimezone(timezone.utc)
            except ValueError:
                continue
    return fallback


def retrieve_events(
    request: dict[str, Any], articles: list[dict[str, Any]], client: httpx.Client
) -> list[Event]:
    fetched_at = datetime.now(timezone.utc)
    events: list[Event] = []
    for article in articles:
        url = str(article["url"])
        try:
            response = client.get(url)
            response.raise_for_status()
        except httpx.HTTPError:
            continue
        text = _extract_article_text(response.text)
        if len(text) < 500:
            continue
        canonical = str(response.url)
        host = (urlsplit(canonical).hostname or "unknown").lower().removeprefix("www.")
        published_at = _published_at(article.get("seendate"), fetched_at)
        raw_hash = hashlib.sha256(text.encode()).hexdigest()
        events.append(
            Event(
                id=event_hash(f"digg-verification:{host}", canonical)[:16],
                source=f"news:digg-verification:{host}",
                source_url=canonical,
                published_at=published_at,
                title=str(article.get("title") or request.get("title") or ""),
                content=text[:30_000],
                primary_entity_id=request.get("entityId") or None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=canonical,
                    fetched_at=fetched_at,
                    published_at=published_at,
                    raw_hash=raw_hash,
                    raw_text=text[:30_000],
                    parsed_fields={
                        "discoveredBy": "digg_attention_threshold",
                        "diggShortId": request.get("shortId"),
                        "alignment": title_alignment(
                            str(request.get("title") or ""), str(article.get("title") or "")
                        ),
                    },
                ),
            )
        )
    return events


def verify_request(request: dict[str, Any], client: httpx.Client) -> dict[str, Any]:
    short_id = str(request.get("shortId") or "")
    try:
        articles = discover_articles(request, client)
        events = retrieve_events(request, articles, client)
        if len({urlsplit(event.source_url).hostname for event in events}) < 2:
            return {"shortId": short_id, "status": "insufficient_evidence"}
        audit.push_events(events, f"digg-{short_id}"[:16])
        from .pipeline import cluster_and_generate

        paths = cluster_and_generate(events)
        if not paths:
            return {"shortId": short_id, "status": "insufficient_evidence"}
        candidate_slug = paths[0].removeprefix("pushed:").rsplit("/", 1)[-1].removesuffix(".md")
        return {
            "shortId": short_id,
            "status": "verified_candidate",
            "candidateSlug": candidate_slug,
        }
    except Exception as exc:  # noqa: BLE001 - isolate one attention discovery
        return {"shortId": short_id, "status": "failed", "error": str(exc)[:500]}


def verify_requests(requests: list[dict[str, Any]], client: httpx.Client) -> list[dict[str, Any]]:
    return [verify_request(request, client) for request in requests[:MAX_REQUESTS_PER_POLL]]
