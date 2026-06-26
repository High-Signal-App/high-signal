"""Apple App Store top-charts adapter (free, key-less).

Consumer **traction** signal for the startups / new-ideas domains — *what's
winning*, distinct from Product Hunt's *what just launched*. Apple's marketing
RSS exposes the top-free / top-grossing charts as key-less JSON.

Output: Events tagged `source: appstore`. A daily snapshot (rank position is the
signal), deduped per app + chart + day. No key required.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ..types import Event

USER_AGENT = "high-signal/0.1 appstore-ingest"
LOGGER = logging.getLogger(__name__)
API = "https://rss.applemarketingtools.com/api/v2/us/apps"
# (chart slug, human label, how many). Apple's marketing RSS only serves the
# top-free apps chart now (paid/grossing return empty).
CHARTS: tuple[tuple[str, str, int], ...] = (("top-free", "Top Free", 50),)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def events_from_chart(chart: str, label: str, payload: dict[str, Any], now: datetime) -> list[Event]:
    results = payload.get("feed", {}).get("results", []) if isinstance(payload, dict) else []
    out: list[Event] = []
    for rank, app in enumerate(results, start=1):
        if not isinstance(app, dict):
            continue
        name = str(app.get("name") or "").strip()
        url = str(app.get("url") or "").strip()
        if not name or not url:
            continue
        artist = str(app.get("artistName") or "").strip()
        genres = ", ".join(g.get("name", "") for g in app.get("genres", []) if isinstance(g, dict))
        raw_hash = _hash("appstore", chart, str(app.get("id") or name), now.date().isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"appstore:{chart}",
                source_url=url,
                published_at=now,
                title=f"App Store {label} #{rank}: {name} — {artist}",
                content=f"Rank {rank} on {label}. Developer: {artist}. Genre: {genres}." or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_all(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, timeout=20.0, follow_redirects=True
    ) as c:
        for chart, label, count in CHARTS:
            try:
                r = c.get(f"{API}/{chart}/{count}/apps.json")
                r.raise_for_status()
                out.extend(events_from_chart(chart, label, r.json(), now))
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("appstore %s failed: %s", chart, exc)
    return out
