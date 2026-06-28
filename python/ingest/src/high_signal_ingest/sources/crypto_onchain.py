"""On-chain crypto adapter (mostly key-less).

Covers on-chain signals that **neither** ``coingecko`` (market prices) **nor**
``defillama`` (protocol TVL) provide:

1. **mempool-space** — Bitcoin mempool fee estimation + latest block height
   (key-less, mempool.space public API).
2. **l2beat** — L2 rollup TVL + risk stages (key-less, undocumented JSON API).
3. **coinmetrics** — BTC/ETH on-chain metrics: active addresses, active address
   count, transaction count (key-less, CoinMetrics Community API v4).
4. **etherscan** — Ethereum gas price + ETH supply (free key, env
   ``ETHERSCAN_API_KEY``). Skipped without a key.
5. **token-unlocks** — upcoming token vesting/unlock events (free key, env
   ``TOKEN_UNLOCKS_API_KEY`` via oanor). Skipped without a key.

Output: Events tagged ``source: crypto-onchain:<sub-source>``. Numeric snapshots
(fees, TVL, active addresses) are formatted as readable events. Key-gated
sub-sources return no events when their env var is missing so daily ingest
stays green.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash

USER_AGENT = "high-signal/0.1 crypto-onchain-ingest"
LOGGER = logging.getLogger(__name__)

# Key-less endpoints
MEMPOOL_FEES_URL = "https://mempool.space/api/v1/fees/recommended"
MEMPOOL_TIP_URL = "https://mempool.space/api/blocks/tip/height"
L2BEAT_TVL_URL = "https://l2beat.com/api/tvl.json"
COINMETRICS_URL = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"

# Key-gated endpoints
ETHERSCAN_BASE = "https://api.etherscan.io/api"
TOKEN_UNLOCKS_URL = "https://api.oanor.com/tokenunlocks-api/v1/unlocks"

MAX_CONTENT_CHARS = 20_000
MAX_L2_EVENTS = 15
MAX_UNLOCK_EVENTS = 10


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    )


def _event(sub: str, source_url: str, title: str, content: str, now: datetime, key_parts: tuple[str, ...]) -> Event:
    raw_hash = event_hash("crypto-onchain", sub, *key_parts)
    return Event(
        id=raw_hash[:16],
        source=f"crypto-onchain:{sub}",
        source_url=source_url,
        published_at=now,
        title=title or None,
        content=(content or None)[:MAX_CONTENT_CHARS] if content else None,
        primary_entity_id=None,
        raw_hash=raw_hash,
    )


# ---------------------------------------------------------------------------
# 1. mempool-space — Bitcoin fees + latest block (key-less)
# ---------------------------------------------------------------------------


def _fetch_mempool_space(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    out: list[Event] = []
    with _client() as c:
        fees: dict[str, Any] | None = None
        try:
            r = c.get(MEMPOOL_FEES_URL)
            r.raise_for_status()
            fees = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("mempool-space fees failed: %s", exc)
        if isinstance(fees, dict):
            fastest = fees.get("fastestFee")
            half = fees.get("halfHourFee")
            hour = fees.get("hourFee")
            economy = fees.get("economyFee")
            minimum = fees.get("minimumFee")
            title = f"Bitcoin fees: fastest={fastest} sat/vB"
            content = (
                f"Bitcoin mempool recommended fees (sat/vB): "
                f"fastest={fastest}, half-hour={half}, hour={hour}, "
                f"economy={economy}, minimum={minimum}."
            )
            out.append(
                _event("mempool-space", MEMPOOL_FEES_URL, title, content, now, ("fees", now.date().isoformat()))
            )

        tip: Any = None
        try:
            r = c.get(MEMPOOL_TIP_URL)
            r.raise_for_status()
            tip = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("mempool-space tip failed: %s", exc)
        if tip is not None:
            try:
                height = int(tip)
            except (TypeError, ValueError):
                height = None
            if height is not None:
                title = f"Bitcoin latest block: #{height}"
                content = f"Latest Bitcoin block height: {height}."
                out.append(
                    _event(
                        "mempool-space",
                        MEMPOOL_TIP_URL,
                        title,
                        content,
                        now,
                        ("tip", str(height), now.date().isoformat()),
                    )
                )
    return out


# ---------------------------------------------------------------------------
# 2. l2beat — L2 rollup TVL + risk stages (key-less)
# ---------------------------------------------------------------------------


def _fetch_l2beat(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    try:
        with _client() as c:
            r = c.get(L2BEAT_TVL_URL)
            r.raise_for_status()
            payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("l2beat fetch failed: %s", exc)
        return []
    if not isinstance(payload, dict):
        return []

    # The tvl.json shape exposes projects under `projects` (list) with fields
    # like name, slug, tvl, stage. Be defensive: tolerate alternate keys.
    projects: list[Any] = []
    for key in ("projects", "data", "results"):
        candidate = payload.get(key)
        if isinstance(candidate, list):
            projects = candidate
            break
    if not projects and isinstance(payload.get("projects"), dict):
        # some variants nest as {slug: {...}}
        projects = list(payload["projects"].values())

    rows: list[dict[str, Any]] = []
    for p in projects if isinstance(projects, list) else []:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or p.get("slug") or "").strip()
        if not name:
            continue
        tvl = p.get("tvl")
        if not isinstance(tvl, (int, float)):
            # try nested `tvl` object {total, ...}
            nested = p.get("tvl")
            if isinstance(nested, dict):
                tvl = nested.get("total") if isinstance(nested.get("total"), (int, float)) else None
        if not isinstance(tvl, (int, float)):
            continue
        stage = p.get("stage")
        slug = str(p.get("slug") or name.lower().replace(" ", "-")).strip()
        rows.append({"name": name, "slug": slug, "tvl": float(tvl), "stage": stage})

    rows.sort(key=lambda r: r["tvl"], reverse=True)
    out: list[Event] = []
    for r in rows[:MAX_L2_EVENTS]:
        tvl_b = r["tvl"] / 1e9
        stage = r["stage"]
        stage_txt = f", stage {stage}" if stage not in (None, "") else ""
        title = f"L2 TVL: {r['name']} ${tvl_b:.2f}B{stage_txt}"
        content = (
            f"{r['name']} — L2 rollup TVL ${tvl_b:.2f}B"
            f"{stage_txt}. Source: l2beat.com."
        )
        out.append(
            _event(
                "l2beat",
                f"https://l2beat.com/scaling/projects/{r['slug']}",
                title,
                content,
                now,
                ("l2", r["slug"], now.date().isoformat()),
            )
        )
    return out


# ---------------------------------------------------------------------------
# 3. coinmetrics — BTC/ETH on-chain metrics (key-less)
# ---------------------------------------------------------------------------


def _fetch_coinmetrics(days: int = 1) -> list[Event]:
    now = datetime.now(timezone.utc)
    try:
        with _client() as c:
            r = c.get(
                COINMETRICS_URL,
                params={
                    "metrics": "ActiveAddr,AdrActCnt,TxCnt",
                    "assets": "btc,eth",
                    "limit": "1",
                },
            )
            r.raise_for_status()
            payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("coinmetrics fetch failed: %s", exc)
        return []

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    out: list[Event] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        asset = str(row.get("asset") or "").strip().lower()
        if asset not in ("btc", "eth"):
            continue
        active = row.get("ActiveAddr")
        adr_act = row.get("AdrActCnt")
        tx_cnt = row.get("TxCnt")
        ts = str(row.get("time") or now.date().isoformat())
        label = "Bitcoin" if asset == "btc" else "Ethereum"
        title = f"{label} on-chain: active addresses={active}"
        content = (
            f"{label} on-chain metrics (CoinMetrics, {ts}): "
            f"ActiveAddr={active}, AdrActCnt={adr_act}, TxCnt={tx_cnt}."
        )
        out.append(
            _event(
                "coinmetrics",
                f"https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets={asset}",
                title,
                content,
                now,
                ("cm", asset, ts),
            )
        )
    return out


# ---------------------------------------------------------------------------
# 4. etherscan — Ethereum gas price + ETH supply (free key)
# ---------------------------------------------------------------------------


def _fetch_etherscan(days: int = 1) -> list[Event]:
    key = os.environ.get("ETHERSCAN_API_KEY")
    if not key:
        LOGGER.debug("etherscan skipped: ETHERSCAN_API_KEY is not set")
        return []
    now = datetime.now(timezone.utc)
    out: list[Event] = []
    with _client() as c:
        # ETH supply
        try:
            r = c.get(ETHERSCAN_BASE, params={"module": "stats", "action": "ethsupply", "apikey": key})
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("etherscan ethsupply failed: %s", exc)
            payload = None
        if isinstance(payload, dict) and str(payload.get("status")) == "1":
            supply_raw = payload.get("result")
            try:
                supply_wei = int(supply_raw)
                supply_eth = supply_wei / 1e18
                title = f"Ethereum supply: {supply_eth:,.0f} ETH"
                content = f"Ethereum total supply: {supply_eth:,.2f} ETH ({supply_wei} wei). Source: Etherscan."
                out.append(
                    _event(
                        "etherscan",
                        ETHERSCAN_BASE,
                        title,
                        content,
                        now,
                        ("supply", now.date().isoformat()),
                    )
                )
            except (TypeError, ValueError):
                LOGGER.debug("etherscan ethsupply unparseable: %s", supply_raw)

        # Gas price
        try:
            r = c.get(ETHERSCAN_BASE, params={"module": "proxy", "action": "eth_gasPrice", "apikey": key})
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("etherscan gasprice failed: %s", exc)
            payload = None
        if isinstance(payload, dict):
            result = payload.get("result")
            try:
                gas_wei_hex = str(result)
                gas_wei = int(gas_wei_hex, 16) if gas_wei_hex.startswith(("0x", "0X")) else int(gas_wei_hex)
                gas_gwei = gas_wei / 1e9
                title = f"Ethereum gas price: {gas_gwei:.1f} gwei"
                content = f"Current Ethereum gas price: {gas_gwei:.2f} gwei ({gas_wei} wei). Source: Etherscan."
                out.append(
                    _event(
                        "etherscan",
                        ETHERSCAN_BASE,
                        title,
                        content,
                        now,
                        ("gas", now.date().isoformat(), str(gas_wei)),
                    )
                )
            except (TypeError, ValueError):
                LOGGER.debug("etherscan gasprice unparseable: %s", result)
    return out


# ---------------------------------------------------------------------------
# 5. token-unlocks — upcoming token vesting events (free key)
# ---------------------------------------------------------------------------


def _fetch_token_unlocks(days: int = 1) -> list[Event]:
    key = os.environ.get("TOKEN_UNLOCKS_API_KEY")
    if not key:
        LOGGER.debug("token-unlocks skipped: TOKEN_UNLOCKS_API_KEY is not set")
        return []
    now = datetime.now(timezone.utc)
    try:
        with _client() as c:
            r = c.get(
                TOKEN_UNLOCKS_URL,
                params={"limit": str(MAX_UNLOCK_EVENTS)},
                headers={"Authorization": f"Bearer {key}"},
            )
            r.raise_for_status()
            payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("token-unlocks fetch failed: %s", exc)
        return []

    # Tolerate a few envelope shapes: list, {data:[...]}, {unlocks:[...]}
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        for key_name in ("data", "unlocks", "results", "items"):
            candidate = payload.get(key_name)
            if isinstance(candidate, list):
                rows = candidate
                break
        if not rows and isinstance(payload.get("data"), dict):
            inner = payload["data"]
            for key_name in ("unlocks", "results", "items"):
                candidate = inner.get(key_name)
                if isinstance(candidate, list):
                    rows = candidate
                    break

    out: list[Event] = []
    for row in rows[:MAX_UNLOCK_EVENTS]:
        if not isinstance(row, dict):
            continue
        token = str(row.get("token") or row.get("symbol") or row.get("name") or "").strip()
        if not token:
            continue
        amount = row.get("amount") or row.get("value") or row.get("unlockAmount")
        date = str(row.get("date") or row.get("unlockDate") or row.get("timestamp") or "").strip()
        title = f"Token unlock: {token}"
        content = (
            f"Upcoming token unlock for {token}: amount={amount}, date={date}. "
            f"Source: oanor token-unlocks."
        )
        out.append(
            _event(
                "token-unlocks",
                TOKEN_UNLOCKS_URL,
                title,
                content,
                now,
                ("unlock", token, date or now.date().isoformat()),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------


def fetch_all(days: int = 1) -> list[Event]:
    """Run every on-chain sub-fetcher and concatenate results.

    Key-gated sub-fetchers (etherscan, token-unlocks) return [] when their env
    var is missing, so a key-less environment still yields the key-less events.
    """
    out: list[Event] = []
    out.extend(_fetch_mempool_space(days))
    out.extend(_fetch_l2beat(days))
    out.extend(_fetch_coinmetrics(days))
    out.extend(_fetch_etherscan(days))
    out.extend(_fetch_token_unlocks(days))
    return out
