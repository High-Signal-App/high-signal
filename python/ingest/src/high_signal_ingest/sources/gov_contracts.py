"""Public grants/contracts adapters for SBIR.gov, USAspending, and optional SAM.gov.

SBIR and USAspending awards are public without a key. SAM.gov opportunities
require ``SAM_API_KEY`` and are skipped when it is absent.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event, SourceDocument


USER_AGENT = "high-signal/0.1 gov-contracts-ingest"
LOGGER = logging.getLogger(__name__)
SBIR_URL = "https://api.www.sbir.gov/public/api/awards"
SAM_URL = "https://api.sam.gov/prod/opportunities/v2/search"
USASPENDING_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
KEYWORDS = ("artificial intelligence", "semiconductor", "data center", "cybersecurity")
USASPENDING_FIELDS = [
    "Award ID",
    "Recipient Name",
    "Award Amount",
    "Start Date",
    "End Date",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Description",
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value[:10], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def sbir_events_from_response(payload: list[Any], since: datetime) -> list[Event]:
    out: list[Event] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        published = _parse_date(str(row.get("proposal_award_date") or ""))
        if published is None or published < since:
            continue
        title = str(row.get("award_title") or "").strip()
        firm = str(row.get("firm") or "").strip()
        abstract = str(row.get("abstract") or "").strip()
        award_link = str(row.get("award_link") or "").strip()
        content = "\n".join(
            part
            for part in [
                f"Firm: {firm}" if firm else "",
                f"Agency: {row.get('agency')}" if row.get("agency") else "",
                f"Phase: {row.get('phase')}" if row.get("phase") else "",
                f"Amount: {row.get('award_amount')}" if row.get("award_amount") else "",
                abstract,
            ]
            if part
        )
        raw_hash = _hash("sbir", str(row.get("agency_tracking_number") or award_link or title))
        out.append(
            Event(
                id=raw_hash[:16],
                source="gov-contracts:sbir",
                source_url=award_link or "https://www.sbir.gov/awards",
                published_at=published,
                title=f"SBIR award: {title}" if title else "SBIR award",
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=award_link or "https://www.sbir.gov/awards",
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=row,
                    parsed_fields={
                        "program": "sbir",
                        "firm": firm,
                        "agency": row.get("agency"),
                        "phase": row.get("phase"),
                    },
                ),
            )
        )
    return out


def sam_events_from_response(payload: dict[str, Any], since: datetime) -> list[Event]:
    rows = payload.get("opportunitiesData") if isinstance(payload.get("opportunitiesData"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        published = _parse_date(str(row.get("postedDate") or ""))
        if published is None or published < since:
            continue
        notice_id = str(row.get("noticeId") or row.get("solicitationNumber") or "").strip()
        title = str(row.get("title") or "").strip()
        raw_hash = _hash("sam", notice_id or title, str(row.get("postedDate") or ""))
        out.append(
            Event(
                id=raw_hash[:16],
                source="gov-contracts:sam",
                source_url=str(row.get("uiLink") or "https://sam.gov/content/opportunities"),
                published_at=published,
                title=f"SAM.gov opportunity: {title}" if title else "SAM.gov opportunity",
                content=str(row.get("description") or row.get("fullParentPathName") or "")[:20_000]
                or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=str(row.get("uiLink") or "https://sam.gov/content/opportunities"),
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=row,
                    parsed_fields={
                        "program": "sam",
                        "noticeId": notice_id,
                        "solicitationNumber": row.get("solicitationNumber"),
                    },
                ),
            )
        )
    return out


def usaspending_events_from_response(
    keyword: str, payload: dict[str, Any], since: datetime
) -> list[Event]:
    rows = payload.get("results") if isinstance(payload.get("results"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        started = _parse_date(str(row.get("Start Date") or ""))
        if started is None or started < since:
            continue
        award_id = str(row.get("Award ID") or row.get("generated_internal_id") or "").strip()
        recipient = str(row.get("Recipient Name") or "").strip()
        description = str(row.get("Description") or "").strip()
        if not award_id:
            continue
        raw_hash = _hash("usaspending", keyword, award_id)
        content = "\n".join(
            part
            for part in [
                f"Keyword: {keyword}",
                f"Recipient: {recipient}" if recipient else "",
                f"Amount: {row.get('Award Amount')}" if row.get("Award Amount") is not None else "",
                f"Agency: {row.get('Awarding Agency')}" if row.get("Awarding Agency") else "",
                f"Sub-agency: {row.get('Awarding Sub Agency')}"
                if row.get("Awarding Sub Agency")
                else "",
                f"End date: {row.get('End Date')}" if row.get("End Date") else "",
                description,
            ]
            if part
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source="gov-contracts:usaspending",
                source_url=f"https://www.usaspending.gov/award/{award_id}",
                published_at=started,
                title=f"USAspending award: {recipient or award_id}",
                content=content[:20_000] or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=f"https://www.usaspending.gov/award/{award_id}",
                    published_at=started,
                    raw_hash=raw_hash,
                    raw_json=row,
                    parsed_fields={
                        "program": "usaspending",
                        "keyword": keyword,
                        "awardId": award_id,
                        "recipient": recipient,
                    },
                ),
            )
        )
    return out


def fetch_sbir(days: int = 30) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for keyword in KEYWORDS:
            try:
                response = client.get(SBIR_URL, params={"keyword": keyword, "rows": 25})
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("sbir fetch failed keyword=%s error=%s", keyword, exc)
                continue
            if isinstance(payload, list):
                out.extend(sbir_events_from_response(payload, since))
    return out


def fetch_sam(days: int = 14, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("SAM_API_KEY")
    if not key:
        LOGGER.debug("sam skipped: SAM_API_KEY is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    today = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for keyword in KEYWORDS:
            try:
                response = client.get(
                    SAM_URL,
                    params={
                        "api_key": key,
                        "postedFrom": since.strftime("%m/%d/%Y"),
                        "postedTo": today.strftime("%m/%d/%Y"),
                        "title": keyword,
                        "limit": 25,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("sam fetch failed keyword=%s error=%s", keyword, exc)
                continue
            if isinstance(payload, dict):
                out.extend(sam_events_from_response(payload, since))
    return out


def fetch_usaspending(days: int = 365) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    today = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for keyword in KEYWORDS:
            payload = {
                "subawards": False,
                "limit": 10,
                "page": 1,
                "sort": "Award Amount",
                "order": "desc",
                "filters": {
                    "award_type_codes": ["A", "B", "C", "D"],
                    "time_period": [
                        {
                            "start_date": since.date().isoformat(),
                            "end_date": today.date().isoformat(),
                        }
                    ],
                    "keywords": [keyword],
                },
                "fields": USASPENDING_FIELDS,
            }
            try:
                response = client.post(USASPENDING_URL, json=payload)
                response.raise_for_status()
                data = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("usaspending fetch failed keyword=%s error=%s", keyword, exc)
                continue
            if isinstance(data, dict):
                out.extend(usaspending_events_from_response(keyword, data, since))
    return out


def fetch_all(days: int = 30) -> list[Event]:
    return [
        *fetch_sbir(days=days),
        *fetch_usaspending(days=max(days, 365)),
        *fetch_sam(days=min(days, 14)),
    ]
