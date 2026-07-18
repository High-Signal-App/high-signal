"""India D2C agent-visibility overlay (plan 0013, Slice 4).

Asks each configured AI assistant "What are the best <category> brands in
India for <target user>?" for every curated niche, records which brands are
recommended + cited, and writes a dated JSON artifact under
``data/d2c-agent-visibility/``. The sync script persists it into
``d2c_agent_visibility``; the renderer derives the "agent answer gap" for
each Opportunity Brief from the most recent run.

Reuses the same OpenAI-compatible gateway as ``opportunities.py`` and
``generator.py``. No impuls8 data; no paid sources.

Run::

    uv run python -m high_signal_ingest.d2c_agent_visibility \\
        [--limit 20] [--out data/d2c-agent-visibility]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Reuse the same niche seeds as the collector. The prompt is built from the
# seed's category + target user + problem — no external prompt file needed.
from high_signal_ingest.d2c_opportunities import NICHES, NicheQuery

LOGGER = logging.getLogger("d2c_agent_visibility")

# ---------------------------------------------------------------------------
# AI gateway (same pattern as opportunities._complete_text)
# ---------------------------------------------------------------------------

_DEFAULT_BASE = "https://ai-gateway.sassmaker.com/v1"

# Bounded concurrency cap for the 20-niche fan-out. Without this, asyncio.gather
# fires all 20 requests at once against the same gateway. 4 keeps us well under
# the gateway's per-project quota while still finishing a full run in ~5 calls.
_AV_CONCURRENCY = int(os.environ.get("D2C_AV_CONCURRENCY", "4"))
# Bounded retry for transient gateway failures (429/5xx/timeout). Reuses the
# full-jitter discipline from pipeline._with_backoff.
_AV_RETRIES = int(os.environ.get("D2C_AV_RETRIES", "2"))
_AV_BACKOFF_BASE = float(os.environ.get("D2C_AV_BACKOFF_BASE", "1.0"))
_AV_BACKOFF_CAP = float(os.environ.get("D2C_AV_BACKOFF_CAP", "8.0"))
_AV_TIMEOUT = float(os.environ.get("D2C_AV_TIMEOUT", "45.0"))


def _classify_status(status: int) -> str:
    if status == 429:
        return "rate_limited"
    if 500 <= status < 600:
        return "server_error"
    if 400 <= status < 500:
        return "client_error"
    return "ok"


def _is_retryable(cls: str) -> bool:
    return cls in ("rate_limited", "server_error")


def _complete(system: str, user: str, client: httpx.AsyncClient | None = None) -> str | None:
    """Synchronous completion helper for tests (no async). Returns None without a key."""
    base = os.environ.get("AI_BASE_URL", _DEFAULT_BASE)
    key = os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN")
    if not base or not key:
        return None
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": os.environ.get("AI_MODEL", "auto"),
                "project_id": os.environ.get("AI_PROJECT_ID", "high-signal"),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.3,
            },
            timeout=_AV_TIMEOUT,
        )
        r.raise_for_status()
        choice = r.json().get("choices", [{}])[0]
        text = (choice.get("message") or {}).get("content")
        return text.strip() if isinstance(text, str) and text.strip() else None
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None


async def _complete_async(
    system: str, user: str, client: httpx.AsyncClient | None = None
) -> str | None:
    """Async completion via a shared httpx client (one connection pool per run).

    Retries 429/5xx/timeout with full-jitter backoff (bounded by
    ``_AV_RETRIES``); 4xx (non-429) and parse errors are terminal.
    """
    base = os.environ.get("AI_BASE_URL", _DEFAULT_BASE)
    key = os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN")
    if not base or not key:
        return None
    c = client or httpx.AsyncClient(timeout=_AV_TIMEOUT)
    try:
        attempt = 0
        while True:
            attempt += 1
            try:
                r = await c.post(
                    f"{base.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": os.environ.get("AI_MODEL", "auto"),
                        "project_id": os.environ.get("AI_PROJECT_ID", "high-signal"),
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": 0.3,
                    },
                )
                if r.status_code != 200:
                    cls = _classify_status(r.status_code)
                    if _is_retryable(cls) and attempt < _AV_RETRIES:
                        sleep_for = min(_AV_BACKOFF_CAP, _AV_BACKOFF_BASE * (2 ** (attempt - 1)))
                        sleep_for = random.uniform(0, sleep_for)  # full jitter
                        await asyncio.sleep(sleep_for)
                        continue
                    return None
                choice = r.json().get("choices", [{}])[0]
                text = (choice.get("message") or {}).get("content")
                return text.strip() if isinstance(text, str) and text.strip() else None
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt < _AV_RETRIES:
                    sleep_for = min(_AV_BACKOFF_CAP, _AV_BACKOFF_BASE * (2 ** (attempt - 1)))
                    sleep_for = random.uniform(0, sleep_for)
                    await asyncio.sleep(sleep_for)
                    continue
                LOGGER.warning("d2c agent-visibility async call failed: %s", exc)
                return None
            except (ValueError, KeyError, IndexError):
                return None
    finally:
        if client is None:
            await c.aclose()


# ---------------------------------------------------------------------------
# Prompt + extraction (mirrors the TS shared module so tests stay in sync)
# ---------------------------------------------------------------------------

_SYSTEM = (
    "You are a helpful assistant. Answer the question directly with a numbered "
    "list of 3-5 brand options, each with a one-line reason. Cite any sources "
    "you rely on as URLs. If you don't know of specific brands, say so honestly "
    "rather than inventing names."
)


def build_prompt(niche: NicheQuery) -> str:
    return (
        f"What are the best {niche.category} brands in India for {niche.targetUser}? "
        f"List the top 3-5 options with a one-line reason for each, and cite any "
        f"sources you rely on. Focus on products that solve: {niche.problem}"
    )


_NUMBERED_RE = re.compile(r"^\d+[\.\)]\s*")
_BULLET_RE = re.compile(r"^[-•]\s*")
_BOLD_RE = re.compile(r"^\*{2}(.+?)\*{2}")
_PLAIN_RE = re.compile(r"^([A-Z][\w&'.\- ]{1,40}?)\s*[—:\-–(]")
_URL_RE = re.compile(r"https?://[^\s)\"'<>\]]+")

_NON_BRAND = (
    "based on",
    "here are",
    "the best",
    "for indian",
    "i recommend",
    "these brands",
    "note",
    "source",
    "disclaimer",
    "please note",
    "honest note",
    "addressing",
    "important",
    "however",
    "additionally",
    "ultimately",
    "overall",
    "in summary",
    "to summarize",
    "it's worth",
    "its worth",
    "keep in",
    "bear in",
)


def _clean_brand_name(raw: str) -> str | None:
    """Extract a clean brand name from a raw match."""
    before_paren = raw.split("(")[0].strip()
    before_sep = re.split(r"[—:\-–]", before_paren)[0].strip()
    cleaned = before_sep.strip("\"'* ")
    if len(cleaned) < 2 or not cleaned[0].isupper():
        return None
    lower = cleaned.lower()
    if any(lower.startswith(p) for p in _NON_BRAND):
        return None
    return cleaned


def extract_recommended_brands(text: str) -> list[str]:
    brands: list[str] = []
    seen: set[str] = set()
    for line in text.split("\n"):
        t = line.strip()
        if not t:
            continue
        t = _NUMBERED_RE.sub("", t, count=1)
        t = _BULLET_RE.sub("", t, count=1)
        m = _BOLD_RE.match(t)
        if m:
            name = _clean_brand_name(m.group(1))
            if name and name not in seen:
                seen.add(name)
                brands.append(name)
            continue
        m = _PLAIN_RE.match(t)
        if m:
            name = _clean_brand_name(m.group(1))
            if name and name not in seen:
                seen.add(name)
                brands.append(name)
    return brands[:8]


def extract_cited_urls(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for m in _URL_RE.finditer(text):
        url = m.group(0).rstrip(".,;:!?")
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def gap_score(recommended: list[str]) -> float:
    """0 = saturated (4+ brands), 1 = wide open (no brand recommended)."""
    n = len(recommended)
    if n == 0:
        return 1.0
    if n == 1:
        return 0.7
    if n == 2:
        return 0.4
    if n == 3:
        return 0.2
    return 0.0


# ---------------------------------------------------------------------------
# Artifact
# ---------------------------------------------------------------------------


@dataclass
class VisibilityEntry:
    nicheSlug: str
    platform: str
    model: str
    promptText: str
    responseText: str
    recommendedBrands: list[str] = field(default_factory=list)
    citedUrls: list[str] = field(default_factory=list)
    brandMentioned: bool = False
    gapScore: float = 0.0
    runDate: str = ""


@dataclass
class VisibilityArtifact:
    generatedAt: str
    region: str
    entries: list[VisibilityEntry]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


async def run_niche(niche: NicheQuery, client: httpx.AsyncClient | None = None) -> VisibilityEntry:
    prompt = build_prompt(niche)
    response = await _complete_async(_SYSTEM, prompt, client)
    run_date = datetime.now(timezone.utc).isoformat()
    if not response:
        # No AI configured or call failed — record an empty entry with gap=1
        # (the renderer labels it "not yet measured" via the freshness date).
        return VisibilityEntry(
            nicheSlug=niche.slug,
            platform="free-ai-gateway",
            model=os.environ.get("AI_MODEL", "auto"),
            promptText=prompt,
            responseText="",
            recommendedBrands=[],
            citedUrls=[],
            brandMentioned=False,
            gapScore=1.0,
            runDate=run_date,
        )
    brands = extract_recommended_brands(response)
    urls = extract_cited_urls(response)
    return VisibilityEntry(
        nicheSlug=niche.slug,
        platform="free-ai-gateway",
        model=os.environ.get("AI_MODEL", "auto"),
        promptText=prompt,
        responseText=response,
        recommendedBrands=brands,
        citedUrls=urls,
        brandMentioned=len(brands) > 0,
        gapScore=gap_score(brands),
        runDate=run_date,
    )


async def run(limit: int = 20, out_dir: Path = Path("data/d2c-agent-visibility")) -> Path:
    niches = NICHES[:limit]
    # Bounded fan-out: a Semaphore caps concurrent gateway calls so the 20
    # niches cannot amplify into 20 simultaneous requests (gateway quota /
    # subrequest budget). Replaces the prior unbounded asyncio.gather.
    sem = asyncio.Semaphore(_AV_CONCURRENCY)

    async def _bounded(niche: NicheQuery, client: httpx.AsyncClient) -> VisibilityEntry:
        async with sem:
            return await run_niche(niche, client)

    async with httpx.AsyncClient(timeout=_AV_TIMEOUT) as client:
        entries = await asyncio.gather(*(_bounded(n, client) for n in niches))
    artifact = VisibilityArtifact(
        generatedAt=datetime.now(timezone.utc).isoformat(),
        region="IN",
        entries=list(entries),
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = out_dir / f"{date_str}.json"
    out_path.write_text(
        json.dumps(
            {
                "generatedAt": artifact.generatedAt,
                "region": artifact.region,
                "entries": [asdict(e) for e in artifact.entries],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    LOGGER.info(
        "wrote d2c agent-visibility artifact: %s (%d entries)",
        out_path,
        len(artifact.entries),
    )
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="India D2C agent-visibility runner")
    parser.add_argument("--limit", type=int, default=20, help="max niches to query")
    parser.add_argument(
        "--out",
        type=str,
        default="data/d2c-agent-visibility",
        help="output directory for dated JSON artifacts",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out_path = asyncio.run(run(limit=args.limit, out_dir=Path(args.out)))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
