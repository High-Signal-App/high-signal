"""Signal generator — uses an LLM to draft signal candidates from events.

Inputs: a clustered set of events about an entity over a window.
Output: SignalCandidate(s) ready for human review.
"""

from __future__ import annotations

import json
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Iterable, cast

import httpx

from .extract.entities import event_supports_entity
from .seed import signal_type_ids
from .types import Confidence, Direction, Event, EvidenceItem, SignalCandidate


def _relevant_events(
    primary_entity_id: str,
    events: list[Event],
    spillover_candidates: Iterable[str],
) -> list[Event]:
    """Drop events that name only *other* tracked entities in their title+lead —
    off-entity citations (a Bajaj Housing article under an HCL signal) violate
    cite-or-kill even when the count is met. Conservative: events that name no
    tracked entity, or that name the subject/a spillover candidate, are kept."""
    spill = list(spillover_candidates)
    return [
        e for e in events if event_supports_entity(primary_entity_id, e.title, e.content, spill)
    ]


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
  "claim_event": "<concise normalized event, not analysis>",
  "claim_amount": "<material amount or null>",
  "claim_date": "<YYYY-MM-DD date of the event>",
  "observed_event": "<source-grounded fact only>",
  "direct_entity_impact": "<direct impact or null>",
  "supply_chain_impact": "<supplier/customer impact or null>",
  "business_inference": "<interpretation or null>",
  "inference_strength": "none|weak|moderate|strong",
  "inference_evidence_urls": ["<only URLs supporting the inference>"],
  "proofs": [
    {
      "url": "<supplied URL>",
      "aligned": true|false,
      "originating_evidence_id": "<same stable id when publishers repeat one origin>",
      "supports": ["observed_event|direct_entity_impact|supply_chain_impact|business_inference"]
    }
  ],
  "body_md": "<150-400 words with ## What changed, ## Why it matters, ## Uncertainty, and ## What the sources said sections; cite each used source by URL>"
}

Rules:
- "publish": true only when the event is aligned with the active collection and
  implies a concrete company, sector, supply-chain, demand, financing, product,
  regulatory, or competitive change. Use low confidence for weak or single-source
  aligned items instead of publish=false.
- Cite every supplied source used in body_md as inline links. Medium/high
  confidence drafts need ≥ 2 distinct sources; low confidence drafts may use 1.
- body_md must contain `## What changed`, `## Why it matters`, and
  `## Uncertainty`, each followed by at least one complete, source-grounded
  sentence. The uncertainty must name a concrete caveat, competing explanation,
  or missing evidence rather than generic boilerplate.
- Keep observation and interpretation separate. An app complaint is an observed
  event; pricing pressure is a business inference and needs its own cited URLs.
  If no evidence specifically supports an inference, set business_inference to
  null, inference_strength to none, and inference_evidence_urls to [].
- Return one proof assessment for every cited URL. A different hostname is not
  automatically independent: use the same originating_evidence_id when several
  publishers repeat one filing, announcement, interview, study, or wire report.
  Mark aligned false when a URL is context rather than support for this claim.
- Include 2-4 short source quotations or near-verbatim snippets in a section
  called "What the sources said". Keep each quote under 35 words and tie it to
  the source URL. If a source does not provide useful quotable text, summarize
  the concrete datum instead of inventing a quote.
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
                source_document_key=(e.source_document.document_key if e.source_document else None),
            )
            for e in evs
        ],
        spillover_entity_ids=spillover_candidates[:5],
        body_md=body_md,
        claim_event=signal_type,
        claim_date=max(e.published_at for e in evs).date().isoformat(),
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
                source_document_key=(e.source_document.document_key if e.source_document else None),
            )
            for e in evs
        ],
        spillover_entity_ids=[],
        body_md=body_md,
        claim_event=signal_type,
        claim_date=max(e.published_at for e in evs).date().isoformat(),
    )


def _classify_http(status: int) -> str:
    """Classify an HTTP status into a terminal vs retryable bucket."""
    if status == 429:
        return "rate_limited"
    if 500 <= status < 600:
        return "server_error"
    if 400 <= status < 500:
        return "client_error"
    return "ok"


def _is_retryable(cls: str) -> bool:
    return cls in ("rate_limited", "server_error")


# Bounded retry for the signal-generation LLM call. Reuses the full-jitter
# discipline from pipeline._with_backoff. Env-overridable for ops tuning.
_AI_RETRIES = int(os.environ.get("AI_RETRIES", "2"))
_AI_BACKOFF_BASE = float(os.environ.get("AI_BACKOFF_BASE", "1.0"))
_AI_BACKOFF_CAP = float(os.environ.get("AI_BACKOFF_CAP", "8.0"))
_AI_TIMEOUT = float(os.environ.get("AI_TIMEOUT", "60.0"))


