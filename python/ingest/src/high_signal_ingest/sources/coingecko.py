"""CoinGecko adapter (free, key-less).

Crypto market signal for the **finance** domain — High Signal had zero crypto
coverage. Pulls two snapshots from the free API: coins **trending** on CoinGecko
(attention), and notable **24h movers** from the top market-cap coins (price
action). Maps to tracked crypto entities (e.g. Circle/USDC) where present;
otherwise feeds the finance domain as market context.

Output: Events tagged `source: coingecko`. No key required (free-tier rate
limits apply; a handful of calls per run stays well under).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ..types import Event

USER_AGENT = "high-signal/0.1 coingecko-ingest"
LOGGER = logging.getLogger(__name__)
API = "https://api.coingecko.com/api/v3"
COIN_URL = "https://www.coingecko.com/en/coins/"
MOVER_THRESHOLD = 15.0  # |24h %| to count as a notable move


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _event(coin_id: str, title: str, content: str, now: datetime, kind: str) -> Event:
    raw_hash = _hash("coingecko", kind, coin_id, now.date().isoformat())
    return Event(
        id=raw_hash[:16],
        source="coingecko",
        source_url=f"{COIN_URL}{coin_id}",
        published_at=now,
        title=title,
        content=content or None,
        primary_entity_id=None,
        raw_hash=raw_hash,
    )


def trending_events(payload: dict[str, Any], now: datetime) -> list[Event]:
    out: list[Event] = []
    for c in payload.get("coins", []) if isinstance(payload, dict) else []:
        item = c.get("item") if isinstance(c, dict) else None
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        if not cid or not name:
            continue
        sym = str(item.get("symbol") or "").upper()
        rank = item.get("market_cap_rank")
        out.append(
            _event(cid, f"Crypto trending: {name} ({sym})", f"Trending on CoinGecko. Market-cap rank: {rank}.", now, "trend")
        )
    return out


def mover_events(rows: list[Any], now: datetime) -> list[Event]:
    out: list[Event] = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        chg = r.get("price_change_percentage_24h")
        cid = str(r.get("id") or "").strip()
        name = str(r.get("name") or "").strip()
        if not cid or not name or not isinstance(chg, (int, float)) or abs(chg) < MOVER_THRESHOLD:
            continue
        sym = str(r.get("symbol") or "").upper()
        arrow = "+" if chg >= 0 else ""
        out.append(
            _event(
                cid,
                f"Crypto mover: {name} ({sym}) {arrow}{chg:.1f}% 24h",
                f"Price ${r.get('current_price')}, market cap ${r.get('market_cap')}, 24h change {chg:.1f}%.",
                now,
                "move",
            )
        )
    return out


def fetch_all(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, timeout=20.0, follow_redirects=True
    ) as c:
        try:
            r = c.get(f"{API}/search/trending")
            r.raise_for_status()
            out.extend(trending_events(r.json(), now))
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("coingecko trending failed: %s", exc)
        try:
            r = c.get(
                f"{API}/coins/markets",
                params={"vs_currency": "usd", "order": "market_cap_desc", "per_page": 100, "page": 1},
            )
            r.raise_for_status()
            out.extend(mover_events(r.json(), now))
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("coingecko markets failed: %s", exc)
    return out
