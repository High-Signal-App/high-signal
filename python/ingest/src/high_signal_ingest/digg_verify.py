"""Targeted, bounded verification for material attention discoveries.

The attention source supplies the discovery title only. This module searches
GDELT for matching original articles, retrieves those publisher URLs, and hands
only the retrieved documents to the normal candidate generator. Aggregator and
social pages are never scraped and never become evidence. GDELT discovery is
retried within the same verification attempt because its public endpoint can be
slow or transiently unavailable.
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import audit
from .sources.news import _extract_article_text
from .types import Event, SourceDocument
from .utils import event_hash


GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_DOC_API_FALLBACK = "http://api.gdeltproject.org/api/v2/doc/doc"
GDELT_MAX_ATTEMPTS = 2
GDELT_TIMEOUT_SECONDS = 75.0
MAX_REQUESTS_PER_POLL = 6
MAX_ARTICLES_PER_REQUEST = 4
SOCIAL_OR_ATTENTION_HOSTS = {
    "digg.com",
    "facebook.com",
    "hn.algolia.com",
    "instagram.com",
    "news.ycombinator.com",
    "old.reddit.com",
    "reddit.com",
    "mts.now",
    "threads.net",
    "twitter.com",
    "x.com",
}
ARTICLE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
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
    tokens: set[str] = set()
    for token in re.findall(r"[a-z0-9]+", value.lower()):
        if len(token) < 3 or token in STOP_WORDS:
            continue
        if token.endswith("ai") and len(token) > 6:
            token = token[:-2]
        if token.endswith("ed") and len(token) > 5:
            token = token[:-2]
        elif token.endswith("s") and len(token) > 4:
            token = token[:-1]
        tokens.add(token)
    return tokens


def title_alignment(discovery_title: str, candidate_title: str) -> float:
    expected = title_tokens(discovery_title)
    actual = title_tokens(candidate_title)
    if not expected or not actual:
        return 0.0
    return len(expected & actual) / len(expected)


def discovery_query(title: str) -> str:
    tokens: list[str] = []
    for token in re.findall(r"[a-z0-9]+", title.lower()):
        if len(token) < 3 or token in STOP_WORDS or token in tokens:
            continue
        tokens.append(token)
    # GDELT combines bare keywords restrictively. A short query provides recall;
    # the stricter full-title alignment below is the relevance gate.
    return " ".join(tokens[:3])


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
    if any(
        host == blocked or host.endswith(f".{blocked}") for blocked in SOCIAL_OR_ATTENTION_HOSTS
    ):
        return None
    return value


def _search_gdelt(title: str, client: httpx.Client) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(GDELT_MAX_ATTEMPTS):
        try:
            # GDELT documents both protocols for DOC 2.0. HTTP is used only as
            # a discovery fallback after HTTPS transport failure; its output is
            # never evidence, and every candidate publisher page is retrieved
            # and evaluated independently below.
            response = client.get(
                GDELT_DOC_API if attempt == 0 else GDELT_DOC_API_FALLBACK,
                params={
                    "query": discovery_query(title),
                    "mode": "artlist",
                    "maxrecords": 10,
                    "format": "json",
                    # Threshold crossings may originate in rolling Digg feeds
                    # after the underlying story is already more than one day old.
                    "timespan": "3d",
                },
                headers={"Accept": "application/json", "Connection": "close"},
                timeout=GDELT_TIMEOUT_SECONDS,
            )
            if response.status_code == 429 and attempt + 1 < GDELT_MAX_ATTEMPTS:
                # GDELT explicitly rate-limits its shared search clusters.
                # A bounded pause avoids turning one threshold crossing into a burst.
                retry_after = response.headers.get("Retry-After", "15")
                try:
                    delay = min(max(float(retry_after), 1.0), 30.0)
                except ValueError:
                    delay = 15.0
                time.sleep(delay)
                continue
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, dict) else {}
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


def _retained_candidates(request: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for retained in request.get("retainedEvidence", []):
        if not isinstance(retained, dict):
            continue
        allowed = _allowed_original_url(retained.get("url"))
        title = str(retained.get("title") or "")
        if allowed and title_alignment(str(request.get("title") or ""), title) >= 0.35:
            candidates.append({**retained, "url": allowed, "title": title})
    return candidates


def _direct_candidates(request: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for url in request.get("sourceUrls", []):
        allowed = _allowed_original_url(url)
        if allowed:
            candidates.append({"url": allowed, "title": request.get("title", "")})
    return candidates


def _gdelt_candidates(request: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    try:
        articles = payload.get("articles", [])
    except AttributeError:
        return []
    for article in articles if isinstance(articles, list) else []:
        if not isinstance(article, dict):
            continue
        url = _allowed_original_url(article.get("url"))
        title = str(article.get("title") or "")
        # GDELT is broad discovery, not evidence. Require strong title agreement
        # before spending a publisher fetch; entity-name overlap alone (for
        # example, "OpenAI" plus "threat") is not the same underlying claim.
        if not url or title_alignment(str(request.get("title") or ""), title) < 0.60:
            continue
        candidates.append({**article, "url": url, "title": title})
    return candidates


def _deduplicate_hosts(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_host: dict[str, dict[str, Any]] = {}
    for article in candidates:
        host = (urlsplit(article["url"]).hostname or "").lower().removeprefix("www.")
        if host and host not in by_host:
            by_host[host] = article
    return list(by_host.values())[:MAX_ARTICLES_PER_REQUEST]


def discover_articles(request: dict[str, Any], client: httpx.Client) -> list[dict[str, Any]]:
    candidates = [*_retained_candidates(request), *_direct_candidates(request)]
    try:
        payload = _search_gdelt(str(request.get("title") or ""), client)
    except (httpx.HTTPError, ValueError):
        # Direct or retained originals remain useful even if discovery is
        # unavailable. With none, propagate the outage for a later retry.
        if not candidates:
            raise
        payload = {}
    return _deduplicate_hosts([*candidates, *_gdelt_candidates(request, payload)])


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
    attention_source = str(request.get("attentionSource") or "digg").strip().lower()
    if attention_source not in {"digg", "mts"}:
        attention_source = "unknown"
    source_id = str(request.get("shortId") or "")
    events: list[Event] = []
    for article in articles:
        url = str(article["url"])
        retained_content = article.get("retainedContent")
        response: httpx.Response | None = None
        if isinstance(retained_content, str) and len(retained_content) >= 500:
            text = retained_content[:30_000]
            canonical = url
        else:
            try:
                # The feed client asks Digg for JSON/YAML. Publisher retrieval must
                # override that inherited Accept header or some sites return an
                # unusable representation (or reject the request outright).
                response = client.get(url, headers={"Accept": ARTICLE_ACCEPT})
                response.raise_for_status()
            except httpx.HTTPError:
                continue
            text = _extract_article_text(response.text)
            canonical = _allowed_original_url(str(response.url)) or ""
            if not canonical:
                continue
        if len(text) < 500:
            continue
        host = (urlsplit(canonical).hostname or "unknown").lower().removeprefix("www.")
        published_at = _published_at(article.get("seendate"), fetched_at)
        raw_hash = hashlib.sha256(text.encode()).hexdigest()
        events.append(
            Event(
                id=event_hash(f"{attention_source}-verification:{host}", canonical)[:16],
                source=f"news:{attention_source}-verification:{host}",
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
                        "discoveredBy": f"{attention_source}_attention_threshold",
                        "attentionSource": attention_source,
                        "attentionSourceId": source_id,
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
    attention_source = str(request.get("attentionSource") or "digg").strip().lower()
    try:
        articles = discover_articles(request, client)
        events = retrieve_events(request, articles, client)
        diagnostics = {
            "discoveredArticleCount": len(articles),
            "retrievedEvidenceCount": len(events),
            "retrievedHosts": sorted(
                {(urlsplit(event.source_url).hostname or "unknown").lower() for event in events}
            ),
        }
        if len({urlsplit(event.source_url).hostname for event in events}) < 2:
            return {"shortId": short_id, "status": "insufficient_evidence", **diagnostics}
        audit.push_events(events, f"{attention_source}-{short_id}"[:16])
        from .pipeline import cluster_and_generate

        # A deterministic fallback is a review aid, not proof that the original
        # claim passed semantic-origin publication gates. Digg verification must
        # never label that fallback as a verified candidate.
        paths = cluster_and_generate(events, allow_fallback=False)
        if not paths:
            return {"shortId": short_id, "status": "insufficient_evidence", **diagnostics}
        candidate_slug = paths[0].removeprefix("pushed:").rsplit("/", 1)[-1].removesuffix(".md")
        return {
            "shortId": short_id,
            "status": "verified_candidate",
            "candidateSlug": candidate_slug,
            **diagnostics,
        }
    except Exception as exc:  # noqa: BLE001 - isolate one attention discovery
        return {"shortId": short_id, "status": "failed", "error": str(exc)[:500]}


def verify_requests(requests: list[dict[str, Any]], client: httpx.Client) -> list[dict[str, Any]]:
    return [verify_request(request, client) for request in requests[:MAX_REQUESTS_PER_POLL]]
