"""Signal generator — uses an LLM to draft signal candidates from events.

Inputs: a clustered set of events about an entity over a window.
Output: SignalCandidate(s) ready for human review.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Iterable, cast

import httpx

from .seed import signal_type_ids
from .types import Confidence, Direction, Event, EvidenceItem, SignalCandidate

_PROMPT_TEMPLATE = """You are a signal extractor for the active High Signal collection:
AI-infra / semiconductor market intelligence.

Your job is NOT to generate random insights. Given source events for one primary
entity, decide whether there is an actionable, collection-aligned signal draft
for review: what changed, who is affected, what direction it points, why it
matters, and what evidence supports it. Do not hide weak-but-relevant events:
publish them as low confidence instead of returning nothing.

Output STRICT JSON (no commentary):
{
  "publish": true|false,
  "signal_type": "<prefer one of: __SIGNAL_TYPES__; or create a concise snake_case type>",
  "direction": "up|down|neutral",
  "confidence": "low|medium|high",
  "predicted_window_days": <int 5-90>,
  "spillover_entity_ids": ["TSMC","ASML",...],
  "headline": "<<= 90 chars>",
  "body_md": "<150-400 word evidence walkthrough citing each source by URL>"
}

Rules:
- "publish": true only when the event is aligned with the active collection and
  implies a concrete company, sector, supply-chain, demand, financing, product,
  regulatory, or competitive change. Use low confidence for weak or single-source
  aligned items instead of publish=false.
- Cite every supplied source used in body_md as inline links. Medium/high
  confidence drafts need ≥ 2 distinct sources; low confidence drafts may use 1.
- "confidence" calibration:
  - low: single source, weak source, rumor, or early uncorroborated clue
  - medium: 2 corroborating sources
  - high: official filing/press release + corroborating coverage
- "signal_type" should stay dynamic:
  - Prefer the configured taxonomy when it fits.
  - If none fits, create a specific snake_case type, e.g. "pricing_page_change",
    "customer_churn_signal", "developer_adoption_spike", "credit_facility_update".
  - Do not invent a type for trivia, generic news, or off-collection observations.
  - Do not force every event into a market-only bucket, but every type must name
    a repeatable insight pattern.
- "spillover_entity_ids" must be a subset of the provided spillover candidates
- Window: capex 30-60d, lead-time 15-30d, design-win 60-90d, restriction 5-20d, earnings 5-15d
- DIRECTION calibration — DO NOT default to "up". This is the most important rule.
  Before deciding direction, write out (silently) BOTH the bull case AND the bear case
  the headline implies for the primary entity, then pick whichever is materially supported.
  - Misses, guidance cuts, layoffs, export restrictions, supply-chain hits,
    short reports, IP losses, design losses, regulator probes, capex CUT,
    inventory build, ASP decline, share-loss → "down"
  - Beats, raises, design wins, capex bumps, partnership ups, ASP up,
    share gains, lead-time tightening on a SHIPPING product → "up"
  - PR fluff, vague AI mentions, anniversary news, conflicting reports,
    sector rallies without entity-specific cause → "neutral" OR publish=false
- Negative-side examples that are EASY TO MISS (treat as "down"):
  * "X considering layoffs" — down
  * "Y postpones launch" — down
  * "Customer Z shifts allocation away from W" — down for W
  * "Supplier shutdown forces production pause" — down for affected
  * "Z's [product] underperforms benchmarks" — down
- Refuse-to-publish when the sources are off-collection, pure duplicate noise,
  generic commentary, generic AI-stock-rally coverage, or contain no entity-specific
  change. Dynamic signal types are allowed; random observations are not.
- Treat the supplied event timestamps as the *as-of* moment. Reason ONLY from
  facts in the provided sources or knowledge that predates the latest source.
  Do NOT use any knowledge of events that occurred after the last source date.
