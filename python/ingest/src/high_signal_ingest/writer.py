"""Write signals as git-versioned markdown OR push to /admin/sync.

Local dev: writes `signals/YYYY-MM-DD/<slug>.md` (git-versioned source of truth).
Modal / CI:  POSTs to {API_BASE}/admin/sync with bearer ADMIN_TOKEN — D1 is the
target since the container filesystem is ephemeral.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

import httpx
import yaml

from .quality import assess_signal_quality
from .types import SignalCandidate


LOGGER = logging.getLogger(__name__)


class SignalDeliveryError(RuntimeError):
    """A candidate could not be delivered to the configured remote sink."""

    def __init__(self, slug: str, reason: str, recovery_path: Path | None = None) -> None:
        self.slug = slug
        self.reason = reason
        self.recovery_path = recovery_path
        super().__init__(f"signal delivery failed for {slug}: {reason}")


def _review_status(candidate: SignalCandidate) -> str:
    """Every candidate enters the one shared auto-publish gate as a draft."""
    return "draft"


def _default_signals_root() -> Path:
    """Walk up looking for the repo's `signals/` directory."""
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        candidate = ancestor / "signals"
        if candidate.is_dir():
            return candidate
    # Fallback: container temp dir — never git-committed, fine for Modal
    return Path("/tmp/signals")


def _quote_excerpt(value: str | None, max_words: int = 36) -> str | None:
    if not value:
        return None
    words = value.replace("\n", " ").split()
    if not words:
        return None
    out = " ".join(words[:max_words])
    if len(words) > max_words:
        out = f"{out}..."
    return out


def _proof_frontmatter(candidate: SignalCandidate) -> dict[str, object]:
    """Flatten proof receipts into arrays parallel to ``evidence_urls``."""
    return {
        "proof_source_document_keys": [
            evidence.source_document_key or "" for evidence in candidate.evidence
        ],
        "proof_originating_evidence_ids": [
            evidence.originating_evidence_id or "" for evidence in candidate.evidence
        ],
        "proof_semantic_alignments": [
            evidence.semantic_alignment for evidence in candidate.evidence
        ],
        "proof_roles": [evidence.role for evidence in candidate.evidence],
        "proof_supports": [",".join(evidence.supports) for evidence in candidate.evidence],
    }


def _frontmatter(candidate: SignalCandidate, day: str) -> dict[str, object]:
    front: dict[str, object] = {
        "slug": candidate.slug,
        "signal_type": candidate.signal_type,
        "primary_entity": candidate.primary_entity_id,
        "direction": candidate.direction,
        "confidence": candidate.confidence,
        "predicted_window_days": candidate.predicted_window_days,
        "published_at": candidate.published_at.isoformat(),
        "evidence_urls": [e.url for e in candidate.evidence],
        "spillover_entity_ids": candidate.spillover_entity_ids,
        "supersedes": candidate.supersedes_signal_id,
        "review_status": _review_status(candidate),
        "observed_event": candidate.observed_event,
        "direct_entity_impact": candidate.direct_entity_impact,
        "supply_chain_impact": candidate.supply_chain_impact,
        "business_inference": candidate.business_inference,
        "inference_strength": candidate.inference_strength,
        "inference_evidence_urls": candidate.inference_evidence_urls,
        "claim_assertion": candidate.observed_event or candidate.claim_event or candidate.slug,
        "claim_event": candidate.claim_event or candidate.signal_type,
        "claim_amount": candidate.claim_amount,
        "claim_date": candidate.claim_date or day,
        "claim_direction": candidate.direction,
        **_proof_frontmatter(candidate),
    }
    evidence_quotes = [_quote_excerpt(e.excerpt) or "" for e in candidate.evidence]
    evidence_source_types = [e.source_type for e in candidate.evidence]
    evidence_published_at = [
        e.published_at.isoformat() if e.published_at else "" for e in candidate.evidence
    ]
    if any(evidence_quotes):
        front["evidence_quotes"] = evidence_quotes
    if any(evidence_source_types):
        front["evidence_source_types"] = evidence_source_types
    if any(evidence_published_at):
        front["evidence_published_at"] = evidence_published_at
    quality = assess_signal_quality(candidate)
    front["content_category"] = quality.content_category
    front["quality_score"] = quality.score
    front["quality_band"] = quality.band
    front["quality_reasons"] = quality.reasons
    return front


def write_signal(candidate: SignalCandidate, root: Path | None = None) -> Path:
    root = root or _default_signals_root()
    day = candidate.published_at.strftime("%Y-%m-%d")
    dir_ = root / day
    dir_.mkdir(parents=True, exist_ok=True)
    fp = dir_ / f"{candidate.slug}.md"
    front = _frontmatter(candidate, day)
    body = candidate.body_md.strip()
    fp.write_text(_render_signal(front, body), encoding="utf-8")
    return fp


def _render_signal(front: dict[str, object], body: str) -> str:
    return f"---\n{yaml.safe_dump(front, sort_keys=False).strip()}\n---\n\n{body}\n"


