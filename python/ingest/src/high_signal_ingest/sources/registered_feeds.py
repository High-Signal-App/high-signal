"""Operator-managed public feeds, including safe recurring HTTP retrieval."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
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
    format: Literal["rss", "atom", "archive"] = "rss"


_PUBLIC_ARCHIVES = json.loads(
    (Path(__file__).parents[1] / "seed" / "public-archives.json").read_text()
)


def known_public_archive(value: str) -> dict | None:
    url = urlsplit(public_url(value))
    if url.query:
        return None

    def identity(link: str) -> tuple[str, str]:
        parsed = urlsplit(link)
        return (parsed.hostname or "").lower().removeprefix("www."), parsed.path.rstrip("/")

    return next(
        (
            archive
            for archive in _PUBLIC_ARCHIVES
            if any(
                identity(value) == identity(alias)
                for alias in [archive["url"], *archive["aliases"]]
            )
        ),
        None,
    )


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
        if row.format == "archive" and known_public_archive(row.feedUrl) is None:
            raise PublicFeedFetchError("Unsupported public archive in publication registry")
    return registered


def _source_urls(source: dict) -> list[str]:
    archive = source.get("archive") or {}
    return [
        value
        for value in [
            source.get("rss"),
            archive.get("url"),
            *source.get("feed_aliases", []),
            *source.get("retired_feed_aliases", []),
        ]
        if value
    ]


def _eligible(source: dict, tier_max: int, paused: set[str]) -> bool:
    kind = source.get("type")
    limit = max(tier_max, 3) if kind == "mailing_list" else tier_max
    return (
        kind in {"blog", "news_outlet", "mailing_list"}
        and source["id"] not in paused
        and bool(source.get("rss") or source.get("archive"))
        and int(source.get("tier", 99)) <= limit
    )


def _registered_source(seed: dict | None, row: RegisteredFeed, url: str) -> dict:
    base = {
        k: v
        for k, v in (seed or {"id": row.id}).items()
        if k not in {"archive", "feed_aliases", "retired_feed_aliases"}
    }
    if seed and feed_key(url) not in {feed_key(u) for u in _source_urls(seed)}:
        base.pop("feed_max_bytes", None)
    retired = bool(seed and seed.get("archive")) and feed_key(url) in {
        feed_key(alias) for alias in (seed or {}).get("retired_feed_aliases", [])
    }
    if row.format == "archive" or retired:
        archive = known_public_archive(url)
        if archive is None:
            raise PublicFeedFetchError("Unsupported public archive in publication registry")
        return {
            **base,
            "rss": None,
            "archive": {"url": archive["url"], "kind": archive["kind"]},
            "_registry_id": row.id,
        }
    return {**base, "rss": url, "_registry_id": row.id}


def _registry_seed(
    row: RegisteredFeed,
    all_seeds: dict[str, dict],
    by_id: dict[str, dict],
    *,
    include_archives: bool = False,
) -> dict | None:
    """Resolve aliases and known archive identities before applying operator state."""
    archive = (
        known_public_archive(row.feedUrl) if include_archives or row.format == "archive" else None
    )
    return (
        all_seeds.get(feed_key(row.feedUrl))
        or by_id.get(row.id)
        or (by_id.get(archive["id"]) if archive else None)
    )


def merge_sources(seeds: list[dict], rows: list[dict] | None, tier_max: int) -> list[dict]:
    registered = registry_rows(rows)
    all_seeds = {feed_key(url): source for source in seeds for url in _source_urls(source)}
    by_id = {source["id"]: source for source in seeds}
    paused = {
        seed["id"]
        for row in registered
        if not row.enabled
        if (seed := _registry_seed(row, all_seeds, by_id, include_archives=True))
    }
    selected: dict[str, dict] = {}
    for source in seeds:
        if _eligible(source, tier_max, paused):
            selected[feed_key(source.get("rss") or source["archive"]["url"])] = source
    for row in registered:
        url = public_url(row.feedUrl)
        key = feed_key(url)
        seed = _registry_seed(row, all_seeds, by_id)
        if seed and seed["id"] in paused:
            continue
        if seed:
            for selected_key, value in list(selected.items()):
                if value["id"] == seed["id"]:
                    selected.pop(selected_key)
        if not row.enabled:
            selected.pop(key, None)
            continue
        # An explicit operator URL replaces the entire seed path, including its
        # archive. Pausing a legacy URL must not silently resume its replacement.
        selected[key] = _registered_source(seed, row, url)
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
    truncated: bool = False


async def fetch_public_document(
    client: httpx.AsyncClient,
    value: str,
    *,
    max_bytes: int = 2 * 1024 * 1024,
    allow_prefix: bool = False,
) -> PublicFeedDocument:
    if not 0 < max_bytes <= 4 * 1024 * 1024:
        raise PublicFeedFetchError("Invalid public document download limit")
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
                truncated = False
                async for chunk in response.aiter_bytes():
                    if total + len(chunk) > max_bytes:
                        if not allow_prefix:
                            raise PublicFeedFetchError(
                                f"Feed exceeds the {max_bytes // (1024 * 1024)} MB download limit"
                            )
                        chunks.append(chunk[: max_bytes - total])
                        truncated = True
                        break
                    total += len(chunk)
                    chunks.append(chunk)
                return PublicFeedDocument(
                    url,
                    b"".join(chunks).decode(response.encoding or "utf-8", errors="replace"),
                    truncated,
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