"""


def _prompt() -> str:
    return _PROMPT_TEMPLATE.replace("__SIGNAL_TYPES__", ", ".join(signal_type_ids()))


def _slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or "signal"


def _signal_type_id(s: object, fallback: str = "emerging_signal") -> str:
    """Normalize seeded or model-created signal types into stable ids."""
    out = re.sub(r"[^a-z0-9]+", "_", str(s or "").lower()).strip("_")
    out = re.sub(r"_+", "_", out)
    if not out or not re.match(r"^[a-z][a-z0-9_]{2,63}$", out):
        return fallback
    return out[:64]


PROMPT_VERSION = "v2"

_DOWN_KEYWORDS = (
    "cut",
    "cuts",
    "lower",
    "lowers",
    "lowered",
    "miss",
    "misses",
    "delay",
    "delays",
    "postpone",
    "postpones",
    "layoff",
    "layoffs",
    "probe",
    "investigation",
    "lawsuit",
    "restriction",
    "restrictions",
    "export control",
    "short report",
    "downgrade",
    "downgrades",
    "sell",
    "sells",
)

_UP_KEYWORDS = (
    "raise",
    "raises",
    "raised",
    "beat",
    "beats",
    "partnership",
    "partner",
    "partners",
    "win",
    "wins",
    "launch",
    "launches",
    "expand",
    "expands",
    "investment",
    "invests",
    "secures",
    "upgrade",
    "upgrades",
    "record",
    "demand",
)


def _guess_direction(text: str) -> str:
    lower = text.lower()
    if any(k in lower for k in _DOWN_KEYWORDS):
        return "down"
    if any(k in lower for k in _UP_KEYWORDS):
        return "up"
    return "neutral"


def _guess_signal_type(text: str) -> str:
    lower = text.lower()
    if any(k in lower for k in ("export", "restriction", "entity list", "license required")):
        return "export_restriction"
    if any(k in lower for k in ("guidance", "outlook", "forecast", "raises", "lowers")):
        return "guidance_change"
    if any(k in lower for k in ("earnings", "revenue", "eps", "beat", "miss")):
        return "earnings_surprise"
    if any(k in lower for k in ("partner", "partnership", "deal", "agreement")):
        return "partnership"
    if any(k in lower for k in ("launch", "unveils", "announces", "product")):
        return "new_product_launch"
    if any(k in lower for k in ("capex", "data center", "datacenter", "gpu cluster")):
        return "capex_change_neocloud"
    if any(k in lower for k in ("lawsuit", "probe", "investigation", "antitrust")):
        return "antitrust_action"
    if any(k in lower for k in ("layoff", "restructuring", "job cuts")):
        return "restructuring"
    if any(k in lower for k in ("upgrade", "downgrade", "analyst", "price target")):
        return "analyst_revision"
    return "regulatory_change"


def _source_strength(events: list[Event]) -> str:
    official = any(e.source.startswith(("edgar", "ir", "gov", "hkex")) for e in events)
    corroborating = any(e.source.startswith(("news", "github", "youtube")) for e in events)
    distinct_urls = {e.source_url for e in events if e.source_url}
    if official and len(distinct_urls) >= 2:
        return "high"
    if corroborating and len(distinct_urls) >= 2:
        return "medium"
    return "low"


def fallback_candidate(
    primary_entity_id: str,
    events: Iterable[Event],
    spillover_candidates: list[str],
) -> SignalCandidate | None:
    """Create a conservative collection-aligned draft when the LLM is unavailable."""
    evs = [e for e in events if e.source_url]
    if not evs:
        return None
    evs = sorted(evs, key=lambda e: e.published_at, reverse=True)[:5]
    text = "\n".join(f"{e.title or ''}\n{e.content or ''}" for e in evs)
    headline = (evs[0].title or f"{primary_entity_id} signal candidate").strip()
    allowed = set(signal_type_ids())
    signal_type = _signal_type_id(_guess_signal_type(text))
    if signal_type not in allowed:
        signal_type = signal_type or "emerging_signal"
    direction = _guess_direction(text)
    confidence = _source_strength(evs)
    urls_md = "\n".join(f"- [{e.source_url}]({e.source_url})" for e in evs)
    body_md = (
        f"# {headline[:110]}\n\n"
        f"Fallback draft generated from {len(evs)} source(s) because normal LLM generation "
        f"did not return a publishable candidate. Treat this as a {confidence}-confidence "
        "review item, not a finished signal. It still must pass the High Signal test: "
        "what changed, who is affected, why it matters, and what evidence supports it.\n\n"
        f"## Evidence\n\n{urls_md}\n\n"
        "## Read\n\n"
        f"Initial directional read for `{primary_entity_id}` is `{direction}`. Reviewer should "
        "confirm materiality, remove duplicate sources, and adjust the signal type before "
        "publishing if needed."
    )
    slug = f"{primary_entity_id.lower()}-{_slugify(headline)}"
    return SignalCandidate(
        slug=slug,
        signal_type=signal_type,
        primary_entity_id=primary_entity_id,
        direction=cast(Direction, direction),
        confidence=cast(Confidence, confidence),
        predicted_window_days=20,
        published_at=max(e.published_at for e in evs),
        evidence=[
            EvidenceItem(
                url=e.source_url,
                source_type=e.source.split(":")[0],
                excerpt=(e.content or "")[:300] if e.content else None,
                published_at=e.published_at,
            )
            for e in evs
        ],
        spillover_entity_ids=spillover_candidates[:5],
        body_md=body_md,
    )


def thematic_candidate(
    theme_entity_id: str,
    signal_type: str,
    events: Iterable[Event],
) -> SignalCandidate | None:
    """Build an entity-less *thematic* signal (e.g. data-center buildout).

    For events that don't name a tracked company but cluster on a theme backed
    by multiple independent sources. Unlike :func:`fallback_candidate`, the body
    is a real evidence walkthrough (no "fallback draft" marker), so it is not
    auto-killed by the quality gate and can publish on its own ≥2-source merit.
    Returns ``None`` unless at least two distinct source URLs are present.
    """
    evs = [e for e in events if e.source_url]
    urls = list(dict.fromkeys(e.source_url for e in evs))
    if len(urls) < 2:
        return None
    evs = sorted(evs, key=lambda e: e.published_at, reverse=True)[:6]
    text = "\n".join(f"{e.title or ''}\n{e.content or ''}" for e in evs)
    sources = sorted({e.source.split(":")[0] for e in evs})
    theme_label = signal_type.replace("_", " ")
    headline = (evs[0].title or theme_label).strip()
    direction = _guess_direction(text)
    confidence = _source_strength(evs)
    urls_md = "\n".join(f"- [{e.title or e.source_url}]({e.source_url})" for e in evs)
    body_md = (
        f"# {theme_label.title()}: {headline[:90]}\n\n"
        f"A **{theme_label}** pattern corroborated by {len(urls)} sources across "
        f"{len(sources)} channels ({', '.join(sources)}). These items don't name a "
        "single tracked company — they describe a thematic shift (land-use, energy, "
        "or capacity moves) that precedes named-entity activity.\n\n"
        f"## Evidence\n\n{urls_md}\n\n"
        "## Read\n\n"
        f"Directional read is `{direction}`. Reviewer should confirm the theme is "
        "material, attach any tracked entities the buildout implicates (operators, "
        "utilities, suppliers), and adjust the window before publishing."
    )
    slug = f"{theme_entity_id.lower()}-{_slugify(headline)}"
    return SignalCandidate(
        slug=slug,
        signal_type=signal_type,
        primary_entity_id=theme_entity_id,
        direction=cast(Direction, direction),
        confidence=cast(Confidence, confidence),
        predicted_window_days=30,
        published_at=max(e.published_at for e in evs),
        evidence=[
            EvidenceItem(
                url=e.source_url,
                source_type=e.source.split(":")[0],
                excerpt=(e.content or "")[:300] if e.content else None,
                published_at=e.published_at,
            )
            for e in evs
        ],
        spillover_entity_ids=[],
        body_md=body_md,
    )


def _ai_complete(prompt: str, content: str) -> tuple[dict | None, dict]:
    """Call OpenAI-compatible endpoint. Returns (parsed_json, audit_meta).

    `audit_meta` is always populated (model + reason + latency + raw response
    if any) so callers can persist a llm_run row even on failure.
    """
    import time

    # Default to user's free-ai-gateway (OpenAI-compatible router across CF
    # Workers AI / HF Router / Groq / etc., open-auth, project-scoped quotas).
    base = os.environ.get(
        "AI_BASE_URL", "https://free-ai-gateway.sarthakagrawal927.workers.dev/v1"
    )
    key = os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN")
    model = os.environ.get("AI_MODEL", "auto")
    project_id = os.environ.get("AI_PROJECT_ID", "high-signal")
    meta: dict = {
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "reason": None,
        "raw_response": None,
        "latency_ms": None,
        "tokens_in": None,
        "tokens_out": None,
        "request_user": content[:8000],
    }
    if not base:
        meta["reason"] = "no_base_url"
        return None, meta
    if not key:
        meta["reason"] = "no_api_key"
        return None, meta
    started = time.monotonic()
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "project_id": project_id,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            },
            timeout=60.0,
        )
        meta["latency_ms"] = int((time.monotonic() - started) * 1000)
        if r.status_code != 200:
            meta["reason"] = f"http_{r.status_code}"
            meta["raw_response"] = r.text[:2000]
            return None, meta
        body = r.json()
        meta["raw_response"] = body
        usage = body.get("usage") or {}
        meta["tokens_in"] = usage.get("prompt_tokens")
        meta["tokens_out"] = usage.get("completion_tokens")
        msg = body["choices"][0]["message"]["content"]
        return json.loads(msg), meta
    except Exception as exc:
        meta["latency_ms"] = int((time.monotonic() - started) * 1000)
        meta["reason"] = f"exception:{exc}"[:200]
        return None, meta


def generate(
    primary_entity_id: str,
    events: Iterable[Event],
    spillover_candidates: list[str],
) -> SignalCandidate | None:
    evs = list(events)
    if not evs:
        return None
    blob = "\n\n".join(
        f"--- SOURCE {i + 1}: {e.source_url}\nDATE: {e.published_at.isoformat()}\nTITLE: {e.title}\nCONTENT:\n{(e.content or '')[:4000]}"
        for i, e in enumerate(evs)
    )
    user = (
        f"PRIMARY ENTITY: {primary_entity_id}\n"
        f"SPILLOVER CANDIDATES: {', '.join(spillover_candidates)}\n\n"
        f"EVENTS:\n{blob}"
    )
    out, meta = _ai_complete(_prompt(), user)
    request_blob = {"primary": primary_entity_id, "user": meta.pop("request_user", "")}

    def _record(accepted: bool, slug: str | None, reason: str | None) -> None:
        from . import audit

        audit.push_llm_run(
            signal_slug=slug,
            model=meta["model"],
            prompt_version=meta["prompt_version"],
            accepted=accepted,
            reason=reason or meta.get("reason"),
            request_json=request_blob,
            response_json=meta.get("raw_response"),
            tokens_in=meta.get("tokens_in"),
            tokens_out=meta.get("tokens_out"),
            latency_ms=meta.get("latency_ms"),
        )

    if not out:
        _record(False, None, meta.get("reason") or "no_response")
        return None
    if not out.get("publish"):
        _record(False, None, "publish_false")
        return None
    signal_type = _signal_type_id(out.get("signal_type"))

    headline = out.get("headline", "signal")
    slug = f"{primary_entity_id.lower()}-{_slugify(headline)}"
    cand = SignalCandidate(
        slug=slug,
        signal_type=signal_type,
        primary_entity_id=primary_entity_id,
        direction=out["direction"],
        confidence=out["confidence"],
        predicted_window_days=int(out.get("predicted_window_days", 20)),
        published_at=datetime.now(timezone.utc),
        evidence=[
            EvidenceItem(
                url=e.source_url,
                source_type=e.source.split(":")[0],
                excerpt=(e.content or "")[:300] if e.content else None,
                published_at=e.published_at,
            )
            for e in evs
        ],
        spillover_entity_ids=[
            s for s in out.get("spillover_entity_ids", []) if s in spillover_candidates
        ],
        body_md=out.get("body_md", ""),
    )
    _record(True, slug, "ok")
    return cand


# ─── Batch generation (multiple entities in one LLM call) ────────────────

_BATCH_PROMPT_TEMPLATE = """You are a signal extractor for the active High Signal collection:
AI-infra / semiconductor market intelligence.

