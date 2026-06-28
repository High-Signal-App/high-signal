"""US government RSS adapter — enforcement / press / halts.

Free feeds only. This adapter covers US government RSS feeds that are NOT
rulemaking (the existing ``gov.py`` adapter handles Federal Register
rulemaking via the Federal Register API). The feeds here are press releases,
enforcement actions, litigation releases, and trade halts — different data:

- SEC litigation releases (sec.gov)
- FTC press releases (ftc.gov)
- DOJ Antitrust Division press releases (justice.gov)
- CFTC general press releases (cftc.gov)
- GAO reports (gao.gov)
- Nasdaq trade halts (nasdaqtrader.com)

Output: Events tagged with ``source: us-gov-rss:<id>``. These are
enforcement/halts signals — the relevance filter is lenient (excludes only
clearly-irrelevant items) so most substantive releases pass through.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — Python < 3.9
    ZoneInfo = None  # type: ignore[assignment]

import feedparser
import httpx

from ..types import Event
from ..utils import event_hash

# Nasdaq halt timestamps are US Eastern. Fall back to UTC if zoneinfo is
# unavailable so the adapter never hard-fails on a missing tz database.
_ET = ZoneInfo("America/New_York") if ZoneInfo else timezone.utc

# SEC enforces a fair-access policy: the User-Agent must declare a contact
# email or it returns 403 (Request Rate Threshold Exceeded). The other feeds
# accept any UA, so one email-bearing UA works for all of them.
USER_AGENT = "high-signal/0.1 us-gov-rss-ingest (contact@highsignal.dev)"
LOGGER = logging.getLogger(__name__)
DEFAULT_CONCURRENCY = 8

# These feeds are enforcement / press / halts — keep most items. Only drop
# clearly non-substantive posts (admin, HR, social, scheduling noise).
IRRELEVANT_TERMS = (
    "holiday schedule",
    "office closure",
    "office closed",
    "photo gallery",
    "career fair",
    "job opening",
    "job posting",
    "internship opportunity",
    "foia reading room",
    "vulnerability disclosure",
    "privacy policy update",
    "website update",
    "system maintenance",
    "scheduled maintenance",
)


# (id, name, rss_url, default_entity_id)
DEFAULT_FEEDS: list[tuple[str, str, str, str | None]] = [
    (
        "sec-litigation",
        "SEC litigation releases",
        "https://www.sec.gov/enforcement-litigation/litigation-releases/rss",
        None,
    ),
    (
        "ftc-press",
        "FTC press releases",
        "https://www.ftc.gov/feeds/press-release.xml",
        None,
    ),
    (
        "doj-antitrust",
        "DOJ Antitrust Division press releases",
        (
            "https://www.justice.gov/news/rss"
            "?type=press_release"
            "&groupname=56"
            "&field_component=376"
            "&search_api_language=en"
            "&show_public_archived=0"
            "&require_all=0"
        ),
        None,
    ),
    (
        "cftc-press",
        "CFTC press releases",
        "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
        None,
    ),
    (
        "gao",
        "GAO reports",
        "https://www.gao.gov/rss/reports.xml",
        None,
    ),
    (
        "nasdaq-halts",
        "Nasdaq trade halts",
        "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts",
        None,
    ),
]


def _is_relevant(title: str, body: str) -> bool:
    """Lenient filter — keep everything except clearly-irrelevant admin noise."""
    text = f"{title} {body}".lower()
    for term in IRRELEVANT_TERMS:
        if term in text:
            return False
    return True


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            LOGGER.warning(
                "us-gov-rss: non-200 (%s) for %s", r.status_code, url
            )
            return ""
        return r.text
    except httpx.HTTPError as exc:
        LOGGER.warning("us-gov-rss: fetch error for %s: %s", url, exc)
        return ""


def _parse_halt_pub(entry: object) -> datetime | None:
    """Nasdaq halt entries carry the actual halt instant in custom
    ``ndaq_haltdate`` (MM/DD/YYYY) + ``ndaq_halttime`` (HH:MM:SS.fff) fields,
    both US Eastern. The shared ``published`` field is just the feed build
    time, so we prefer the per-halt fields when present."""
    halt_date = (entry.get("ndaq_haltdate") or "").strip()  # type: ignore[union-attr]
    halt_time = (entry.get("ndaq_halttime") or "").strip()  # type: ignore[union-attr]
    if not halt_date:
        return None
    try:
        month, day, year = (int(x) for x in halt_date.split("/"))
        hh, mm, ss = 0, 0, 0
        if halt_time:
            parts = halt_time.split(":")
            hh, mm = int(parts[0]), int(parts[1])
            ss = int(parts[2].split(".")[0]) if len(parts) > 2 else 0
        return datetime(year, month, day, hh, mm, ss, tzinfo=_ET).astimezone(
            timezone.utc
        )
    except (ValueError, IndexError):
        return None


def _halt_source_url(symbol: str) -> str:
    """Nasdaq halt items have no per-item link; point at the public halts
    page so every event still carries a citable source URL."""
    return (
        "https://www.nasdaqtrader.com/Trader.aspx?id=TradeHalts"
        f"&symbol={symbol}"
    )


async def fetch_feed_async(
    fid: str,
    name: str,
    url: str,
    entity_id: str | None,
    since: datetime,
    client: httpx.AsyncClient,
) -> list[Event]:
    xml = await _fetch_text(client, url)
    if not xml:
        return []
    parsed = feedparser.parse(xml)
    out: list[Event] = []
    is_halts = fid == "nasdaq-halts"
    for entry in parsed.entries[:25]:
        if is_halts:
            symbol = (entry.get("title") or "").strip()
            issue_name = (entry.get("ndaq_issuename") or "").strip()  # type: ignore[union-attr]
            reason = (entry.get("ndaq_reasoncode") or "").strip()  # type: ignore[union-attr]
            market = (entry.get("ndaq_market") or "").strip()  # type: ignore[union-attr]
            if not symbol:
                continue
            link = _halt_source_url(symbol)
            title = f"{symbol} — {issue_name}" if issue_name else symbol
            body = (
                f"Trade halt on {market}. Reason code: {reason}. "
                f"Issue: {issue_name} ({symbol})."
            ).strip()
            pub = _parse_halt_pub(entry)
            if pub is None:
                # fall back to the feed-level published time
                published = entry.get("published") or ""
                try:
                    pub = parsedate_to_datetime(published) if published else None
                except Exception:
                    pub = None
                if pub is None or pub.tzinfo is None:
                    pub = (pub or datetime.now(timezone.utc)).replace(
                        tzinfo=timezone.utc
                    )
        else:
            link = (entry.get("link") or "").strip()
            if not link:
                continue
            title = (entry.get("title") or "").strip()
            body = (entry.get("summary") or entry.get("description") or "").strip()
            published = entry.get("published") or entry.get("updated") or ""
            try:
                pub = parsedate_to_datetime(published) if published else None
                if pub is None or pub.tzinfo is None:
                    pub = (pub or datetime.now(timezone.utc)).replace(
                        tzinfo=timezone.utc
                    )
            except Exception:
                continue
        if pub < since:
            continue
        if not _is_relevant(title, body):
            continue
        if is_halts:
            # Include the halt instant so repeated halts of the same symbol
            # don't collide on the per-symbol source URL.
            raw_hash = event_hash("us-gov-rss", fid, link, pub.isoformat())
        else:
            raw_hash = event_hash("us-gov-rss", fid, link)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"us-gov-rss:{fid}",
                source_url=link,
                published_at=pub,
                title=f"{name}: {title}" if title else name,
                content=body[:20_000] or None,
                primary_entity_id=entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


async def fetch_all_async(
    days: int = 7,
    feeds: list[tuple[str, str, str, str | None]] | None = None,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    headers = {"User-Agent": USER_AGENT}
    timeout = httpx.Timeout(20.0, connect=10.0)
    limits = httpx.Limits(max_connections=DEFAULT_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=timeout, limits=limits
    ) as client:
        batches = await asyncio.gather(
            *(
                fetch_feed_async(fid, name, url, eid, since, client)
                for fid, name, url, eid in (feeds or DEFAULT_FEEDS)
            )
        )
    return [event for batch in batches for event in batch]


def fetch_all(
    days: int = 7, feeds: list[tuple[str, str, str, str | None]] | None = None
) -> list[Event]:
    return asyncio.run(fetch_all_async(days=days, feeds=feeds))


def fetch_feed(
    fid: str, name: str, url: str, entity_id: str | None, days: int = 7
) -> Iterator[Event]:
    yield from fetch_all(days=days, feeds=[(fid, name, url, entity_id)])
