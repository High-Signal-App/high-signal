"""News + blog RSS adapter — reads sources.yaml, extracts article text concurrently."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from html.parser import HTMLParser
from html import escape
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator
from urllib.parse import urljoin

import feedparser
import httpx

from ..seed import load_sources
from .. import audit
from ..types import Event
from ..utils import event_hash
from . import public_archives, registered_feeds


USER_AGENT = "high-signal/0.1 (+https://github.com/sarthakagrawal927)"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 16
PER_HOST_CONCURRENCY = 4


class _FeedText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"p", "br", "div", "li"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def _feed_text(entry: dict) -> str:
    values = [part.get("value", "") for part in entry.get("content", [])]
    values.append(entry.get("summary") or entry.get("description") or "")
    texts: list[str] = []
    for value in values:
        parser = _FeedText()
        parser.feed(value)
        texts.append(" ".join("".join(parser.parts).split()))
    return max(texts, key=len, default="")[:30_000]


def _parse_rfc822(s: str) -> datetime | None:
    try:
        d = parsedate_to_datetime(s)
        return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _parse_iso(s: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


class _ArticleMarkup(HTMLParser):
    """Keep article markup while removing semantic site-navigation containers."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.hidden: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.hidden:
            if tag == self.hidden[-1]:
                self.hidden.append(tag)
            return
        if (
            tag in {"nav", "aside", "footer", "script", "style"}
            or dict(attrs).get("role") == "navigation"
        ):
            self.hidden.append(tag)
            return
        self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag: str) -> None:
        if self.hidden:
            if tag == self.hidden[-1]:
                self.hidden.pop()
            return
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if not self.hidden:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.hidden:
            self.parts.append(f"&#{name};")


_GENERIC_LEADS = set(
    "the a an its it this that these those we our you your dear new how why what when where "
    "who after before according researchers officials company report reports ai api open "
    "security technology tech software cloud market markets news latest exclusive breaking "
    "developers developer launch launches guide top best".split()
)
_SUBJECT_CONTEXT = set(
    "announces announced launches launched releases released ships shipped reports reported "
    "confirms confirmed says said raises raised lowers lowered unveils unveiled discloses "
    "disclosed acquires acquired closes closed cuts wins builds woos ceo ai revenue shares "
    "profit earnings model chip safety".split()
)


def _headline_subject(title: str) -> str | None:
    first = re.match(r"[A-Z][A-Za-z0-9]+", title.strip())
    if not first or len(first[0]) < 3 or first[0].lower() in _GENERIC_LEADS:
        return None
    following = title.strip()[first.end() :]
    second = re.match(r"\s+([A-Za-z]+)", following)
    if not second or second[1].lower() not in _SUBJECT_CONTEXT:
        if not first[0].isupper() and not re.search(r"[A-Z]", first[0][1:]):
            return None
    return first[0].lower()


def article_text_is_aligned(text: str, title: str) -> bool:
    """Reject clear wrong-page/navigation bodies, not ordinary paraphrases.

    A missing proper-name headline anchor is suspicious when the body leads
    with a different named subject or site/digest navigation. Pronoun-led
    single-subject articles remain valid without a title-token quota.
    """
    subject = _headline_subject(title)
    if not subject or re.search(rf"\b{re.escape(subject)}\b", text, re.I):
        return True
    if re.match(r"\s*(?:dear reader\b|(?:ai|infosec|foss)\s*[-•])", text, re.I):
        return False
    if len(re.findall(r"(?:^|\s)[-•]\s", text[:1500])) >= 3:
        return False
    body_subject = _headline_subject(text.lstrip())
    return body_subject is None


def _extract_article_text(html: str, title: str = "") -> str:
    markup = _ArticleMarkup()
    markup.feed(html)
    html = "".join(markup.parts)
    try:
        import trafilatura

        text = (
            trafilatura.extract(
                html,
                include_comments=False,
                include_tables=False,
                fast=True,
            )
            or ""
        )
        if len(text) >= 500 and article_text_is_aligned(text, title):
            return text[:30_000]
    except Exception as exc:
        LOGGER.debug("trafilatura extraction failed: %s", exc)
    try:
        from newspaper import fulltext

        text = (fulltext(html) or "")[:30_000]
        return text if article_text_is_aligned(text, title) else ""
    except Exception as exc:
        LOGGER.debug("newspaper extraction failed: %s", exc)
        return ""