You will receive events for MULTIPLE entities in one batch. Your job is to decide
for EACH entity whether there is an actionable, collection-aligned signal draft.
Return a JSON ARRAY of signal objects (one per entity that warrants a signal;
omit entities with no actionable signal).

Output STRICT JSON array (no commentary):
[
  {
    "entity_id": "<the primary entity>",
    "publish": true|false,
    "signal_type": "<prefer one of: __SIGNAL_TYPES__; or create a concise snake_case type>",
    "direction": "up|down|neutral",
    "confidence": "low|medium|high",
    "predicted_window_days": <int 5-90>,
    "spillover_entity_ids": ["TSMC","ASML",...],
    "headline": "<<= 90 chars>",
    "body_md": "<150-400 word evidence walkthrough citing each source by URL>"
  },
  ...
]

Rules (same as single-entity, applied per entity):
- "publish": true only when the event is aligned with the active collection and
  implies a concrete company, sector, supply-chain, demand, financing, product,
  regulatory, or competitive change. Use low confidence for weak or single-source
  aligned items instead of publish=false.
- Cite every supplied source used in body_md as inline links. Medium/high
  confidence drafts need ≥ 2 distinct sources; low confidence drafts may use 1.
- "confidence" calibration:
  - low: single source, weak source, rumor, or early uncorroborated clue
  - medium: 2 corroborating sources
  - high: official filing/press release + corroborating coverage
