"""Package ecosystem adapters for npm, PyPI, and OSV.dev.

These sources are developer-adoption and security-risk signals. They should
surface release cadence, ecosystem drift, and vulnerability events for curated
packages tied to tracked entities rather than indexing entire registries.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event, SourceDocument


USER_AGENT = "high-signal/0.1 package-registry-ingest"
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class PackageTarget:
    ecosystem: str
    name: str
    entity_id: str | None


NPM_TARGETS = [
    PackageTarget("npm", "nx", "NX"),
    PackageTarget("npm", "@tanstack/react-query", "TANSTACK"),
    PackageTarget("npm", "@tanstack/router", "TANSTACK"),
    PackageTarget("npm", "next", None),
    PackageTarget("npm", "typescript", None),
]

PYPI_TARGETS = [
    PackageTarget("PyPI", "litellm", "LITELLM"),
    PackageTarget("PyPI", "langflow", "LANGFLOW"),
    PackageTarget("PyPI", "openai", "OPENAI"),
    PackageTarget("PyPI", "anthropic", "ANTHROPIC"),
    PackageTarget("PyPI", "transformers", "HUGGINGFACE"),
]


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _parse_datetime(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def npm_events_from_metadata(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    out: list[Event] = []
    times = payload.get("time") if isinstance(payload.get("time"), dict) else {}
    versions = payload.get("versions") if isinstance(payload.get("versions"), dict) else {}
    homepage = str(payload.get("homepage") or "").strip()
    repository = payload.get("repository") if isinstance(payload.get("repository"), dict) else {}
    repo_url = str(repository.get("url") or "").removeprefix("git+").removesuffix(".git")
    evidence_url = homepage or repo_url or f"https://www.npmjs.com/package/{package.name}"
    for version, published_raw in times.items():
        if version in {"created", "modified"}:
            continue
        published = _parse_datetime(str(published_raw))
        if published is None or published < since:
            continue
        meta = versions.get(version) if isinstance(versions.get(version), dict) else {}
        description = str(meta.get("description") or payload.get("description") or "").strip()
        raw_hash = _hash("npm", package.name, str(version), str(published_raw))
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"package:npm:{package.name}",
                source_url=evidence_url,
                published_at=published,
                title=f"npm release: {package.name} {version}",
                content=description[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=evidence_url,
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=meta,
                    parsed_fields={
                        "ecosystem": package.ecosystem,
                        "package": package.name,
                        "version": version,
                    },
                ),
            )
        )
    return out


def pypi_events_from_metadata(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
    releases = payload.get("releases") if isinstance(payload.get("releases"), dict) else {}
    source_url = str(info.get("project_url") or info.get("home_page") or "").strip()
    if not source_url:
        source_url = f"https://pypi.org/project/{package.name}/"
    description = str(info.get("summary") or "").strip()
    out: list[Event] = []
    for version, files in releases.items():
        if not isinstance(files, list) or not files:
            continue
        upload_times = [
            _parse_datetime(str(file.get("upload_time_iso_8601") or ""))
            for file in files
            if isinstance(file, dict)
        ]
        published_candidates = [value for value in upload_times if value is not None]
        if not published_candidates:
            continue
        published = min(published_candidates)
        if published < since:
            continue
        raw_hash = _hash("pypi", package.name, str(version), published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"package:pypi:{package.name}",
                source_url=source_url,
                published_at=published,
                title=f"PyPI release: {package.name} {version}",
                content=description[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=source_url,
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json={"info": info, "files": files},
                    parsed_fields={
                        "ecosystem": package.ecosystem,
                        "package": package.name,
                        "version": version,
                    },
                ),
            )
        )
    return out


def osv_events_from_response(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    vulns = payload.get("vulns") if isinstance(payload.get("vulns"), list) else []
    out: list[Event] = []
    for vuln in vulns:
        if not isinstance(vuln, dict):
            continue
        vuln_id = str(vuln.get("id") or "").strip()
        modified = _parse_datetime(str(vuln.get("modified") or ""))
        published = _parse_datetime(str(vuln.get("published") or "")) or modified
        if not vuln_id or published is None or published < since:
            continue
        aliases = ", ".join(str(alias) for alias in vuln.get("aliases", []) if alias)
        summary = str(vuln.get("summary") or vuln.get("details") or "").strip()
        raw_hash = _hash("osv", package.ecosystem, package.name, vuln_id, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"osv:{package.ecosystem.lower()}:{package.name}",
                source_url=f"https://osv.dev/vulnerability/{vuln_id}",
                published_at=published,
                title=f"OSV advisory: {package.name} {vuln_id}",
                content=f"Aliases: {aliases}\n{summary}".strip()[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
            )
        )
    return out


def _get_json(client: httpx.Client, url: str) -> dict[str, Any] | None:
    try:
        response = client.get(url)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("package registry fetch failed url=%s error=%s", url, exc)
        return None


def fetch_npm(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or NPM_TARGETS:
            escaped = package.name.replace("/", "%2F")
            payload = _get_json(client, f"https://registry.npmjs.org/{escaped}")
            if payload:
                out.extend(npm_events_from_metadata(package, payload, since))
    return out


def fetch_pypi(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or PYPI_TARGETS:
            payload = _get_json(client, f"https://pypi.org/pypi/{package.name}/json")
            if payload:
                out.extend(pypi_events_from_metadata(package, payload, since))
    return out


def fetch_osv(days: int = 30, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or [*NPM_TARGETS, *PYPI_TARGETS]:
            try:
                response = client.post(
                    "https://api.osv.dev/v1/query",
                    json={"package": {"name": package.name, "ecosystem": package.ecosystem}},
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("osv fetch failed package=%s error=%s", package.name, exc)
                continue
            if isinstance(payload, dict):
                out.extend(osv_events_from_response(package, payload, since))
    return out


def fetch_all(days: int = 7) -> list[Event]:
    return [*fetch_npm(days=days), *fetch_pypi(days=days), *fetch_osv(days=max(days, 30))]
