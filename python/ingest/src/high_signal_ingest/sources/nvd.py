"""NVD CVE API adapter.

NVD is broader and noisier than CISA KEV, so this adapter only queries a
curated set of tracked developer/security products and emits low-level
security-risk candidates. CISA KEV remains the authoritative exploited-in-the-
wild source.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 nvd-ingest"
LOGGER = logging.getLogger(__name__)
API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"


@dataclass(frozen=True)
class NvdKeyword:
    keyword: str
    entity_id: str | None


KEYWORDS = [
    NvdKeyword("Ivanti", "IVANTI"),
    NvdKeyword("Palo Alto PAN-OS", "PANW"),
    NvdKeyword("Trend Micro Apex One", "TRENDMICRO"),
    NvdKeyword("Drupal", "DRUPAL"),
    NvdKeyword("LiteSpeed", "LITESPEED"),
    NvdKeyword("Langflow", "LANGFLOW"),
    NvdKeyword("GitHub", "GITHUB"),
]


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


def _cvss_summary(cve: dict[str, Any]) -> str:
    metrics = cve.get("metrics") if isinstance(cve.get("metrics"), dict) else {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        rows = metrics.get(key)
        if isinstance(rows, list) and rows:
            first = rows[0] if isinstance(rows[0], dict) else {}
            data = first.get("cvssData") if isinstance(first.get("cvssData"), dict) else {}
            score = data.get("baseScore")
            severity = data.get("baseSeverity") or first.get("baseSeverity")
            if score is not None or severity:
                return f"CVSS: {score or 'unknown'} {severity or ''}".strip()
    return ""


def events_from_response(
    keyword: NvdKeyword, payload: dict[str, Any], since: datetime
) -> list[Event]:
    rows = (
        payload.get("vulnerabilities") if isinstance(payload.get("vulnerabilities"), list) else []
    )
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cve = row.get("cve") if isinstance(row.get("cve"), dict) else {}
        cve_id = str(cve.get("id") or "").strip()
        published = _parse_datetime(str(cve.get("published") or ""))
        if not cve_id or published is None or published < since:
            continue
        descriptions = cve.get("descriptions") if isinstance(cve.get("descriptions"), list) else []
        description = ""
        for desc in descriptions:
            if isinstance(desc, dict) and desc.get("lang") == "en":
                description = str(desc.get("value") or "")
                break
        references = cve.get("references") if isinstance(cve.get("references"), list) else []
        ref_urls = [
            str(ref.get("url"))
            for ref in references[:5]
            if isinstance(ref, dict) and ref.get("url")
        ]
        content = "\n".join(
            part
            for part in [
                _cvss_summary(cve),
                description,
                f"References: {' '.join(ref_urls)}" if ref_urls else "",
            ]
            if part
        )
        raw_hash = event_hash("nvd", keyword.keyword, cve_id, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"nvd:{keyword.keyword.lower().replace(' ', '-')}",
                source_url=f"https://nvd.nist.gov/vuln/detail/{cve_id}",
                published_at=published,
                title=f"NVD CVE: {keyword.keyword} {cve_id}",
                content=content[:20_000] or None,
                primary_entity_id=keyword.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def _nvd_timestamp(value: datetime) -> str:
    # NVD rejects RFC-822-style offsets such as +0000. Its CVE API accepts the
    # documented UTC ISO-8601 form with a trailing Z.
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def fetch_all(days: int = 14, keywords: list[NvdKeyword] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for keyword in keywords or KEYWORDS:
            try:
                response = client.get(
                    API_URL,
                    params={
                        "keywordSearch": keyword.keyword,
                        "pubStartDate": _nvd_timestamp(since),
                        "pubEndDate": _nvd_timestamp(now),
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("nvd fetch failed keyword=%s error=%s", keyword.keyword, exc)
                continue
            if isinstance(payload, dict):
                out.extend(events_from_response(keyword, payload, since))
    return out
