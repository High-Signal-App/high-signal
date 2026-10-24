"""Bounded, publisher-specific collection of public newsletter archives.

Only configured archive kinds are supported. Listings are not evidence: each
article must supply its own publication date and publicly available body.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Callable
from urllib.parse import urljoin, urlsplit

import httpx

from . import registered_feeds

MAX_ARTICLES = 12
_VOID = set("area base br col embed hr img input link meta param source track wbr".split())


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str | None]
    parent: _Node | None = None
    parts: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


class _Markup(HTMLParser):
    def __init__(self, html: str) -> None:
        super().__init__()
        self.nodes: list[_Node] = []
        self.stack: list[_Node] = []
        self.feed(html)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag, dict(attrs), self.stack[-1] if self.stack else None)
        self.nodes.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self.stack and self.stack[-1].tag in {"script", "style"}:
            if self.stack[-1].attrs.get("type") == "application/ld+json":
                self.stack[-1].parts.append(data)
            return
        for node in self.stack:
            if node.tag in {"a", "h1", "h2", "h3", "p", "time"}:
                node.parts.append(data)


def _under(node: _Node, ancestor: _Node) -> bool:
    current = node.parent
    while current:
        if current is ancestor:
            return True
        current = current.parent
    return False


def _same_origin_link(base: str, value: str) -> str | None:
    try:
        url = registered_feeds.public_url(urljoin(base, value))
    except registered_feeds.UnsafeFeedUrl:
        return None
    source, target = urlsplit(base), urlsplit(url)
    if (source.scheme, source.netloc) != (target.scheme, target.netloc):
        return None
    if target.query:
        return None
    return url


def archive_links(html: str, url: str, kind: str) -> list[str]:
    """Select only article links from the configured publisher's listing."""
    markup = _Markup(html)
    if kind not in {"batch", "stratechery", "beehiiv", "cerebras"}:
        raise registered_feeds.PublicFeedFetchError("Unsupported public archive")
    links: list[str] = []
    for node in markup.nodes:
        if node.tag != "a" or not node.attrs.get("href"):
            continue
        link = _same_origin_link(url, node.attrs["href"] or "")
        if not link:
            continue
        path = urlsplit(link).path
        if kind == "batch":
            accepted = bool(re.fullmatch(r"/the-batch/issue-\d+/?", path))
        elif kind == "stratechery":
            accepted = any(
                ancestor.tag == "li"
                and "category-articles" in (ancestor.attrs.get("class") or "").split()
                and _under(node, ancestor)
                for ancestor in markup.nodes
            ) and bool(re.fullmatch(r"/\d{4}/[^/]+/?", path))
        elif kind == "beehiiv":
            accepted = bool(re.fullmatch(r"/p/[^/]+/?", path))
        else:
            accepted = bool(re.fullmatch(r"/blog/[^/]+/?", path))
        if accepted and link not in links:
            links.append(link)
        if len(links) == MAX_ARTICLES:
            break
    if not links:
        raise registered_feeds.PublicFeedFetchError(
            "Public archive contained no supported article links"
        )
    return links


def _iso(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.astimezone(timezone.utc)
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except ValueError:
        return None


def _json_objects(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _json_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _json_objects(child)


def _structured_publication(markup: _Markup) -> tuple[bool, datetime | None]:
    published = None
    for node in markup.nodes:
        if node.tag != "script" or node.attrs.get("type") != "application/ld+json":
            continue
        try:
            values = list(_json_objects(json.loads("".join(node.parts))))
        except (ValueError, RecursionError):
            continue
        for value in values:
            if (
                value.get("isAccessibleForFree") is False
                or value.get("isAccessibleForFree") == "false"
            ):
                return False, None
            types = value.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if not isinstance(types, list):
                continue
            if any(
                isinstance(t, str) and t in {"Article", "NewsArticle", "BlogPosting"} for t in types
            ):
                published = published or _iso(str(value.get("datePublished") or ""))
    return True, published


def _cerebras_date(markup: _Markup, heading: _Node | None) -> datetime | None:
    if not heading:
        return None
    previous = None
    for node in markup.nodes:
        if node is heading:
            break
        if node.parent is heading.parent and node.tag == "p":
            previous = node
    if previous and re.fullmatch(r"[A-Z][a-z]{2} \d{1,2} \d{4}", previous.text):
        try:
            return datetime.strptime(previous.text, "%b %d %Y").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def article_metadata(html: str, kind: str) -> tuple[str, datetime] | None:
    markup = _Markup(html)
    meta = {
        node.attrs.get("property") or node.attrs.get("name"): node.attrs.get("content") or ""
        for node in markup.nodes
        if node.tag == "meta"
    }
    accessible, structured_date = _structured_publication(markup)
    if not accessible:
        return None
    published = _iso(meta.get("article:published_time", "")) or structured_date
    heading = next((node for node in markup.nodes if node.tag == "h1" and node.text), None)
    title = meta.get("og:title") or (heading.text if heading else "")
    if not published and kind == "cerebras" and heading:
        # The current publisher template has no publication metadata. Its
        # dedicated date paragraph directly precedes the heading; modified time
        # and incidental dates in the article must never substitute for it.
        published = _cerebras_date(markup, heading)
    if not title or not published:
        return None
    return title[:1000], published


@dataclass
class ArchiveResult:
    items: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    dated: int = 0
    latest: datetime | None = None


async def fetch_archive(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    extract_text: Callable[[str, str], str],
) -> ArchiveResult:
    config = source["archive"]
    async with semaphore:
        document = await registered_feeds.fetch_public_document(
            client, config["url"], allow_prefix=True
        )
    links = archive_links(document.text, document.url, config["kind"])
    result = ArchiveResult()
    article_semaphore = asyncio.Semaphore(2)

    async def fetch_one(link: str) -> None:
        try:
            async with article_semaphore, semaphore:
                article = await registered_feeds.fetch_public_document(client, link)
            if _same_origin_link(document.url, article.url) is None:
                raise registered_feeds.PublicFeedFetchError(
                    "Public archive article redirected off publisher"
                )
            metadata = article_metadata(article.text, config["kind"])
            if metadata is None:
                return
            title, published = metadata
            if published > datetime.now(timezone.utc) + timedelta(minutes=15):
                return
            result.dated += 1
            result.latest = max(result.latest, published) if result.latest else published
            if published < since:
                return
            content = await asyncio.to_thread(extract_text, article.text, title)
            if len(content) < 200:
                result.errors.append("Public archive article contained no usable public body")
                return
            result.items.append(
                {"title": title, "link": article.url, "published": published, "content": content}
            )
        except registered_feeds.PublicFeedFetchError as exc:
            result.errors.append(str(exc))
        except (httpx.HTTPError, TimeoutError) as exc:
            result.errors.append(f"Public archive article fetch failed ({type(exc).__name__})")

    await asyncio.gather(*(fetch_one(link) for link in links))
    if result.dated == 0 and not result.errors:
        result.errors.append("Public archive contained no dated, freely accessible articles")
    result.items.sort(key=lambda item: item["published"], reverse=True)
    return result
