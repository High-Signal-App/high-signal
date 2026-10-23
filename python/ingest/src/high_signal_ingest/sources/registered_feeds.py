"""Operator-managed public feeds, including safe recurring HTTP retrieval."""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from .. import audit


class PublicFeedFetchError(Exception):
    """Safe, bounded diagnostic suitable for the operator registry."""


class UnsafeFeedUrl(PublicFeedFetchError):
    pass


class RegisteredFeed(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    feedUrl: str
    enabled: bool


def public_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower().rstrip(".")
        if (
            url.scheme not in {"http", "https"}
            or url.username
            or url.password
            or url.port not in {None, 80, 443}
            or "." not in host
            or re.search(r"\.(localhost|local|internal|lan|home|test|invalid|onion)$", host)
            or re.fullmatch(r"[\d.]+", host)
            or ":" in host
        ):
            raise UnsafeFeedUrl("Feed URLs must use public HTTP or HTTPS hostnames")
        if any(
            re.fullmatch(
                r"token|access_token|key|api_key|auth|signature|password|secret|jwt|subscriber_id",
                key,
                re.I,
            )
            for key, _value in parse_qsl(url.query)
        ):
            raise UnsafeFeedUrl("Private or authenticated feed URL")
        return urlunsplit((url.scheme, url.netloc, url.path, url.query, ""))
    except ValueError as exc:
        raise UnsafeFeedUrl("Invalid public feed URL") from exc


def feed_key(value: str) -> str:
    url = urlsplit(value)
    host = (url.hostname or "").lower().removeprefix("www.")
    query = sorted(
        (key, value)
        for key, value in parse_qsl(url.query)
        if not key.lower().startswith("utm_") and key.lower() not in {"fbclid", "gclid"}
    )
    return urlunsplit((url.scheme.lower(), host, url.path.rstrip("/"), urlencode(query), ""))


def registry_rows(rows: list[dict] | None) -> list[RegisteredFeed]:
    if rows is None:
        # An outage must not silently resume seed feeds the operator paused.
        raise PublicFeedFetchError("Publication feed registry unavailable")
    try:
        registered = TypeAdapter(list[RegisteredFeed]).validate_python(rows)
    except ValidationError as exc:
        raise PublicFeedFetchError("Invalid publication feed registry response") from exc
    for row in registered:
        public_url(row.feedUrl)
    return registered


def merge_sources(seeds: list[dict], rows: list[dict] | None, tier_max: int) -> list[dict]:
    registered = registry_rows(rows)
    all_seeds = {feed_key(source["rss"]): source for source in seeds if source.get("rss")}
    selected: dict[str, dict] = {}
    for source in seeds:
        kind = source.get("type")
        limit = max(tier_max, 3) if kind == "mailing_list" else tier_max
        if (
            kind in {"blog", "news_outlet", "mailing_list"}
            and source.get("rss")
            and int(source.get("tier", 99)) <= limit
        ):
            selected[feed_key(source["rss"])] = source
    for row in registered:
        url = public_url(row.feedUrl)
        key = feed_key(url)
        if not row.enabled:
            selected.pop(key, None)
            continue
        selected[key] = {
            **all_seeds.get(key, {"id": row.id}),
            "rss": url,
            "_registry_id": row.id,
        }
    return list(selected.values())


async def check_public_host(value: str) -> None:
    url = urlsplit(public_url(value))
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(
            url.hostname,
            url.port or (443 if url.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise PublicFeedFetchError("Feed hostname could not be resolved") from exc
    if not addresses or any(
        not ipaddress.ip_address(address[4][0]).is_global for address in addresses
    ):
        raise UnsafeFeedUrl("Feed hostname resolved to a non-public address")


@dataclass(frozen=True)
class PublicFeedDocument:
    url: str
    text: str


async def fetch_public_document(client: httpx.AsyncClient, value: str) -> PublicFeedDocument:
    url = public_url(value)
    async with asyncio.timeout(20):
        for _redirect in range(5):
            await check_public_host(url)
            async with client.stream("GET", url, follow_redirects=False) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise PublicFeedFetchError("Invalid feed redirect")
                    url = public_url(urljoin(url, location))
                    continue
                if response.status_code != 200:
                    raise PublicFeedFetchError(f"Publisher returned HTTP {response.status_code}")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > 2 * 1024 * 1024:
                        raise PublicFeedFetchError("Feed exceeds the 2 MB download limit")
                    chunks.append(chunk)
                return PublicFeedDocument(
                    url, b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
                )
    raise PublicFeedFetchError("Too many feed redirects")


async def report_fetch(
    source: dict, *, fetched_at: int, count: int, error: str | None, published_at: int | None
) -> None:
    await asyncio.to_thread(
        audit.push_feed_fetch_result,
        source["_registry_id"],
        {
            "sourceKey": f"news:{source['id']}",
            "fetchedAt": fetched_at,
            "count": count,
            "error": error,
            "lastPublishedAt": published_at,
        },
    )
