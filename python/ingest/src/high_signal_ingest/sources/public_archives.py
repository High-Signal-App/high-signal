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
ALPHASIGNAL_STALE_GRACE_DAYS = 4
_VOID = set("area base br col embed hr img input link meta param source track wbr".split())
_ALPHA_MONTHS = dict(
    zip(
        ("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()),
        range(1, 13),
        strict=True,
    )
)


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
            if node.tag in {"a", "h1", "h2", "h3", "p", "span", "time"}:
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


def _article_link_matches(node: _Node, markup: _Markup, kind: str, path: str) -> bool:
    if kind == "batch":
        return bool(re.fullmatch(r"/the-batch/issue-\d+/?", path))
    elif kind == "stratechery":
        return any(
            ancestor.tag == "li"
            and "category-articles" in (ancestor.attrs.get("class") or "").split()
            and _under(node, ancestor)
            for ancestor in markup.nodes
        ) and bool(re.fullmatch(r"/\d{4}/[^/]+/?", path))
    elif kind == "firstround":
        return any(
            ancestor.tag == "article"
            and "data-post-card-wrapper" in ancestor.attrs
            and _under(node, ancestor)
            for ancestor in markup.nodes
        ) and bool(re.fullmatch(r"/[^/]+/?", path))
    elif kind == "beehiiv":
        return bool(re.fullmatch(r"/p/[^/]+/?", path))
    elif kind == "alphasignal":
        return bool(re.fullmatch(r"/email/[a-f0-9]{16}", path))
    else:
        return bool(re.fullmatch(r"/blog/[^/]+/?", path))


def archive_links(html: str, url: str, kind: str) -> list[str]:
    """Select only article links from the configured publisher's listing."""
    markup = _Markup(html)
    if kind not in {"batch", "stratechery", "beehiiv", "cerebras", "firstround", "alphasignal"}:
        raise registered_feeds.PublicFeedFetchError("Unsupported public archive")
    links: list[str] = []
    for node in markup.nodes:
        if node.tag != "a" or not node.attrs.get("href"):
            continue
        link = _same_origin_link(url, node.attrs["href"] or "")
        if not link:
            continue
        path = urlsplit(link).path
        accepted = _article_link_matches(node, markup, kind, path)
        if accepted and link not in links:
            links.append(link)
        if len(links) == MAX_ARTICLES:
            break
    if not links:
        raise registered_feeds.PublicFeedFetchError(
            "Public archive contained no supported article links"
        )
    return links


@dataclass(frozen=True)
class ArchiveCard:
    link: str
    title: str | None = None
    published: datetime | None = None
    precision: str | None = None


def alphasignal_archive_cards(html: str, url: str) -> list[ArchiveCard]:
    """Bind AlphaSignal's date-only issue cards to their exact public permalinks."""
    cards = _alphasignal_cards(_Markup(html), url)
    if not cards:
        raise registered_feeds.PublicFeedFetchError(
            "Public archive contained no dated, supported AlphaSignal issue cards"
        )
    return cards


def _alphasignal_cards(markup: _Markup, url: str) -> list[ArchiveCard]:
    cards: list[ArchiveCard] = []
    seen: set[str] = set()
    for section in markup.nodes:
        section_date = _alphasignal_section_date(section)
        if section_date is None:
            continue
        month, year = section_date
        for card in markup.nodes:
            if card.tag != "li" or not _under(card, section):
                continue
            parsed = _alphasignal_card(card, markup, url, month, year)
            if parsed is None or parsed.link in seen:
                continue
            cards.append(parsed)
            seen.add(parsed.link)
            if len(cards) == MAX_ARTICLES:
                return cards
    return cards


def _alphasignal_section_date(section: _Node) -> tuple[int, int] | None:
    if section.tag != "section":
        return None
    match = re.fullmatch(r"([A-Z][a-z]+) (\d{4})", section.attrs.get("aria-label") or "")
    months = {
        "January": 1,
        "February": 2,
        "March": 3,
        "April": 4,
        "May": 5,
        "June": 6,
        "July": 7,
        "August": 8,
        "September": 9,
        "October": 10,
        "November": 11,
        "December": 12,
    }
    month = months.get(match.group(1)) if match else None
    return (month, int(match.group(2))) if month else None


def _alphasignal_card(
    card: _Node, markup: _Markup, url: str, month: int, year: int
) -> ArchiveCard | None:
    descendants = [node for node in markup.nodes if _under(node, card)]
    links, dates, titles = _alphasignal_card_fields(descendants, url)
    if len(links) != 1 or len(dates) != 1 or len(titles) != 1:
        return None
    published = _alphasignal_published_date(dates[0], month, year)
    title = titles[0].strip()
    if published is None or not title:
        return None
    return ArchiveCard(links[0], title[:1000], published, "day")


def _alphasignal_card_fields(
    descendants: list[_Node], url: str
) -> tuple[list[str], list[str], list[str]]:
    return (
        _alphasignal_card_links(descendants, url),
        _alphasignal_card_texts(descendants, "type-archive-date"),
        _alphasignal_card_texts(descendants, "type-newsletter-card-title"),
    )


def _alphasignal_card_links(descendants: list[_Node], url: str) -> list[str]:
    links = [
        link
        for node in descendants
        if node.tag == "a"
        and (link := _same_origin_link(url, node.attrs.get("href") or ""))
        and re.fullmatch(r"/email/[a-f0-9]{16}", urlsplit(link).path)
    ]
    return links


def _alphasignal_card_texts(descendants: list[_Node], class_name: str) -> list[str]:
    return [
        node.text
        for node in descendants
        if node.tag == "span" and class_name in (node.attrs.get("class") or "").split()
    ]


def _alphasignal_published_date(value: str, month: int, year: int) -> datetime | None:
    components = _alphasignal_date_components(value)
    if components is None:
        return None
    abbreviation, day, weekday = components
    if _ALPHA_MONTHS[abbreviation] != month:
        return None
    return _alphasignal_calendar_date(year, month, day, weekday)


def _alphasignal_date_components(value: str) -> tuple[str, int, str] | None:
    match = re.fullmatch(
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) "
        r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun)",
        value,
    )
    return (match.group(1), int(match.group(2)), match.group(3)) if match else None