def write_recovery_signal(candidate: SignalCandidate) -> Path:
    """Write a failed remote delivery under a unique, operator-recoverable path."""
    root = Path.cwd() / "signal-recovery"
    root.mkdir(parents=True, exist_ok=True)
    day = candidate.published_at.strftime("%Y-%m-%d")
    front = _frontmatter(candidate, day)
    body = candidate.body_md.strip()
    safe_slug = (re.sub(r"[^A-Za-z0-9._-]+", "-", candidate.slug).strip(".-") or "signal")[:120]
    content = _render_signal(front, body).encode("utf-8")
    for _ in range(10):
        path = root / f"{safe_slug}-{uuid.uuid4().hex}.md"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return path
    raise FileExistsError("could not allocate a unique recovery signal path")


def write_signal_dict(d: dict, root: Path | None = None) -> Path:
    root = root or _default_signals_root()
    day = datetime.fromisoformat(d["published_at"]).strftime("%Y-%m-%d")
    dir_ = root / day
    dir_.mkdir(parents=True, exist_ok=True)
    fp = dir_ / f"{d['slug']}.md"
    body = d.pop("body_md", "")
    fp.write_text(
        f"---\n{yaml.safe_dump(d, sort_keys=False).strip()}\n---\n\n{body.strip()}\n",
        encoding="utf-8",
    )
    return fp


def push_signal(candidate: SignalCandidate) -> dict:
    """POST a signal candidate to {API_BASE}/admin/sync."""
    api = os.environ.get("API_BASE")
    token = os.environ.get("ADMIN_TOKEN")
    if not api or not token:
        raise RuntimeError("API_BASE + ADMIN_TOKEN required for push_signal")
    payload = {
        "signals": [
            {
                "slug": candidate.slug,
                "signalType": candidate.signal_type,
                "primaryEntityId": candidate.primary_entity_id,
                "direction": candidate.direction,
                "confidence": candidate.confidence,
                "predictedWindowDays": candidate.predicted_window_days,
                "publishedAt": candidate.published_at.isoformat(),
                "evidenceUrls": [e.url for e in candidate.evidence],
                "evidence": [
                    {
                        "url": e.url,
                        "sourceType": e.source_type,
                        "excerpt": _quote_excerpt(e.excerpt),
                        "publishedAt": e.published_at.isoformat() if e.published_at else None,
                        "sourceDocumentKey": e.source_document_key,
                        "originatingEvidenceId": e.originating_evidence_id,
                        "semanticAlignment": e.semantic_alignment,
                        "role": e.role,
                        "supports": e.supports,
                    }
                    for e in candidate.evidence
                ],
                "spilloverEntityIds": candidate.spillover_entity_ids,
                "reviewStatus": _review_status(candidate),
                "supersedesSignalId": candidate.supersedes_signal_id,
                "bodyMd": candidate.body_md,
                "observedEvent": candidate.observed_event,
                "directEntityImpact": candidate.direct_entity_impact,
                "supplyChainImpact": candidate.supply_chain_impact,
                "businessInference": candidate.business_inference,
                "inferenceStrength": candidate.inference_strength,
                "inferenceEvidenceUrls": candidate.inference_evidence_urls,
                "claim": {
                    "assertion": candidate.observed_event
                    or candidate.claim_event
                    or candidate.slug,
                    "event": candidate.claim_event or candidate.signal_type,
                    "amount": candidate.claim_amount,
                    "date": candidate.claim_date or candidate.published_at.date().isoformat(),
                    "direction": candidate.direction,
                },
            }
        ]
    }
    r = httpx.post(
        f"{api.rstrip('/')}/admin/sync",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30.0,
    )
    r.raise_for_status()
    return dict(r.json())


def _delivery_reason(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return exc.__class__.__name__


def _acknowledgement(result: object) -> str:
    if not isinstance(result, dict):
        raise ValueError("malformed response")
    upserts = result.get("upserts")
    failed = result.get("failed", 0)
    skipped = result.get("skipped", 0)
    if type(upserts) is not int or type(failed) is not int or type(skipped) is not int:
        raise ValueError("malformed counters")
    if upserts == 1 and failed == 0 and skipped == 0:
        return "pushed"
    if upserts == 0 and failed == 0 and skipped == 1:
        return "skipped"
    raise ValueError("unexpected counters")


def emit(candidate: SignalCandidate) -> str | None:
    """Choose write path: API push if API_BASE+ADMIN_TOKEN set, else local file."""
    if os.environ.get("API_BASE") and os.environ.get("ADMIN_TOKEN"):
        try:
            result = push_signal(candidate)
            acknowledgement = _acknowledgement(result)
            if acknowledgement == "pushed":
                return f"pushed:{candidate.slug}"
            LOGGER.info("push_signal skipped protected signal %s", candidate.slug)
            return None
        except SignalDeliveryError:
            raise
        except Exception as exc:
            reason = _delivery_reason(exc)
            try:
                recovery_path = write_recovery_signal(candidate)
            except Exception as recovery_exc:
                recovery_reason = _delivery_reason(recovery_exc)
                LOGGER.warning(
                    "signal delivery failed for %s: %s; recovery unavailable (%s)",
                    candidate.slug,
                    reason,
                    recovery_reason,
                )
                raise SignalDeliveryError(
                    candidate.slug,
                    f"{reason}; recovery write failed ({recovery_reason})",
                ) from None
            LOGGER.warning(
                "signal delivery failed for %s: %s; recovery saved at %s",
                candidate.slug,
                reason,
                recovery_path,
            )
            raise SignalDeliveryError(candidate.slug, reason, recovery_path) from None
    fp = write_signal(candidate)
    return str(fp)