def _parse_json_message(message: str) -> dict | list:
    """Parse strict JSON, tolerating a single Markdown code fence."""
    stripped = message.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            stripped = "\n".join(lines[1:-1]).strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        # Small free-tier models occasionally place a literal newline or tab
        # inside a JSON string. Python can safely recover that otherwise valid
        # payload with strict=False; truncated or structurally invalid output
        # still raises and remains rejected.
        if "Invalid control character" not in str(exc):
            raise
        parsed = json.loads(stripped, strict=False)
    if not isinstance(parsed, (dict, list)):
        raise ValueError("AI response JSON must be an object or array")
    return parsed


def _ai_complete(prompt: str, content: str) -> tuple[dict | list | None, dict]:
    """Call OpenAI-compatible endpoint. Returns (parsed_json, audit_meta).

    `audit_meta` is always populated (model + reason + latency + raw response
    if any) so callers can persist a llm_run row even on failure. Retries
    429/5xx with full-jitter backoff (bounded by ``_AI_RETRIES``); 4xx
    (non-429) and parse errors are terminal. ``attempts`` and
    ``failure_class`` are recorded for telemetry.
    """
    # The operator selects a project-owned free-provider/local endpoint.
    base = os.environ.get("AI_BASE_URL")
    key = os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN")
    model = os.environ.get("AI_MODEL")
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
        "attempts": 0,
        "failure_class": None,
    }
    if not key:
        meta["reason"] = "no_api_key"
        return None, meta
    if not base:
        meta["reason"] = "no_base_url"
        return None, meta
    if not model:
        meta["reason"] = "no_model"
        return None, meta
    started = time.monotonic()
    attempt = 0
    use_json_mode = True
    while True:
        attempt += 1
        meta["attempts"] = attempt
        try:
            request_json = {
                "model": model,
                # The project-owned free-ai gateway requires this accounting
                # tag. Keep it in the body to match the TypeScript judge.
                "project_id": project_id,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.1,
            }
            if use_json_mode:
                request_json["response_format"] = {"type": "json_object"}
            r = httpx.post(
                f"{base.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=request_json,
                timeout=_AI_TIMEOUT,
            )
            meta["latency_ms"] = int((time.monotonic() - started) * 1000)
            if r.status_code != 200:
                cls = _classify_http(r.status_code)
                meta["failure_class"] = cls
                meta["reason"] = f"http_{r.status_code}"
                meta["raw_response"] = r.text[:2000]
                compatibility_retry = (
                    r.status_code == 400
                    and use_json_mode
                    and attempt < _AI_RETRIES
                    and ("Failed to validate JSON" in r.text or "All providers failed" in r.text)
                )
                if compatibility_retry:
                    use_json_mode = False
                    continue
                if _is_retryable(cls) and attempt < _AI_RETRIES:
                    sleep_for = min(_AI_BACKOFF_CAP, _AI_BACKOFF_BASE * (2 ** (attempt - 1)))
                    sleep_for = random.uniform(0, sleep_for)  # full jitter
                    time.sleep(sleep_for)
                    continue
                return None, meta
            body = r.json()
            meta["raw_response"] = body
            meta["failure_class"] = None  # success clears any prior retryable class
            usage = body.get("usage") or {}
            meta["tokens_in"] = usage.get("prompt_tokens")
            meta["tokens_out"] = usage.get("completion_tokens")
            msg = body["choices"][0]["message"]["content"]
            return _parse_json_message(msg), meta
        except Exception as exc:
            meta["latency_ms"] = int((time.monotonic() - started) * 1000)
            meta["failure_class"] = "exception"
            meta["reason"] = f"exception:{exc}"[:200]
            # Network/timeout blips are retryable; JSON parse errors are terminal.
            if attempt < _AI_RETRIES and isinstance(
                exc, (httpx.TimeoutException, httpx.NetworkError)
            ):
                sleep_for = min(_AI_BACKOFF_CAP, _AI_BACKOFF_BASE * (2 ** (attempt - 1)))
                sleep_for = random.uniform(0, sleep_for)
                time.sleep(sleep_for)
                continue
            return None, meta


class SignalGenerationUnavailable(RuntimeError):
    """The configured AI provider could not serve a generation request."""