def _parse_feed(xml_text: str, *, base_url: str = "", require_feed: bool = False) -> list[dict]:
    """Parse RSS/Atom into {title, link, pub} dicts."""
    out: list[dict] = []
    if require_feed:
        markup = re.sub(r"<!\[CDATA\[[\s\S]*?\]\]>", "", xml_text)
        if re.search(r"<!DOCTYPE|<!ENTITY", markup, re.I):
            raise registered_feeds.PublicFeedFetchError(
                "Response is not a supported RSS or Atom feed"
            )
    parsed = feedparser.parse(xml_text)
    if require_feed and not parsed.get("version"):
        raise registered_feeds.PublicFeedFetchError("Response is not a supported RSS or Atom feed")
    if getattr(parsed, "bozo", False):
        LOGGER.debug("feedparser marked feed as bozo: %s", getattr(parsed, "bozo_exception", ""))
    for entry in parsed.entries:
        raw_link = (entry.get("link") or "").strip()
        if not raw_link:
            continue
        link = urljoin(base_url, raw_link)
        item = {
            "title": (entry.get("title") or "").strip(),
            "link": link,
            "pub": (
                entry.get("published") or entry.get("updated") or entry.get("created") or ""
            ).strip(),
        }
        retained = _feed_text(entry)
        if retained:
            item["content"] = retained
        out.append(item)
    return out


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            LOGGER.debug("fetch failed url=%s status=%s", url, r.status_code)
            return ""
        return r.text
    except httpx.HTTPError as exc:
        LOGGER.debug("fetch failed url=%s error=%s", url, exc)
        return ""


async def _extract_body(
    client: httpx.AsyncClient,
    url: str,
    semaphore: asyncio.Semaphore,
    *,
    public_only: bool = False,
    title: str = "",
) -> str | None:
    async with semaphore:
        if public_only:
            try:
                html = (await registered_feeds.fetch_public_document(client, url)).text
            except registered_feeds.UnsafeFeedUrl:
                return None
            except (registered_feeds.PublicFeedFetchError, httpx.HTTPError, TimeoutError):
                html = ""
        else:
            html = await _fetch_text(client, url)
    if not html:
        return ""
    return await asyncio.to_thread(_extract_article_text, html, title)


def _feed_candidates(
    items: list[dict], since: datetime, diagnostics: dict | None
) -> list[tuple[dict, datetime]]:
    """Validate public article links/dates and retain a bounded newest-first window."""
    candidates: list[tuple[dict, datetime]] = []
    dates: list[datetime] = []
    for it in items:
        try:
            registered_feeds.public_url(it["link"])
        except registered_feeds.UnsafeFeedUrl:
            continue
        pub_raw = it["pub"]
        pub = _parse_rfc822(pub_raw) or _parse_iso(pub_raw)
        if pub is None:
            continue
        if pub > datetime.now(timezone.utc) + timedelta(minutes=15):
            continue
        dates.append(pub)
        if pub < since:
            continue
        candidates.append((it, pub))

    if diagnostics is not None:
        diagnostics.update(
            {
                "itemsParsed": len(items),
                "latestPublishedAt": max(dates).isoformat() if dates else None,
            }
        )
    candidates = sorted(candidates, key=lambda item: item[1], reverse=True)[:50]

    return candidates


async def fetch_rss_async(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    body_semaphore: asyncio.Semaphore,
    fetch_body: bool = False,
    diagnostics: dict | None = None,
) -> list[Event]:
    """Pull a single RSS source. `source` is one entry from sources.yaml."""
    url = source.get("rss")
    if not url:
        return []
    async with body_semaphore:
        document = await registered_feeds.fetch_public_document(
            client, url, max_bytes=source.get("feed_max_bytes", 2 * 1024 * 1024)
        )
        xml_text, url = document.text, document.url
    items = _parse_feed(xml_text, base_url=url, require_feed=True)
    candidates = _feed_candidates(items, since, diagnostics)

    body_tasks: dict[str, asyncio.Task[str | None]] = {}
    if fetch_body:
        for it, _pub in candidates:
            link = it["link"]
            if link not in body_tasks:
                body_tasks[link] = asyncio.create_task(
                    _extract_body(
                        client,
                        link,
                        body_semaphore,
                        public_only=True,
                        title=it.get("title") or "",
                    )
                )
    out: list[Event] = []
    for it, pub in candidates:
        link = it["link"]
        body = await body_tasks[link] if fetch_body else ""
        if body is None:
            continue
        retained = it.get("content") or ""
        if retained and not article_text_is_aligned(retained, it.get("title") or ""):
            retained = ""
        raw_hash = event_hash(source["id"], link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"news:{source['id']}",
                source_url=link,
                published_at=pub,
                title=it.get("title") or None,
                content=body or retained or None,
                primary_entity_id=None,  # filled later by entity extractor
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_rss(source: dict, since: datetime, fetch_body: bool = False) -> Iterator[Event]:
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY, max_keepalive_connections=8)
    headers = {"User-Agent": USER_AGENT}

    async def _run() -> list[Event]:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=timeout, limits=limits
        ) as client:
            semaphore = asyncio.Semaphore(PER_HOST_CONCURRENCY)
            return await fetch_rss_async(source, since, client, semaphore, fetch_body=fetch_body)

    yield from asyncio.run(_run())


def configured_source_ids() -> set[str]:
    """Curated publication IDs eligible for the normal daily news collector."""
    return {source["id"] for source in registered_feeds.merge_sources(load_sources(), [], 2)}


