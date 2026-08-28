"""Digg public-feed collector for the derived attention overlay.

This connector never emits ``Event`` or ``SignalCandidate`` objects. It stores
attention observations through the authenticated API so Digg cannot enter the
evidence or confidence pipeline by accident.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
import yaml


USER_AGENT = "high-signal/0.1 digg-attention"
MIN_REFRESH_SECONDS = 10 * 60
FEEDS: dict[str, str] = {
    "ranked": "https://digg.com/ai-clusters-ranked.json",
    "rolling": "https://digg.com/ai-clusters.json",
    "today": "https://digg.com/ai-clusters-today.yaml",
    "rising": "https://digg.com/ai-rising-clusters.yaml",
    "rising_today": "https://digg.com/ai-rising-clusters-today.yaml",
}
TRACKING_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
}


def payload_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def canonicalize_url(value: object, *, base: str = "https://digg.com") -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    absolute = urljoin(base, value.strip())
    try:
        parts = urlsplit(absolute)
    except ValueError:
        return None
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None
    query = [
        (key, val)
        for key, val in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_KEYS
    ]
    hostname = (parts.hostname or "").lower().removeprefix("www.")
    netloc = hostname
    if parts.port:
        netloc = f"{hostname}:{parts.port}"
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), netloc, path, urlencode(query), ""))


def parse_feed(text: str, feed_url: str) -> dict[str, Any]:
    if feed_url.endswith(".json"):
        value = json.loads(text)
    else:
        value = yaml.safe_load(text)
    if not isinstance(value, dict) or not isinstance(value.get("clusters"), list):
        raise ValueError(f"unexpected Digg payload for {feed_url}")
    return json.loads(json.dumps(value, default=str))


def _as_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _external_generated_analysis(cluster: dict[str, Any]) -> dict[str, Any] | None:
    """Preserve a future documented field without guessing a private API.

    No such field exists in the inspected 2026-08-24 feeds. Only explicit
    feed fields are accepted; arbitrary summaries are never promoted here.
    """

    for key in ("external_generated_analysis", "digg_deeper", "deeper"):
        value = cluster.get(key)
        if isinstance(value, dict):
            return value
    return None


def resolve_source_url(value: object, client: httpx.Client) -> str | None:
    """Resolve one authorized underlying URL with a HEAD request only.

    Digg and X story/post pages are never resolved or scraped. A failed or
    unsupported HEAD request falls back to deterministic canonicalization.
    """

    canonical = canonicalize_url(value)
    if not canonical:
        return None
    host = (urlsplit(canonical).hostname or "").lower()
    if host in {"digg.com", "x.com", "twitter.com"}:
        return canonical
    try:
        response = client.head(canonical)
        response.raise_for_status()
        return canonicalize_url(str(response.url)) or canonical
    except httpx.HTTPError:
        return canonical


def _representative_posts(cluster: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in cluster.get("representative_sources", []) if isinstance(item, dict)]


def _source_urls(
    posts: list[dict[str, Any]], url_resolver: Callable[[object], str | None]
) -> list[str]:
    urls: list[str] = []
    for post in posts:
        url = url_resolver(post.get("url"))
        if url and url not in urls:
            urls.append(url)
    return urls


def _contributing_accounts(
    cluster: dict[str, Any], posts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    seen_accounts: set[str] = set()
    for touch in cluster.get("ai1000_touches", []):
        if not isinstance(touch, dict):
            continue
        username = str(touch.get("username") or "").strip().lower()
        if username and username not in seen_accounts:
            seen_accounts.add(username)
            accounts.append(touch)
    for post in posts:
        username = str(post.get("author_username") or "").strip().lower()
        if username and username not in seen_accounts:
            seen_accounts.add(username)
            accounts.append({"username": username, "source": "representative_source"})
    return accounts


def _voice_count(cluster: dict[str, Any], account_count: int) -> int:
    conversation = cluster.get("conversation_shape")
    voice_count = (
        _as_int(conversation.get("voice_count")) if isinstance(conversation, dict) else None
    )
    return voice_count if voice_count is not None else account_count


def _attention_metrics(cluster: dict[str, Any]) -> dict[str, Any]:
    return {
        key: cluster.get(key)
        for key in (
            "engagement_totals",
            "engagement_delta_10m",
            "engagement_delta_1h",
            "engagement_delta_6h",
            "engagement_sources",
            "engagement_ratios",
            "conversation_shape",
            "story_count",
            "age_hours",
        )
        if key in cluster
    }


def normalize_cluster(
    cluster: dict[str, Any],
    retrieved_at: str,
    *,
    url_resolver: Callable[[object], str | None] = canonicalize_url,
) -> dict[str, Any] | None:
    short_id = str(cluster.get("short_id") or "").strip()
    source_id = str(cluster.get("id") or "").strip()
    title = str(cluster.get("title") or "").strip()
    if not short_id or not source_id or not title:
        return None

    posts = _representative_posts(cluster)
    source_urls = _source_urls(posts, url_resolver)
    accounts = _contributing_accounts(cluster, posts)
    canonical_digg_url = canonicalize_url(cluster.get("url"))
    if not canonical_digg_url:
        canonical_digg_url = f"https://digg.com/tech/{short_id}"

    summary = str(cluster.get("tldr") or "").strip() or None
    return {
        "sourceId": source_id,
        "shortId": short_id,
        "canonicalDiggUrl": canonical_digg_url,
        "title": title,
        "diggSummary": summary,
        "createdAt": cluster.get("created_at"),
        "firstSeenAt": cluster.get("first_post_at") or cluster.get("created_at") or retrieved_at,
        "retrievedAt": retrieved_at,
        "position": _as_int(cluster.get("position")),
        "peakPosition": _as_int(cluster.get("peak_rank")),
        "entryStatus": str(cluster.get("entry_status") or "").strip() or None,
        "badges": cluster.get("badges") if isinstance(cluster.get("badges"), list) else [],
        "sourcePosts": posts,
        "sourceUrls": source_urls,
        "contributingAccounts": accounts,
        "distinctAccountCount": _voice_count(cluster, len(accounts)),
        "attentionMetrics": _attention_metrics(cluster),
        "sourceClass": "attention_aggregator",
        "evidenceTier": "derived",
        "confidenceContribution": "none",
        "attentionContribution": "allowed",
        "externalGeneratedAnalysis": _external_generated_analysis(cluster),
        "rawPayloadHash": payload_hash(cluster),
        "rawPayload": cluster,
    }


def normalize_feed(
    feed_kind: str,
    feed_url: str,
    payload: dict[str, Any],
    retrieved_at: str,
    *,
    url_resolver: Callable[[object], str | None] = canonicalize_url,
):
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    clusters = []
    for raw in payload["clusters"]:
        if not isinstance(raw, dict):
            continue
        normalized = normalize_cluster(raw, retrieved_at, url_resolver=url_resolver)
        if normalized:
            if feed_kind.startswith("rising") and not normalized["entryStatus"]:
                normalized["entryStatus"] = "rising"
            clusters.append(normalized)
    return {
        "feedKind": feed_kind,
        "feedUrl": feed_url,
        "generatedAt": metadata.get("generated_at"),
        "retrievedAt": retrieved_at,
        "rawPayloadHash": payload_hash(payload),
        "rawPayload": payload,
        "clusters": clusters,
    }


def due_feed_kinds(client: httpx.Client, api_base: str, token: str) -> set[str]:
    response = client.get(
        f"{api_base.rstrip('/')}/admin/digg/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code == 404:
        return set(FEEDS)
    response.raise_for_status()
    body = response.json()
    feeds = body.get("feeds", []) if isinstance(body, dict) else []
    return {
        str(item.get("feedKind"))
        for item in feeds
        if isinstance(item, dict) and item.get("isDue") is True
    }


def poll(api_base: str, token: str, *, now: datetime | None = None) -> dict[str, Any]:
    retrieved_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json, application/yaml, text/yaml"}
    with httpx.Client(headers=headers, timeout=30.0, follow_redirects=True) as client:
        due = due_feed_kinds(client, api_base, token)
        if not due:
            return {"skipped": True, "reason": "minimum_refresh_interval", "feeds": 0}

        feeds = []
        for feed_kind, feed_url in FEEDS.items():
            if feed_kind not in due:
                continue
            response = client.get(feed_url)
            response.raise_for_status()
            feeds.append(
                normalize_feed(
                    feed_kind,
                    feed_url,
                    parse_feed(response.text, feed_url),
                    retrieved_at,
                    url_resolver=lambda value: resolve_source_url(value, client),
                )
            )

        response = client.post(
            f"{api_base.rstrip('/')}/admin/digg",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "retrievedAt": retrieved_at,
                "minimumRefreshSeconds": MIN_REFRESH_SECONDS,
                "feeds": feeds,
            },
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            return {"feeds": len(feeds)}

        verification_requests = body.get("verificationRequests", [])
        if isinstance(verification_requests, list) and verification_requests:
            from .digg_verify import MAX_REQUESTS_PER_POLL, verify_requests

            running = [
                {"shortId": request.get("shortId"), "status": "running"}
                for request in verification_requests[:MAX_REQUESTS_PER_POLL]
                if isinstance(request, dict) and request.get("shortId")
            ]
            if running:
                client.post(
                    f"{api_base.rstrip('/')}/admin/digg/verification-results",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json={"results": running},
                ).raise_for_status()
            results = verify_requests(
                [request for request in verification_requests if isinstance(request, dict)], client
            )
            client.post(
                f"{api_base.rstrip('/')}/admin/digg/verification-results",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"results": results},
            ).raise_for_status()
            body["verificationResults"] = results
        if isinstance(verification_requests, list):
            body["verificationRequests"] = [
                {
                    **{key: value for key, value in request.items() if key != "retainedEvidence"},
                    "retainedEvidenceCount": len(request.get("retainedEvidence", [])),
                }
                for request in verification_requests
                if isinstance(request, dict)
            ]
        return body


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll documented Digg attention feeds")
    parser.add_argument("--api-base", default=os.environ.get("API_BASE"))
    parser.add_argument("--admin-token", default=os.environ.get("ADMIN_TOKEN"))
    args = parser.parse_args()
    if not args.api_base or not args.admin_token:
        parser.error("API_BASE and ADMIN_TOKEN are required")
    print(json.dumps(poll(args.api_base, args.admin_token), sort_keys=True))


if __name__ == "__main__":
    main()