def _raise_for_provider_failure(meta: dict) -> None:
    """Distinguish provider outages from an intentional model decline.

    The pipeline may legitimately receive ``publish: false``. HTTP, network,
    and parse failures are different: swallowing them makes an empty signal
    day look healthy, so surface those failures to the pipeline receipt.
    """
    if meta.get("failure_class"):
        raise SignalGenerationUnavailable(str(meta.get("reason") or "provider_failure"))


def _normalize_business_inference(
    output: dict, events: list[Event]
) -> tuple[str | None, str, list[str]]:
    allowed_urls = {event.source_url for event in events}
    inference_urls = [
        url for url in output.get("inference_evidence_urls", []) if url in allowed_urls
    ]
    business_inference = output.get("business_inference") or None
    inference_strength = output.get("inference_strength", "none")
    if not business_inference or not inference_urls:
        return None, "none", []
    if inference_strength not in {"weak", "moderate", "strong"}:
        inference_strength = "weak"
    return business_inference, inference_strength, inference_urls


def _events_selected_as_evidence(
    output: dict, body_md: str, events: Iterable[Event]
) -> list[Event]:
    """Retain supplied URLs cited in prose or positively assessed as proofs.

    Structured proof output is safer than trusting the model to repeat long URLs
    verbatim in Markdown: every proof URL must still exactly match a supplied
    event, and unaligned proof assessments remain discovery context only.
    """
    event_list = list(events)
    allowed_urls = {event.source_url for event in event_list if event.source_url}
    proof_urls = {
        str(item.get("url"))
        for item in output.get("proofs", [])
        if isinstance(item, dict)
        and item.get("aligned") is True
        and str(item.get("url")) in allowed_urls
    }
    return [
        event
        for event in event_list
        if event.source_url and (event.source_url in body_md or event.source_url in proof_urls)
    ]


def _append_missing_proof_links(body_md: str, events: Iterable[Event]) -> str:
    """Make every retained proof visible even when model prose omits its URL."""
    missing_urls = [
        event.source_url for event in events if event.source_url and event.source_url not in body_md
    ]
    if not missing_urls:
        return body_md
    links = "\n".join(f"- <{url}>" for url in missing_urls)
    return f"{body_md.rstrip()}\n\n## Proofs\n{links}\n"


def _claim_date(value: object, events: list[Event]) -> str:
    fallback = max(
        (event.published_at for event in events),
        default=datetime.now(timezone.utc),
    ).date()
    if value is None:
        return fallback.isoformat()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return fallback.isoformat()


_PROOF_SUPPORT_FIELDS = {
    "observed_event",
    "direct_entity_impact",
    "supply_chain_impact",
    "business_inference",
}


def _proof_evidence(output: dict, cited_events: list[Event]) -> list[EvidenceItem]:
    """Build proof-bearing evidence from model assessments and retained docs.

    Unassessed links stay context/unverified, so malformed or older model output
    can still create a draft but can never gain proof credit accidentally.
    """
    raw_assessments = output.get("proofs", [])
    assessments = {
        str(item.get("url")): item
        for item in raw_assessments
        if isinstance(item, dict) and item.get("url")
    }
    seen_origins: set[str] = set()
    proof_items: list[EvidenceItem] = []
    for event in cited_events:
        assessment = assessments.get(event.source_url, {})
        aligned = assessment.get("aligned") is True
        origin = str(assessment.get("originating_evidence_id") or "").strip()[:500]
        verified = aligned and bool(origin)
        role = "context"
        if verified and origin not in seen_origins:
            role = "primary" if not seen_origins else "corroboration"
            seen_origins.add(origin)
        supports = [
            field for field in assessment.get("supports", []) if field in _PROOF_SUPPORT_FIELDS
        ]
        proof_items.append(
            EvidenceItem(
                url=event.source_url,
                source_type=event.source.split(":")[0],
                excerpt=(event.content or "")[:300] if event.content else None,
                published_at=event.published_at,
                source_document_key=(
                    event.source_document.document_key if event.source_document else None
                ),
                originating_evidence_id=origin or None,
                semantic_alignment="verified" if verified else "unverified",
                role=role,
                supports=supports,
            )
        )
    return proof_items


