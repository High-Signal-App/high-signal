"""Prediction-market adapter — Polymarket + Manifold + Kalshi.

Pulls active markets and emits both Event objects (for audit) and quote dicts
(for direct /admin/quotes push). Quotes are time-series so we re-poll every
4h via cron-markets.yml.

Two scopes per source:
- Keyword-filtered: AI-infra / semi markets (legacy, fed brief section 1)
- Firehose / top-by-volume: "what people are betting big on right now"
  irrespective of topic — the broader signal Kalshi and Polymarket actually
  represent ("new kinds of gambling people do").
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from ..extract.entities import gazetteer_match
from ..types import Event


LOGGER = logging.getLogger(__name__)
USER_AGENT = "high-signal/0.1 markets-ingest"

POLYMARKET_BASE = "https://gamma-api.polymarket.com/markets"
MANIFOLD_BASE = "https://api.manifold.markets/v0/search-markets"
# Kalshi migrated to the elections subdomain in 2024 after their election market
# launch. The trading-api alias still works but elections is now canonical.
KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2/markets"

DEFAULT_KEYWORDS: list[str] = [
    "NVIDIA",
    "AI chip",
    "TSMC",
    "OpenAI",
    "AGI",
    "GPU",
    "semiconductor",
    "ASML",
    "data center",
    "Stargate",
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _resolve_entity(text: str) -> str | None:
    hits = gazetteer_match(text or "")
    return hits[0] if hits else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


# --- Polymarket -------------------------------------------------------------


def _poly_url(slug: str | None, market_id: str) -> str:
    if slug:
        return f"https://polymarket.com/event/{slug}"
    return f"https://polymarket.com/market/{market_id}"


def fetch_polymarket(keywords: list[str] | None = None, days: int = 30) -> tuple[list[Event], list[dict]]:
    """Pull active Polymarket markets matching keywords. Returns (events, quotes)."""
    kws = keywords or DEFAULT_KEYWORDS
    events: list[Event] = []
    quotes: list[dict] = []
    seen_ids: set[str] = set()
    timeout = httpx.Timeout(20.0, connect=10.0)
    headers = {"User-Agent": USER_AGENT}
    fetched_at = _now()

    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        for kw in kws:
            try:
                r = client.get(
                    POLYMARKET_BASE,
                    params={"active": "true", "limit": 100, "search": kw},
                )
                if r.status_code != 200:
                    LOGGER.debug("polymarket %s status=%s", kw, r.status_code)
                    continue
                data = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("polymarket %s error: %s", kw, exc)
                continue

            markets = data if isinstance(data, list) else data.get("data") or []
            for m in markets:
                mid = str(m.get("id") or m.get("conditionId") or "")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                question = (m.get("question") or m.get("title") or "").strip()
                if not question:
                    continue
                slug = m.get("slug")
                url = _poly_url(slug, mid)

                # Polymarket "outcomePrices" can be a JSON-string list like '["0.42","0.58"]'
                prob = _extract_poly_prob(m)
                if prob is None:
                    continue
                volume = _safe_float(m.get("volumeNum") or m.get("volume"))
                resolved = bool(m.get("closed") or m.get("resolved"))
                resolved_outcome = None
                if resolved:
                    resolved_outcome = m.get("winningOutcome") or m.get("resolution")

                entity_id = _resolve_entity(question)
                raw_hash = _hash("polymarket", mid, fetched_at.strftime("%Y%m%d%H"))
                events.append(
                    Event(
                        id=raw_hash[:16],
                        source="market:polymarket",
                        source_url=url,
                        published_at=fetched_at,
                        title=question[:300],
                        content=f"Polymarket consensus on '{question}': YES={prob:.2%}",
                        primary_entity_id=entity_id,
                        raw_hash=raw_hash,
                    )
                )
                quotes.append(
                    {
                        "source": "polymarket",
                        "marketId": mid,
                        "entityId": entity_id,
                        "question": question[:500],
                        "outcome": "yes",
                        "prob": prob,
                        "volume": volume,
                        "resolved": resolved,
                        "resolvedOutcome": resolved_outcome,
                        "marketUrl": url,
                        "fetchedAt": fetched_at.isoformat(),
                    }
                )
    return events, quotes


def _extract_poly_prob(m: dict) -> float | None:
    """Polymarket returns YES price either as `lastTradePrice`, `outcomePrices`, or implied."""
    direct = _safe_float(m.get("lastTradePrice"))
    if direct is not None and 0 <= direct <= 1:
        return direct
    op = m.get("outcomePrices")
    if isinstance(op, str):
        try:
            import json

            op = json.loads(op)
        except Exception:
            op = None
    if isinstance(op, list) and op:
        v = _safe_float(op[0])
        if v is not None and 0 <= v <= 1:
            return v
    bid = _safe_float(m.get("bestBid"))
    ask = _safe_float(m.get("bestAsk"))
    if bid is not None and ask is not None:
        return (bid + ask) / 2
    return None


def fetch_polymarket_firehose(top_n: int = 200) -> tuple[list[Event], list[dict]]:
    """Pull the highest-volume currently-active Polymarket markets (no keyword).

    This is the "what's popular right now" signal — political, crypto, sports,
    macro, whatever is moving the most money, irrespective of AI/semi topic.
    """
    events: list[Event] = []
    quotes: list[dict] = []
    seen_ids: set[str] = set()
    timeout = httpx.Timeout(30.0, connect=10.0)
    headers = {"User-Agent": USER_AGENT}
    fetched_at = _now()

    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        try:
            r = client.get(
                POLYMARKET_BASE,
                params={
                    "active": "true",
                    "closed": "false",
                    "limit": min(top_n, 500),
                    "order": "volume24hr",
                    "ascending": "false",
                },
            )
            if r.status_code != 200:
                LOGGER.warning("polymarket firehose status=%s", r.status_code)
                return events, quotes
            data = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.warning("polymarket firehose error: %s", exc)
            return events, quotes

        markets = data if isinstance(data, list) else data.get("data") or []
        for m in markets:
            mid = str(m.get("id") or m.get("conditionId") or "")
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            question = (m.get("question") or m.get("title") or "").strip()
            if not question:
                continue
            prob = _extract_poly_prob(m)
            if prob is None:
                continue
            slug = m.get("slug")
            url = _poly_url(slug, mid)
            volume = _safe_float(m.get("volumeNum") or m.get("volume"))
            resolved = bool(m.get("closed") or m.get("resolved"))
            resolved_outcome = (m.get("winningOutcome") or m.get("resolution")) if resolved else None
            entity_id = _resolve_entity(question)
            raw_hash = _hash("polymarket-firehose", mid, fetched_at.strftime("%Y%m%d%H"))

            events.append(
                Event(
                    id=raw_hash[:16],
                    source="market:polymarket",
                    source_url=url,
                    published_at=fetched_at,
                    title=question[:300],
                    content=f"Polymarket top market '{question}': YES={prob:.2%}",
                    primary_entity_id=entity_id,
                    raw_hash=raw_hash,
                )
            )
            quotes.append(
                {
                    "source": "polymarket",
                    "marketId": mid,
                    "entityId": entity_id,
                    "question": question[:500],
                    "outcome": "yes",
                    "prob": prob,
                    "volume": volume,
                    "resolved": resolved,
                    "resolvedOutcome": resolved_outcome,
                    "marketUrl": url,
                    "fetchedAt": fetched_at.isoformat(),
                }
            )
    return events, quotes


# --- Kalshi -----------------------------------------------------------------


def _kalshi_market_url(ticker: str) -> str:
    return f"https://kalshi.com/markets/{ticker}"


def _kalshi_prob(m: dict) -> Optional[float]:
    """Extract YES probability (0–1) from a Kalshi market dict.

    Kalshi prices are in cents (0–100). Prefer ``last_price``; fall back to
    the ``(yes_bid + yes_ask) / 2`` midpoint when last is missing.
    """

    def _cents_to_prob(v: Any) -> Optional[float]:
        f = _safe_float(v)
        if f is None or not (0 <= f <= 100):
            return None
        return f / 100.0

    last = _cents_to_prob(m.get("last_price"))
    if last is not None:
        return last
    bid = m.get("yes_bid")
    ask = m.get("yes_ask")
    if bid is None or ask is None:
        return None
    bid_f = _safe_float(bid)
    ask_f = _safe_float(ask)
    if bid_f is None or ask_f is None:
        return None
    mid = (bid_f + ask_f) / 2
    if not (0 <= mid <= 100):
        return None
    return mid / 100.0


def parse_kalshi_market(m: dict) -> Optional[dict]:
    """One Kalshi market dict → one quote dict (or None to skip)."""
    if not isinstance(m, dict):
        return None
    ticker = str(m.get("ticker") or "").strip()
    if not ticker:
        return None
    prob = _kalshi_prob(m)
    if prob is None:
        return None
    question = (
        (m.get("title") or m.get("subtitle") or m.get("yes_sub_title") or "").strip()
    )
    if not question:
        question = ticker  # fallback so the row carries something useful
    volume = _safe_float(m.get("volume"))
    status = (m.get("status") or "").lower()
    resolved = status in {"settled", "determined", "closed"}
    resolved_outcome = m.get("result") if resolved else None
    return {
        "source": "kalshi",
        "marketId": ticker,
        "entityId": _resolve_entity(question),
        "question": question[:500],
        "outcome": "yes",
        "prob": prob,
        "volume": volume,
        "resolved": resolved,
        "resolvedOutcome": resolved_outcome,
        "marketUrl": _kalshi_market_url(ticker),
        "fetchedAt": _now().isoformat(),
    }


def parse_kalshi_response(response: Optional[dict]) -> list[dict]:
    """Parse the `/v2/markets` list response into quote dicts."""
    if not response or not isinstance(response, dict):
        return []
    out: list[dict] = []
    for m in response.get("markets") or []:
        q = parse_kalshi_market(m)
        if q is not None:
            out.append(q)
    return out


def fetch_kalshi(top_n: int = 200, max_pages: int = 4) -> tuple[list[Event], list[dict]]:
    """Pull active Kalshi markets via cursor pagination.

    Kalshi caps `limit` at 200; we walk pages until we have ~`top_n` rows
    or pagination exhausts. No auth needed for read.
    """
    events: list[Event] = []
    quotes: list[dict] = []
    timeout = httpx.Timeout(30.0, connect=10.0)
    headers = {"User-Agent": USER_AGENT}
    fetched_at = _now()
    cursor: Optional[str] = None
    page_limit = min(200, top_n)

    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        for _ in range(max_pages):
            params: dict[str, Any] = {"limit": page_limit, "status": "open"}
            if cursor:
                params["cursor"] = cursor
            try:
                r = client.get(KALSHI_BASE, params=params)
                if r.status_code != 200:
                    LOGGER.warning("kalshi status=%s", r.status_code)
                    break
                data = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.warning("kalshi error: %s", exc)
                break

            for q in parse_kalshi_response(data):
                quotes.append(q)
                raw_hash = _hash("kalshi", q["marketId"], fetched_at.strftime("%Y%m%d%H"))
                events.append(
                    Event(
                        id=raw_hash[:16],
                        source="market:kalshi",
                        source_url=q["marketUrl"],
                        published_at=fetched_at,
                        title=q["question"][:300],
                        content=f"Kalshi market '{q['question']}': YES={q['prob']:.2%}",
                        primary_entity_id=q["entityId"],
                        raw_hash=raw_hash,
                    )
                )

            cursor = data.get("cursor") if isinstance(data, dict) else None
            if not cursor or len(quotes) >= top_n:
                break

    return events, quotes


# --- Manifold ---------------------------------------------------------------


def fetch_manifold(keywords: list[str] | None = None) -> tuple[list[Event], list[dict]]:
    """Pull Manifold Markets matching keywords. Returns (events, quotes)."""
    kws = keywords or DEFAULT_KEYWORDS
    events: list[Event] = []
    quotes: list[dict] = []
    seen_ids: set[str] = set()
    timeout = httpx.Timeout(20.0, connect=10.0)
    headers = {"User-Agent": USER_AGENT}
    fetched_at = _now()

    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        for kw in kws:
            try:
                r = client.get(MANIFOLD_BASE, params={"term": kw, "limit": 25})
                if r.status_code != 200:
                    LOGGER.debug("manifold %s status=%s", kw, r.status_code)
                    continue
                data = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("manifold %s error: %s", kw, exc)
                continue

            markets = data if isinstance(data, list) else data.get("markets") or []
            for m in markets:
                mid = str(m.get("id") or "")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                question = (m.get("question") or "").strip()
                if not question:
                    continue
                # Manifold uses "BINARY", "MULTIPLE_CHOICE", etc. Only handle binary cleanly.
                outcome_type = (m.get("outcomeType") or "").upper()
                prob = _safe_float(m.get("probability"))
                if outcome_type != "BINARY" or prob is None:
                    continue
                url = m.get("url") or f"https://manifold.markets/market/{m.get('slug') or mid}"
                volume = _safe_float(m.get("volume"))
                resolved = bool(m.get("isResolved"))
                resolved_outcome = m.get("resolution") if resolved else None
                entity_id = _resolve_entity(question)
                raw_hash = _hash("manifold", mid, fetched_at.strftime("%Y%m%d%H"))

                events.append(
                    Event(
                        id=raw_hash[:16],
                        source="market:manifold",
                        source_url=url,
                        published_at=fetched_at,
                        title=question[:300],
                        content=f"Manifold consensus on '{question}': YES={prob:.2%}",
                        primary_entity_id=entity_id,
                        raw_hash=raw_hash,
                    )
                )
                quotes.append(
                    {
                        "source": "manifold",
                        "marketId": mid,
                        "entityId": entity_id,
                        "question": question[:500],
                        "outcome": "binary",
                        "prob": prob,
                        "volume": volume,
                        "resolved": resolved,
                        "resolvedOutcome": resolved_outcome,
                        "marketUrl": url,
                        "fetchedAt": fetched_at.isoformat(),
                    }
                )
    return events, quotes


# --- Aggregate + push -------------------------------------------------------


def fetch_all(
    keywords: list[str] | None = None,
    days: int = 30,
    firehose_top_n: int = 200,
) -> tuple[list[Event], list[dict]]:
    """Run all four scopes: Polymarket (keyword + firehose), Manifold, Kalshi.

    Returns (events, quotes). Failures in one source are logged and skipped;
    the others still run.
    """
    events: list[Event] = []
    quotes: list[dict] = []
    seen_quote_ids: set[tuple[str, str]] = set()

    def _extend(source_name: str, fetcher):
        try:
            evts, qs = fetcher()
        except Exception as exc:  # noqa: BLE001 — third-party network calls
            LOGGER.warning("%s fetch failed: %s", source_name, exc)
            return
        events.extend(evts)
        # Dedupe quotes within a single run (firehose and keyword may both
        # surface a hot Polymarket market — keep the first only).
        for q in qs:
            key = (q["source"], q["marketId"])
            if key in seen_quote_ids:
                continue
            seen_quote_ids.add(key)
            quotes.append(q)

    _extend("polymarket (keyword)",   lambda: fetch_polymarket(keywords, days=days))
    _extend("polymarket (firehose)",  lambda: fetch_polymarket_firehose(top_n=firehose_top_n))
    _extend("manifold",               lambda: fetch_manifold(keywords))
    _extend("kalshi",                 lambda: fetch_kalshi(top_n=firehose_top_n))
    return events, quotes


def push_quotes(quotes: list[dict]) -> int:
    """POST quotes to /admin/quotes. Mirrors writer.push_signal pattern."""
    if not quotes:
        return 0
    api = os.environ.get("API_BASE")
    tok = os.environ.get("ADMIN_TOKEN")
    if not api or not tok:
        LOGGER.info("push_quotes skipped — API_BASE or ADMIN_TOKEN missing")
        return 0
    total = 0
    chunk = 100
    with httpx.Client(timeout=30.0) as client:
        for i in range(0, len(quotes), chunk):
            batch = quotes[i : i + chunk]
            try:
                r = client.post(
                    f"{api.rstrip('/')}/admin/quotes",
                    headers={
                        "Authorization": f"Bearer {tok}",
                        "Content-Type": "application/json",
                    },
                    json={"quotes": batch},
                )
                if r.status_code >= 400:
                    LOGGER.warning("push_quotes %s %s", r.status_code, r.text[:200])
                    continue
                total += len(batch)
            except httpx.HTTPError as exc:
                LOGGER.warning("push_quotes error: %s", exc)
    return total
