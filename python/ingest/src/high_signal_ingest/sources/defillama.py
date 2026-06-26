"""DeFiLlama adapter (free, key-less).

On-chain **capital-flow** signal for the finance domain — protocol TVL (total
value locked) and its daily moves. Complements `coingecko` (market *prices*)
with a different, non-redundant view: where capital is actually moving in DeFi.
Filtered to material protocols (TVL > $100M) with a notable 1-day move.

Output: Events tagged `source: defillama`. Daily snapshot, deduped per protocol
+ day. No key required.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ..types import Event

USER_AGENT = "high-signal/0.1 defillama-ingest"
LOGGER = logging.getLogger(__name__)
API = "https://api.llama.fi/protocols"
PROTOCOL_URL = "https://defillama.com/protocol/"
MIN_TVL = 100_000_000.0  # $100M — material protocols only
MIN_MOVE = 10.0          # |1d %| to count as notable
MAX_EVENTS = 25


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def events_from_protocols(rows: list[Any], now: datetime) -> list[Event]:
    movers = [
        p
        for p in (rows if isinstance(rows, list) else [])
        if isinstance(p, dict)
        and isinstance(p.get("tvl"), (int, float))
        and p["tvl"] >= MIN_TVL
        and isinstance(p.get("change_1d"), (int, float))
        and abs(p["change_1d"]) >= MIN_MOVE
    ]
    movers.sort(key=lambda p: abs(p["change_1d"]), reverse=True)
    out: list[Event] = []
    for p in movers[:MAX_EVENTS]:
        name = str(p.get("name") or "").strip()
        slug = str(p.get("slug") or "").strip()
        if not name or not slug:
            continue
        chg = float(p["change_1d"])
        tvl_b = p["tvl"] / 1e9
        cat = str(p.get("category") or "").strip()
        raw_hash = _hash("defillama", slug, now.date().isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source="defillama",
                source_url=f"{PROTOCOL_URL}{slug}",
                published_at=now,
                title=f"DeFi TVL move: {name} ({cat}) {'+' if chg >= 0 else ''}{chg:.1f}% 1d, TVL ${tvl_b:.2f}B",
                content=f"{name} — category {cat}, TVL ${tvl_b:.2f}B, 1-day change {chg:.1f}%.",
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    try:
        with httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, timeout=25.0, follow_redirects=True
        ) as c:
            r = c.get(API)
            r.raise_for_status()
            rows = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("defillama fetch failed: %s", exc)
        return []
    return events_from_protocols(rows, now)
