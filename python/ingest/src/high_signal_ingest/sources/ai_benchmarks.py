"""AI model benchmarking / leaderboard adapter.

Covers three sub-sources that track relative LLM quality, speed, pricing, and
real-world usage:

1. **lmsys** — Arena AI (formerly LMSYS Chatbot Arena) ELO leaderboard. Keyless
   via the community REST API at ``api.wulong.dev`` which mirrors the daily
   snapshot of the public arena.ai leaderboards as structured JSON.
2. **artificial-analysis** — Artificial Analysis independent benchmarks
   (intelligence index, speed, pricing). Uses the free-tier endpoint
   ``/api/v2/language/models/free`` which accepts any valid API key. Skipped
   gracefully when ``ARTIFICIAL_ANALYSIS_API_KEY`` is unset.
3. **openrouter-data** — OpenRouter daily token-usage rankings (top 50 models
   by total tokens). Gated by ``OPENROUTER_API_KEY``; skipped without it.

Each sub-source emits a small number of leaderboard-snapshot events (one per
fetch) rather than one event per model, so the brief sees a digestible signal
("top model is X (ELO=1400)") plus a top-10 table in the content body.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 ai-benchmarks-ingest"
LOGGER = logging.getLogger(__name__)

CONTENT_CAP = 20_000

LMSYS_API_URL = "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard"
LMSYS_LEADERBOARD = "text"  # the main LLM arena leaderboard
LMSYS_FALLBACK_URL = "https://arena.ai/leaderboard/"

ARTIFICIAL_ANALYSIS_API_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
ARTIFICIAL_ANALYSIS_LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models"

OPENROUTER_RANKINGS_URL = "https://openrouter.ai/api/v1/datasets/rankings-daily"
OPENROUTER_RANKINGS_PAGE_URL = "https://openrouter.ai/rankings"


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _format_table(header: list[str], rows: list[list[str]]) -> str:
    """Render a compact markdown-style table from header + row lists."""
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# lmsys — Arena AI (formerly LMSYS Chatbot Arena) ELO leaderboard (keyless)
# ---------------------------------------------------------------------------

def _fetch_lmsys(days: int = 1) -> list[Event]:
    """Fetch the latest Arena AI text (LLM) leaderboard snapshot.

    The community API at api.wulong.dev mirrors arena.ai daily with no auth.
    Response shape::

        {"meta": {"leaderboard": "text", "source_url": "...",
                  "fetched_at": "2026-03-21T05:12:05+00:00", "model_count": N},
         "models": [{"rank": 1, "model": "...", "vendor": "...",
                     "license": "...", "score": 1381, "ci": 8, "votes": 5537}, ...]}
    """
    try:
        response = httpx.get(
            LMSYS_API_URL,
            params={"name": LMSYS_LEADERBOARD},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=20.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("lmsys fetch failed error=%s", exc)
        return []

    if not isinstance(payload, dict):
        return []

    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    models = payload.get("models") if isinstance(payload.get("models"), list) else []
    if not models:
        return []

    fetched_at = _parse_datetime(str(meta.get("fetched_at") or "")) or datetime.now(timezone.utc)
    source_url = str(meta.get("source_url") or LMSYS_FALLBACK_URL)

    top = [m for m in models if isinstance(m, dict)][:10]
    top_model = top[0] if top else {}
    top_name = str(top_model.get("model") or "unknown")
    top_score = top_model.get("score")

    title = f"LMSYS Chatbot Arena: top model is {top_name}"
    if top_score is not None:
        title += f" (ELO={top_score})"

    table_rows = [
        [
            str(m.get("rank") or ""),
            str(m.get("model") or ""),
            str(m.get("vendor") or ""),
            str(m.get("score") or ""),
            str(m.get("ci") or ""),
            str(m.get("votes") or ""),
        ]
        for m in top
    ]
    content = _format_table(
        ["Rank", "Model", "Vendor", "ELO", "CI", "Votes"], table_rows
    )

    raw_hash = event_hash("ai-benchmarks:lmsys", LMSYS_LEADERBOARD, fetched_at.date().isoformat())
    return [
        Event(
            id=raw_hash[:16],
            source="ai-benchmarks:lmsys",
            source_url=source_url,
            published_at=fetched_at,
            title=title,
            content=content[:CONTENT_CAP] or None,
            raw_hash=raw_hash,
        )
    ]


# ---------------------------------------------------------------------------
# artificial-analysis — independent benchmarks (free-key gated)
# ---------------------------------------------------------------------------

def _fetch_artificial_analysis(days: int = 1) -> list[Event]:
    """Fetch the Artificial Analysis free-tier model leaderboard.

    Requires ``ARTIFICIAL_ANALYSIS_API_KEY`` (sent via the ``x-api-key``
    header). The free endpoint returns the public subset of fields: headline
    intelligence index, median speed/latency, and input/output pricing. Skipped
    gracefully when the key is missing.

    Response shape::

        {"intelligence_index_version": 4.1,
         "data": [{"slug": "...", "name": "...",
                   "model_creator": {"name": "OpenAI"},
                   "evaluations": {"artificial_analysis_intelligence_index": 53.1, ...},
                   "pricing": {"price_1m_input_tokens": 5, "price_1m_output_tokens": 30},
                   "performance": {"median_output_tokens_per_second": 82.62,
                                   "median_time_to_first_token_seconds": 13.84}}, ...]}
    """
    key = os.environ.get("ARTIFICIAL_ANALYSIS_API_KEY")
    if not key:
        LOGGER.debug("artificial-analysis skipped: ARTIFICIAL_ANALYSIS_API_KEY is not set")
        return []

    try:
        response = httpx.get(
            ARTIFICIAL_ANALYSIS_API_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json", "x-api-key": key},
            timeout=20.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("artificial-analysis fetch failed error=%s", exc)
        return []

    if not isinstance(payload, dict):
        return []

    data = payload.get("data") if isinstance(payload.get("data"), list) else []
    if not data:
        return []

    now = datetime.now(timezone.utc)

    def _iq(model: dict[str, Any]) -> float:
        ev = model.get("evaluations") if isinstance(model.get("evaluations"), dict) else {}
        try:
            return float(ev.get("artificial_analysis_intelligence_index") or 0)
        except (TypeError, ValueError):
            return 0.0

    ranked = sorted(
        (m for m in data if isinstance(m, dict)),
        key=_iq,
        reverse=True,
    )
    top = ranked[:10]
    if not top:
        return []

    top_model = top[0]
    top_name = str(top_model.get("name") or top_model.get("slug") or "unknown")
    top_iq = _iq(top_model)

    title = f"Artificial Analysis: top model is {top_name} (IQ={top_iq:g})"

    table_rows: list[list[str]] = []
    for m in top:
        ev = m.get("evaluations") if isinstance(m.get("evaluations"), dict) else {}
        pricing = m.get("pricing") if isinstance(m.get("pricing"), dict) else {}
        perf = m.get("performance") if isinstance(m.get("performance"), dict) else {}
        creator = m.get("model_creator") if isinstance(m.get("model_creator"), dict) else {}
        table_rows.append(
            [
                str(m.get("name") or m.get("slug") or ""),
                str(creator.get("name") or ""),
                f"{_iq(m):g}",
                str(ev.get("artificial_analysis_coding_index") or ""),
                f"${pricing.get('price_1m_input_tokens', '')}/{pricing.get('price_1m_output_tokens', '')}",
                f"{perf.get('median_output_tokens_per_second', '')}",
            ]
        )

    content = _format_table(
        ["Model", "Creator", "Intelligence", "Coding", "Price $in/$out (1M)", "Tokens/s"],
        table_rows,
    )

    raw_hash = event_hash("ai-benchmarks:artificial-analysis", now.date().isoformat())
    return [
        Event(
            id=raw_hash[:16],
            source="ai-benchmarks:artificial-analysis",
            source_url=ARTIFICIAL_ANALYSIS_LEADERBOARD_URL,
            published_at=now,
            title=title,
            content=content[:CONTENT_CAP] or None,
            raw_hash=raw_hash,
        )
    ]


# ---------------------------------------------------------------------------
# openrouter-data — daily token-usage rankings (free-key gated)
# ---------------------------------------------------------------------------

def _fetch_openrouter(days: int = 1) -> list[Event]:
    """Fetch OpenRouter daily token-usage rankings for the trailing window.

    Requires ``OPENROUTER_API_KEY`` (sent as a bearer token). The
    ``rankings-daily`` endpoint returns up to 51 rows per day (top 50 models by
    total tokens plus an aggregated ``other`` row). Skipped gracefully when the
    key is missing.

    Response rows are sorted by ``date`` ascending then ``total_tokens``
    descending; the ``other`` row is pinned last within each date.
    """
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        LOGGER.debug("openrouter-data skipped: OPENROUTER_API_KEY is not set")
        return []

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=max(1, days))
    try:
        response = httpx.get(
            OPENROUTER_RANKINGS_URL,
            params={"start_date": start.isoformat(), "end_date": end.isoformat()},
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Authorization": f"Bearer {key}",
            },
            timeout=20.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("openrouter-data fetch failed error=%s", exc)
        return []

    if not isinstance(payload, dict):
        return []

    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    if not rows:
        # some responses nest rows directly
        rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    if not rows:
        return []

    now = datetime.now(timezone.utc)

    # group rows by date, take the most recent day with real model rows
    by_date: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        date_str = str(row.get("date") or "")
        if not date_str:
            continue
        by_date.setdefault(date_str, []).append(row)

    if not by_date:
        return []

    latest_date = sorted(by_date.keys())[-1]
    day_rows = [
        r for r in by_date[latest_date]
        if str(r.get("model_permaslug") or "") != "other"
    ]
    if not day_rows:
        day_rows = by_date[latest_date]

    day_rows.sort(
        key=lambda r: int(r.get("total_tokens") or 0),
        reverse=True,
    )
    top = day_rows[:10]
    if not top:
        return []

    top_model = top[0]
    top_slug = str(top_model.get("model_permaslug") or "unknown")
    top_tokens = top_model.get("total_tokens")

    title = f"OpenRouter rankings: top model is {top_slug}"
    if top_tokens is not None:
        title += f" ({int(top_tokens):,} tokens)"

    table_rows = [
        [
            str(r.get("model_permaslug") or ""),
            f"{int(r.get('total_tokens') or 0):,}",
            f"{int(r.get('prompt_tokens') or 0):,}",
            f"{int(r.get('completion_tokens') or 0):,}",
        ]
        for r in top
    ]
    content = _format_table(
        ["Model", "Total Tokens", "Prompt Tokens", "Completion Tokens"], table_rows
    )

    published = _parse_datetime(latest_date) or now

    raw_hash = event_hash("ai-benchmarks:openrouter", latest_date)
    return [
        Event(
            id=raw_hash[:16],
            source="ai-benchmarks:openrouter",
            source_url=OPENROUTER_RANKINGS_PAGE_URL,
            published_at=published,
            title=title,
            content=content[:CONTENT_CAP] or None,
            raw_hash=raw_hash,
        )
    ]


# ---------------------------------------------------------------------------
# top-level fan-out
# ---------------------------------------------------------------------------

def fetch_all(days: int = 1) -> list[Event]:
    """Run every AI-benchmark sub-source and concatenate results.

    Key-gated sources (artificial-analysis, openrouter) skip silently when
    their env var is unset so daily ingest stays green.
    """
    out: list[Event] = []
    out.extend(_fetch_lmsys(days))
    out.extend(_fetch_artificial_analysis(days))
    out.extend(_fetch_openrouter(days))
    return out