def _alphasignal_calendar_date(year: int, month: int, day: int, weekday: str) -> datetime | None:
    try:
        # The publisher supplies a date only; UTC midnight is storage normalization.
        published = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None
    if published.strftime("%a") != weekday:
        return None
    return published


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


def article_title(html: str) -> str | None:
    """Return only a free article's own title, without inferring its date."""
    markup = _Markup(html)
    accessible, _ = _structured_publication(markup)
    if not accessible:
        return None
    meta = {
        node.attrs.get("property") or node.attrs.get("name"): node.attrs.get("content") or ""
        for node in markup.nodes
        if node.tag == "meta"
    }
    heading = next((node for node in markup.nodes if node.tag == "h1" and node.text), None)
    title = meta.get("og:title") or (heading.text if heading else "")
    return title[:1000] if title else None


@dataclass
class ArchiveResult:
    items: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    dated: int = 0
    latest: datetime | None = None
    listed: int = 0
    latest_listed: datetime | None = None


@dataclass
class _ArchiveFetchContext:
    client: httpx.AsyncClient
    semaphore: asyncio.Semaphore
    article_semaphore: asyncio.Semaphore
    document: registered_feeds.PublicFeedDocument
    kind: str
    since: datetime
    extract_text: Callable[[str, str], str]
    result: ArchiveResult


def _archive_article_publication(
    article: registered_feeds.PublicFeedDocument,
    card: ArchiveCard,
    document_url: str,
    kind: str,
) -> tuple[str, datetime] | None:
    if _same_origin_link(document_url, article.url) is None:
        raise registered_feeds.PublicFeedFetchError(
            "Public archive article redirected off publisher"
        )
    if kind == "alphasignal":
        publication = _alphasignal_article_publication(article, card)
    else:
        publication = article_metadata(article.text, kind)
    if publication is None:
        return None
    title, published = publication
    if published > datetime.now(timezone.utc) + timedelta(minutes=15):
        return None
    return title, published


def _alphasignal_article_publication(
    article: registered_feeds.PublicFeedDocument, card: ArchiveCard
) -> tuple[str, datetime] | None:
    if urlsplit(article.url).path != urlsplit(card.link).path:
        raise registered_feeds.PublicFeedFetchError(
            "AlphaSignal issue redirected to a different permalink"
        )
    accessible, _ = _structured_publication(_Markup(article.text))
    if not accessible:
        return None
    title, published = article_title(article.text), card.published
    title_matches = (
        card.title is not None
        and title is not None
        and " ".join(title.split()).casefold() == " ".join(card.title.split()).casefold()
    )
    return (title, published) if title_matches and published is not None else None


async def _archive_item_content(
    article: registered_feeds.PublicFeedDocument,
    card: ArchiveCard,
    kind: str,
    title: str,
    published: datetime,
    document_url: str,
    extract_text: Callable[[str, str], str],
) -> dict:
    content = await asyncio.to_thread(extract_text, article.text, title)
    if not _archive_body_is_public(content, kind):
        raise registered_feeds.PublicFeedFetchError(
            "Public archive article contained no usable public body"
        )
    item = {"title": title, "link": article.url, "published": published, "content": content}
    _add_alpha_date_evidence(item, card, kind, document_url)
    return item


def _archive_body_is_public(content: str, kind: str) -> bool:
    return len(content) >= 200 and not _contains_alpha_private_notice(content, kind)


def _contains_alpha_private_notice(content: str, kind: str) -> bool:
    pattern = (
        r"please log ?in|sign in to continue|subscribe to read|subscription required|"
        r"create an account to continue|verify you are human|access denied"
    )
    return kind == "alphasignal" and bool(re.search(pattern, content[:500], re.I))