def generate(
    primary_entity_id: str,
    events: Iterable[Event],
    spillover_candidates: list[str],
) -> SignalCandidate | None:
    evs = _relevant_events(primary_entity_id, list(events), spillover_candidates)
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
    request_blob = {
        "primary": primary_entity_id,
        "user": meta.pop("request_user", ""),
        "attempts": meta.get("attempts"),
        "failure_class": meta.get("failure_class"),
    }

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
        _raise_for_provider_failure(meta)
        return None
    if not isinstance(out, dict):
        _record(False, None, "unexpected_response_shape")
        return None
    if not out.get("publish"):
        _record(False, None, "publish_false")
        return None
    signal_type = _signal_type_id(out.get("signal_type"))

    headline = out.get("headline", "signal")
    slug = f"{primary_entity_id.lower()}-{_slugify(headline)}"
    body_md = out.get("body_md", "")
    cited_events = _events_selected_as_evidence(out, body_md, evs)
    body_md = _append_missing_proof_links(body_md, cited_events)
    business_inference, inference_strength, inference_urls = _normalize_business_inference(
        out, cited_events
    )
    cand = SignalCandidate(
        slug=slug,
        signal_type=signal_type,
        primary_entity_id=primary_entity_id,
        direction=out["direction"],
        confidence=out["confidence"],
        predicted_window_days=int(out.get("predicted_window_days", 20)),
        published_at=datetime.now(timezone.utc),
        evidence=_proof_evidence(out, cited_events),
        spillover_entity_ids=[
            s for s in out.get("spillover_entity_ids", []) if s in spillover_candidates
        ],
        body_md=body_md,
        observed_event=str(out.get("observed_event") or headline),
        direct_entity_impact=out.get("direct_entity_impact") or None,
        supply_chain_impact=out.get("supply_chain_impact") or None,
        business_inference=business_inference,
        inference_strength=inference_strength,
        inference_evidence_urls=inference_urls,
        claim_event=str(out.get("claim_event") or out.get("observed_event") or signal_type),
        claim_amount=(str(out["claim_amount"]) if out.get("claim_amount") is not None else None),
        claim_date=_claim_date(out.get("claim_date"), cited_events),
    )
    _record(True, slug, "ok")
    return cand


# ─── Batch generation (multiple entities in one LLM call) ────────────────