- "signal_type" should stay dynamic:
  - Prefer the configured taxonomy when it fits.
  - If none fits, create a specific snake_case type.
  - Do not invent a type for trivia, generic news, or off-collection observations.
- "spillover_entity_ids" must be a subset of the provided spillover candidates
  for that entity.
- Window: capex 30-60d, lead-time 15-30d, design-win 60-90d, restriction 5-20d, earnings 5-15d
- DIRECTION calibration — DO NOT default to "up". Write out (silently) BOTH the
  bull case AND the bear case, then pick whichever is materially supported.
  - Misses, guidance cuts, layoffs, export restrictions, supply-chain hits → "down"
  - Beats, raises, design wins, capex bumps, partnership ups, ASP up → "up"
  - PR fluff, vague AI mentions, conflicting reports → "neutral" OR publish=false
- If events for multiple entities in this batch describe the SAME underlying event
  (e.g. a supply-chain disruption affecting both supplier and customer), generate
  a signal for EACH affected entity with the appropriate direction.
- Return [] (empty array) if no entity has an actionable signal.
"""


def _batch_prompt() -> str:
    return _BATCH_PROMPT_TEMPLATE.replace("__SIGNAL_TYPES__", ", ".join(signal_type_ids()))


BATCH_PROMPT_VERSION = "v2-batch"


def generate_batch(
    clusters: list[tuple[str, list[Event], list[str]]],
) -> list[SignalCandidate]:
    """Generate signals for multiple entity clusters in a single LLM call.

    Each cluster is ``(entity_id, events, spillover_candidates)``. Returns a
    list of ``SignalCandidate`` objects (only for entities where the model
    returns ``publish: true``). Designed for small clusters (1-4 events) that
    are graph-related — the model sees cross-entity context in one call.
    """
    if not clusters:
        return []

    # Build the batched user message
    entity_blocks: list[str] = []
    entity_events: dict[str, list[Event]] = {}
    entity_spillovers: dict[str, list[str]] = {}
    for idx, (entity_id, evs, spillovers) in enumerate(clusters):
        entity_events[entity_id] = evs
        entity_spillovers[entity_id] = spillovers
        blob = "\n".join(
            f"  - [{e.source}] {e.published_at.isoformat()} | {e.title or ''}\n"
            f"    URL: {e.source_url}\n"
            f"    {(e.content or '')[:1500]}"
            for e in evs
        )
        entity_blocks.append(
            f"=== ENTITY {idx + 1}: {entity_id} ===\n"
            f"SPILLOVER CANDIDATES: {', '.join(spillovers)}\n"
            f"EVENTS ({len(evs)}):\n{blob}"
        )

    user = "\n\n".join(entity_blocks)
    out, meta = _ai_complete(_batch_prompt(), user)
    request_blob = {"entities": [eid for eid, _, _ in clusters], "user": meta.pop("request_user", "")}

    def _record(accepted: bool, slug: str | None, reason: str | None) -> None:
        from . import audit

        audit.push_llm_run(
            signal_slug=slug,
            model=meta["model"],
            prompt_version=BATCH_PROMPT_VERSION,
            accepted=accepted,
            reason=reason or meta.get("reason"),
            request_json=request_blob,
            response_json=meta.get("raw_response"),
            tokens_in=meta.get("tokens_in"),
            tokens_out=meta.get("tokens_out"),
            latency_ms=meta.get("latency_ms"),
        )

    if not out:
        _record(False, None, meta.get("reason") or "no_response")
        return []

    # Model returns a JSON array; _ai_complete parses to dict, so re-parse if needed
    items = out if isinstance(out, list) else out.get("signals", out.get("results", []))
    if not isinstance(items, list):
        _record(False, None, "unexpected_response_shape")
        return []

    candidates: list[SignalCandidate] = []
    for item in items:
        if not isinstance(item, dict) or not item.get("publish"):
            continue
        entity_id = item.get("entity_id", "")
        evs = entity_events.get(entity_id, [])
        spillovers = entity_spillovers.get(entity_id, [])
        if not evs:
            continue
        signal_type = _signal_type_id(item.get("signal_type"))
        headline = item.get("headline", "signal")
        slug = f"{entity_id.lower()}-{_slugify(headline)}"
        cand = SignalCandidate(
            slug=slug,
            signal_type=signal_type,
            primary_entity_id=entity_id,
            direction=item["direction"],
            confidence=item["confidence"],
            predicted_window_days=int(item.get("predicted_window_days", 20)),
            published_at=datetime.now(timezone.utc),
            evidence=[
                EvidenceItem(
                    url=e.source_url,
                    source_type=e.source.split(":")[0],
                    excerpt=(e.content or "")[:300] if e.content else None,
                    published_at=e.published_at,
                )
                for e in evs
            ],
            spillover_entity_ids=[
                s for s in item.get("spillover_entity_ids", []) if s in spillovers
            ],
            body_md=item.get("body_md", ""),
        )
        candidates.append(cand)

    _record(True, None, f"ok:{len(candidates)}/{len(clusters)}")
    return candidates