def _add_alpha_date_evidence(item: dict, card: ArchiveCard, kind: str, document_url: str) -> None:
    if kind != "alphasignal":
        return
    item.update(
        {
            "published_precision": card.precision,
            "published_normalization": "date_only_at_00:00_utc",
            "published_evidence": "first_party_archive_card",
            "published_evidence_url": document_url,
        }
    )


def _archive_before_window(kind: str, published: datetime, since: datetime) -> bool:
    if kind == "alphasignal":
        return published.date() < since.astimezone(timezone.utc).date()
    return published < since


async def _load_archive_card(
    card: ArchiveCard,
    client: httpx.AsyncClient,
    document_url: str,
    kind: str,
    since: datetime,
    extract_text: Callable[[str, str], str],
) -> tuple[datetime, dict | None] | None:
    article = await registered_feeds.fetch_public_document(client, card.link)
    publication = _archive_article_publication(article, card, document_url, kind)
    if publication is None:
        return None
    title, published = publication
    if _archive_before_window(kind, published, since):
        return published, None
    item = await _archive_item_content(
        article, card, kind, title, published, document_url, extract_text
    )
    return published, item


async def _fetch_archive_card(card: ArchiveCard, context: _ArchiveFetchContext) -> None:
    try:
        async with context.article_semaphore, context.semaphore:
            outcome = await _load_archive_card(
                card,
                context.client,
                context.document.url,
                context.kind,
                context.since,
                context.extract_text,
            )
        if outcome is None:
            return
        published, item = outcome
        result = context.result
        result.dated += 1
        result.latest = max(result.latest, published) if result.latest else published
        if item is not None:
            result.items.append(item)
    except registered_feeds.PublicFeedFetchError as exc:
        context.result.errors.append(str(exc))
    except (httpx.HTTPError, TimeoutError) as exc:
        context.result.errors.append(f"Public archive article fetch failed ({type(exc).__name__})")


async def _archive_listing(
    source: dict, client: httpx.AsyncClient, semaphore: asyncio.Semaphore
) -> tuple[registered_feeds.PublicFeedDocument, str, list[ArchiveCard]]:
    config = source["archive"]
    async with semaphore:
        document = await registered_feeds.fetch_public_document(
            client, config["url"], allow_prefix=True
        )
    kind = config["kind"]
    if kind == "alphasignal" and document.url != registered_feeds.public_url(config["url"]):
        raise registered_feeds.PublicFeedFetchError(
            "AlphaSignal archive redirected outside its approved listing URL"
        )
    if kind == "alphasignal":
        cards = alphasignal_archive_cards(document.text, document.url)
    else:
        cards = [ArchiveCard(link) for link in archive_links(document.text, document.url, kind)]
    return document, kind, cards


def _select_archive_window(
    cards: list[ArchiveCard], kind: str, since: datetime, result: ArchiveResult
) -> tuple[list[ArchiveCard], bool]:
    if kind != "alphasignal":
        return cards, False
    cutoff = datetime.now(timezone.utc) + timedelta(minutes=15)
    dated_cards = [
        card for card in cards if card.published is not None and card.published <= cutoff
    ]
    result.listed = len(dated_cards)
    result.latest_listed = max(
        (card.published for card in dated_cards if card.published is not None), default=None
    )
    recent_cards = [
        card
        for card in dated_cards
        if card.published is not None
        and card.published.date() >= since.astimezone(timezone.utc).date()
    ]
    _report_stale_archive(result)
    return recent_cards, bool(recent_cards)


def _report_stale_archive(result: ArchiveResult) -> None:
    latest = result.latest_listed
    stale_before = datetime.now(timezone.utc).date() - timedelta(days=ALPHASIGNAL_STALE_GRACE_DAYS)
    if latest is None or latest.date() >= stale_before:
        return
    result.errors.append(
        f"AlphaSignal archive appears stale; latest dated issue: {latest.date().isoformat()}"
    )


def _finish_archive_result(result: ArchiveResult, recent_cards: bool) -> ArchiveResult:
    if result.dated == 0 and not result.errors and (recent_cards or result.listed == 0):
        result.errors.append("Public archive contained no dated, freely accessible articles")
    result.items.sort(key=lambda item: item["published"], reverse=True)
    return result


async def fetch_archive(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    extract_text: Callable[[str, str], str],
) -> ArchiveResult:
    document, kind, cards = await _archive_listing(source, client, semaphore)
    result = ArchiveResult()
    cards, recent_cards = _select_archive_window(cards, kind, since, result)
    context = _ArchiveFetchContext(
        client,
        semaphore,
        asyncio.Semaphore(2),
        document,
        kind,
        since,
        extract_text,
        result,
    )
    await asyncio.gather(*(_fetch_archive_card(card, context) for card in cards))
    return _finish_archive_result(result, recent_cards)