_BATCH_PROMPT_TEMPLATE = """You are a signal extractor for the active High Signal collection:
AI-infra / semiconductor market intelligence.

You will receive events for MULTIPLE entities in one batch. Your job is to decide
for EACH entity whether there is an actionable, collection-aligned signal draft.
Return a JSON object whose `signals` array contains one object per entity that
warrants a signal; omit entities with no actionable signal.

Output one STRICT JSON object (no commentary):
{
  "signals": [
    {
    "cluster_id": "<the supplied cluster id>",
    "entity_id": "<the primary entity>",
    "publish": true|false,
    "signal_type": "<prefer one of: __SIGNAL_TYPES__; or create a concise snake_case type>",
    "direction": "up|down|neutral",
    "confidence": "low|medium|high",
    "predicted_window_days": <int 5-90>,
    "spillover_entity_ids": ["TSMC","ASML",...],
    "headline": "<<= 90 chars>",
    "claim_event": "<concise normalized event, not analysis>",
    "claim_amount": "<material amount or null>",
    "claim_date": "<YYYY-MM-DD date of the event>",
    "observed_event": "<source-grounded fact only>",
    "direct_entity_impact": "<direct impact or null>",
    "supply_chain_impact": "<supplier/customer impact or null>",
    "business_inference": "<interpretation or null>",
    "inference_strength": "none|weak|moderate|strong",
    "inference_evidence_urls": ["<only URLs supporting the inference>"],
    "proofs": [{"url":"<supplied URL>","aligned":true|false,"originating_evidence_id":"<stable origin id>","supports":["observed_event"]}],
    "body_md": "<150-400 words with ## What changed, ## Why it matters, ## Uncertainty, and ## What the sources said sections; cite each used source by URL>"
    },
    ...
  ]
}

Rules (same as single-entity, applied per entity):
- "publish": true only when the event is aligned with the active collection and
  implies a concrete company, sector, supply-chain, demand, financing, product,
  regulatory, or competitive change. Use low confidence for weak or single-source
  aligned items instead of publish=false.
- Cite every supplied source used in body_md as inline links. Medium/high
  confidence drafts need ≥ 2 distinct sources; low confidence drafts may use 1.
- For every returned entity, structure body_md with `## What changed`,
  `## Why it matters`, and `## Uncertainty`. Put a complete source-grounded
  sentence under each heading and make the last section identify a real caveat,
  alternative explanation, or evidentiary gap.
- Keep observed facts separate from direct impact, supply-chain impact, and
  business inference. Every business inference must name only the supplied URLs
  that support that specific conclusion; otherwise omit it and use strength none.
- Return a proof assessment for every cited URL. Repeated publishers of the
  same original filing, announcement, interview, study, or wire report must use
  the same originating_evidence_id and therefore count as one proof origin.
- Include 2-4 short source quotations or near-verbatim snippets in a section
  called "What the sources said". Keep each quote under 35 words and tie it to
  the source URL. If a source does not provide useful quotable text, summarize
  the concrete datum instead of inventing a quote.
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


def _candidate_from_batch_item(
    item: dict,
    cluster_events: dict[str, list[Event]],
    cluster_entities: dict[str, str],
    cluster_spillovers: dict[str, list[str]],
) -> SignalCandidate | None:
    cluster_id = str(item.get("cluster_id") or "")
    entity_id = cluster_entities.get(cluster_id, "")
    if not entity_id:
        requested_entity = str(item.get("entity_id") or "")
        matching_clusters = [
            key for key, value in cluster_entities.items() if value == requested_entity
        ]
        if len(matching_clusters) == 1:
            cluster_id = matching_clusters[0]
            entity_id = requested_entity
    evs = cluster_events.get(cluster_id, [])
    spillovers = cluster_spillovers.get(cluster_id, [])
    if not evs:
        return None
    signal_type = _signal_type_id(item.get("signal_type"))
    headline = item.get("headline", "signal")
    body_md = item.get("body_md", "")
    cited_events = _events_selected_as_evidence(item, body_md, evs)
    body_md = _append_missing_proof_links(body_md, cited_events)
    inference_urls = [
        url
        for url in item.get("inference_evidence_urls", [])
        if url in {event.source_url for event in cited_events}
    ]
    business_inference = item.get("business_inference") or None
    inference_strength = item.get("inference_strength", "none")
    if not business_inference or not inference_urls:
        business_inference = None
        inference_strength = "none"
        inference_urls = []
    elif inference_strength not in {"weak", "moderate", "strong"}:
        inference_strength = "weak"
    return SignalCandidate(
        slug=f"{entity_id.lower()}-{_slugify(headline)}",
        signal_type=signal_type,
        primary_entity_id=entity_id,
        direction=item["direction"],
        confidence=item["confidence"],
        predicted_window_days=int(item.get("predicted_window_days", 20)),
        published_at=datetime.now(timezone.utc),
        evidence=_proof_evidence(item, cited_events),
        spillover_entity_ids=[
            spillover
            for spillover in item.get("spillover_entity_ids", [])
            if spillover in spillovers
        ],
        body_md=body_md,
        observed_event=str(item.get("observed_event") or headline),
        direct_entity_impact=item.get("direct_entity_impact") or None,
        supply_chain_impact=item.get("supply_chain_impact") or None,
        business_inference=business_inference,
        inference_strength=inference_strength,
        inference_evidence_urls=inference_urls,
        claim_event=str(item.get("claim_event") or item.get("observed_event") or signal_type),
        claim_amount=(str(item["claim_amount"]) if item.get("claim_amount") is not None else None),
        claim_date=_claim_date(item.get("claim_date"), cited_events),
        source_cluster_id=cluster_id,
    )


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
    cluster_events: dict[str, list[Event]] = {}
    cluster_entities: dict[str, str] = {}
    cluster_spillovers: dict[str, list[str]] = {}
    for idx, (entity_id, raw_evs, spillovers) in enumerate(clusters):
        cluster_id = f"story-{idx + 1}"
        evs = _relevant_events(entity_id, list(raw_evs), spillovers)
        if not evs:
            continue
        cluster_events[cluster_id] = evs
        cluster_entities[cluster_id] = entity_id
        cluster_spillovers[cluster_id] = spillovers
        blob = "\n".join(
            f"  - [{e.source}] {e.published_at.isoformat()} | {e.title or ''}\n"
            f"    URL: {e.source_url}\n"
            f"    {(e.content or '')[:1500]}"
            for e in evs
        )
        entity_blocks.append(
            f"=== CLUSTER {cluster_id} / ENTITY {entity_id} ===\n"
            f"SPILLOVER CANDIDATES: {', '.join(spillovers)}\n"
            f"EVENTS ({len(evs)}):\n{blob}"
        )

    if not entity_blocks:
        return []
    user = "\n\n".join(entity_blocks)
    out, meta = _ai_complete(_batch_prompt(), user)
    request_blob = {
        "entities": [eid for eid, _, _ in clusters],
        "user": meta.pop("request_user", ""),
        "attempts": meta.get("attempts"),
        "failure_class": meta.get("failure_class"),
    }

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
        _raise_for_provider_failure(meta)
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
        candidate = _candidate_from_batch_item(
            item,
            cluster_events,
            cluster_entities,
            cluster_spillovers,
        )
        if candidate:
            candidates.append(candidate)

    _record(True, None, f"ok:{len(candidates)}/{len(clusters)}")
    return candidates