def _unselected_receipts(requested: set[str], selected: set[str], since: datetime) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "source": f"news:{source_id}",
            "startedAt": now.isoformat(),
            "finishedAt": now.isoformat(),
            "days": max(1, (now - since).days),
            "eventsFetched": 0,
            "errors": 0,
            "notes": json.dumps(
                {
                    "collector": "publication_selection",
                    "status": "not_selected",
                    "reason": "disabled_or_not_eligible",
                    "requestedSourceId": source_id,
                }
            ),
        }
        for source_id in sorted(requested - selected)
    ]


async def fetch_all_async(
    days: int = 1,
    tier_max: int = 2,
    fetch_body: bool = True,
    concurrency: int = DEFAULT_CONCURRENCY,
    source_ids: list[str] | None = None,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    registry = await asyncio.to_thread(audit.fetch_feed_sources)
    seeds = load_sources()
    sources = registered_feeds.merge_sources(seeds, registry, tier_max)
    selection_receipts: list[dict] = []
    if source_ids is not None:
        selected_ids = set(source_ids)
        known_ids = {source["id"] for source in seeds} | {row["id"] for row in registry or []}
        if unknown := selected_ids - known_ids:
            raise registered_feeds.PublicFeedFetchError(
                f"Unknown publication source: {', '.join(sorted(unknown))}"
            )
        sources = [source for source in sources if source["id"] in selected_ids]
        selection_receipts = _unselected_receipts(
            selected_ids, {source["id"] for source in sources}, since
        )
        for receipt in selection_receipts:
            LOGGER.info(
                "publication_source_not_fetched source=%s reason=disabled_or_not_eligible",
                receipt["source"],
            )

    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    headers = {"User-Agent": USER_AGENT}
    body_semaphore = asyncio.Semaphore(concurrency)
    receipts: list[dict] = selection_receipts
    async with httpx.AsyncClient(
        headers=headers,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
    ) as client:
        tasks = [
            _fetch_source(
                src, since, client, body_semaphore, fetch_body=fetch_body, receipts=receipts
            )
            for src in sources
        ]
        batches = await asyncio.gather(*tasks)
    # The existing run schema distinguishes a quiet/stale source from an HTTP,
    # format, or bounded-download failure. These are fetch receipts, not proof
    # that the later event-delivery or publication steps succeeded.
    for offset in range(0, len(receipts), 100):
        await asyncio.to_thread(audit.push_ingest_runs, receipts[offset : offset + 100])
    return [event for batch in batches for event in batch]


async def _fetch_source(
    source: dict,
    since: datetime,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    *,
    fetch_body: bool,
    receipts: list[dict] | None = None,
) -> list[Event]:
    started_at = datetime.now(timezone.utc)
    fetched_at = int(started_at.timestamp())
    events: list[Event] = []
    error = None
    diagnostics: dict = {"collector": "public_archive" if source.get("archive") else "public_rss"}
    try:
        if source.get("archive"):
            result = await public_archives.fetch_archive(
                source, since, client, semaphore, _extract_article_text
            )
            if result.errors:
                error = result.errors[0]
            diagnostics.update(
                {
                    "articlesDated": result.dated,
                    "latestPublishedAt": result.latest.isoformat() if result.latest else None,
                }
            )
            for item in result.items:
                raw_hash = event_hash(source["id"], item["link"])
                events.append(
                    Event(
                        id=raw_hash[:16],
                        source=f"news:{source['id']}",
                        source_url=item["link"],
                        published_at=item["published"],
                        title=item["title"],
                        content=item["content"],
                        primary_entity_id=None,
                        raw_hash=raw_hash,
                    )
                )
        else:
            events = await fetch_rss_async(
                source, since, client, semaphore, fetch_body=fetch_body, diagnostics=diagnostics
            )
    except registered_feeds.PublicFeedFetchError as exc:
        error = str(exc)
    except (httpx.HTTPError, TimeoutError) as exc:
        error = f"Feed fetch failed ({type(exc).__name__})"
    if error:
        LOGGER.warning("publication_source_fetch source=news:%s error=%s", source["id"], error)
    if receipts is not None:
        receipts.append(
            {
                "source": f"news:{source['id']}",
                "startedAt": started_at.isoformat(),
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "days": max(1, (started_at - since).days),
                "eventsFetched": len(events),
                "errors": int(error is not None),
                "errorSample": error,
                "notes": json.dumps(diagnostics),
            }
        )
    if source.get("_registry_id"):
        await registered_feeds.report_fetch(
            source,
            fetched_at=fetched_at,
            count=len(events),
            error=error,
            published_at=max(
                (int(event.published_at.timestamp()) for event in events), default=None
            ),
        )
    return events


def fetch_all(
    days: int = 1,
    tier_max: int = 2,
    fetch_body: bool = True,
    source_ids: list[str] | None = None,
) -> list[Event]:
    return asyncio.run(
        fetch_all_async(days=days, tier_max=tier_max, fetch_body=fetch_body, source_ids=source_ids)
    )
