"""Public job-board adapters for Greenhouse, Lever, and Ashby.

Hiring changes are a leading signal for capital allocation, go-to-market focus,
and product surface expansion. This adapter starts with a curated set of
tracked AI/startup entities and can be widened by adding board slugs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 jobs-ingest"
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobBoardTarget:
    provider: str
    slug: str
    entity_id: str
    company_name: str


GREENHOUSE_TARGETS = [
    JobBoardTarget("greenhouse", "anthropic", "ANTHROPIC", "Anthropic"),
    JobBoardTarget("greenhouse", "databricks", "DATABRICKS", "Databricks"),
]

LEVER_TARGETS = [
    JobBoardTarget("lever", "huggingface", "HUGGINGFACE", "Hugging Face"),
]

ASHBY_TARGETS = [
    JobBoardTarget("ashby", "OpenAI", "OPENAI", "OpenAI"),
]

MAX_JOBS_PER_BOARD = 20
RELEVANT_TERMS = (
    "ai",
    "agent",
    "applied",
    "cloud",
    "compute",
    "data",
    "developer",
    "distributed",
    "forward deployed",
    "go-to-market",
    "growth",
    "inference",
    "infra",
    "infrastructure",
    "machine learning",
    "model",
    "platform",
    "product",
    "research",
    "security",
)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.astimezone(timezone.utc)
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except ValueError:
        return None


def _from_millis(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _job_relevant(*parts: object) -> bool:
    text = " ".join(str(part or "") for part in parts).lower()
    return any(term in text for term in RELEVANT_TERMS)


def greenhouse_events_from_payload(
    target: JobBoardTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    jobs = payload.get("jobs") if isinstance(payload.get("jobs"), list) else []
    out: list[Event] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        published = _parse_datetime(str(job.get("updated_at") or ""))
        if published is None or published < since:
            continue
        job_id = str(job.get("id") or job.get("absolute_url") or "")
        title = str(job.get("title") or "").strip()
        location = job.get("location") if isinstance(job.get("location"), dict) else {}
        if not _job_relevant(title, location.get("name")):
            continue
        content = f"Location: {location.get('name') or 'unknown'}".strip()
        raw_hash = event_hash("greenhouse", target.slug, job_id, title)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"jobs:greenhouse:{target.slug}",
                source_url=str(
                    job.get("absolute_url") or f"https://boards.greenhouse.io/{target.slug}"
                ),
                published_at=published,
                title=f"{target.company_name} hiring: {title}",
                content=content,
                primary_entity_id=target.entity_id,
                raw_hash=raw_hash,
            )
        )
        if len(out) >= MAX_JOBS_PER_BOARD:
            break
    return out


def lever_events_from_payload(
    target: JobBoardTarget, payload: list[Any], since: datetime
) -> list[Event]:
    out: list[Event] = []
    for job in payload:
        if not isinstance(job, dict):
            continue
        published = _from_millis(job.get("createdAt"))
        if published is None or published < since:
            continue
        title = str(job.get("text") or "").strip()
        categories = job.get("categories") if isinstance(job.get("categories"), dict) else {}
        if not _job_relevant(title, *categories.values()):
            continue
        content = "\n".join(
            part
            for part in [
                f"Team: {categories.get('team')}" if categories.get("team") else "",
                f"Location: {categories.get('location')}" if categories.get("location") else "",
                f"Commitment: {categories.get('commitment')}"
                if categories.get("commitment")
                else "",
            ]
            if part
        )
        raw_hash = event_hash(
            "lever", target.slug, str(job.get("id") or job.get("hostedUrl") or title)
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"jobs:lever:{target.slug}",
                source_url=str(job.get("hostedUrl") or f"https://jobs.lever.co/{target.slug}"),
                published_at=published,
                title=f"{target.company_name} hiring: {title}",
                content=content or None,
                primary_entity_id=target.entity_id,
                raw_hash=raw_hash,
            )
        )
        if len(out) >= MAX_JOBS_PER_BOARD:
            break
    return out


def ashby_events_from_payload(
    target: JobBoardTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    jobs = payload.get("jobs") if isinstance(payload.get("jobs"), list) else []
    out: list[Event] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        published = _parse_datetime(str(job.get("publishedAt") or job.get("updatedAt") or ""))
        if published is None or published < since:
            continue
        title = str(job.get("title") or "").strip()
        location = job.get("location") if isinstance(job.get("location"), dict) else {}
        department = job.get("department") if isinstance(job.get("department"), dict) else {}
        if not _job_relevant(title, location.get("name"), department.get("name")):
            continue
        raw_hash = event_hash(
            "ashby", target.slug, str(job.get("id") or job.get("externalLink") or title)
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"jobs:ashby:{target.slug}",
                source_url=str(
                    job.get("externalLink") or f"https://jobs.ashbyhq.com/{target.slug}"
                ),
                published_at=published,
                title=f"{target.company_name} hiring: {title}",
                content=f"Location: {location.get('name') or 'unknown'}",
                primary_entity_id=target.entity_id,
                raw_hash=raw_hash,
            )
        )
        if len(out) >= MAX_JOBS_PER_BOARD:
            break
    return out


def fetch_all(days: int = 14) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for target in GREENHOUSE_TARGETS:
            try:
                payload = client.get(
                    f"https://boards-api.greenhouse.io/v1/boards/{target.slug}/jobs"
                ).json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("greenhouse fetch failed slug=%s error=%s", target.slug, exc)
                continue
            if isinstance(payload, dict):
                out.extend(greenhouse_events_from_payload(target, payload, since))
        for target in LEVER_TARGETS:
            try:
                payload = client.get(f"https://api.lever.co/v0/postings/{target.slug}").json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("lever fetch failed slug=%s error=%s", target.slug, exc)
                continue
            if isinstance(payload, list):
                out.extend(lever_events_from_payload(target, payload, since))
        for target in ASHBY_TARGETS:
            try:
                payload = client.get(
                    f"https://api.ashbyhq.com/posting-api/job-board/{target.slug}"
                ).json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("ashby fetch failed slug=%s error=%s", target.slug, exc)
                continue
            if isinstance(payload, dict):
                out.extend(ashby_events_from_payload(target, payload, since))
    return out
