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

CRATES_TARGETS = [
    PackageTarget("crates-io", "tokio", "TOKIO"),
    PackageTarget("crates-io", "serde", "SERDE"),
    PackageTarget("crates-io", "axum", "AXUM"),
    PackageTarget("crates-io", "wgpu", "WGPU"),
    PackageTarget("crates-io", "candle-core", "CANDLE"),
]

MAVEN_TARGETS = [
    PackageTarget("maven", "org.springframework:spring-core", "SPRING"),
    PackageTarget("maven", "org.apache.kafka:kafka-clients", "KAFKA"),
    PackageTarget("maven", "com.google.guava:guava", "GUAVA"),
    PackageTarget("maven", "org.junit.jupiter:junit-jupiter", "JUNIT"),
    PackageTarget("maven", "com.fasterxml.jackson.core:jackson-databind", "JACKSON"),
]

RUBYGEMS_TARGETS = [
    PackageTarget("rubygems", "rails", "RAILS"),
    PackageTarget("rubygems", "sidekiq", "SIDEKIQ"),
    PackageTarget("rubygems", "puma", "PUMA"),
    PackageTarget("rubygems", "rack", "RACK"),
    PackageTarget("rubygems", "activerecord", "RAILS"),
]

PACKAGIST_TARGETS = [
    PackageTarget("packagist", "laravel/framework", "LARAVEL"),
    PackageTarget("packagist", "symfony/console", "SYMFONY"),
    PackageTarget("packagist", "monolog/monolog", "MONOLOG"),
    PackageTarget("packagist", "guzzlehttp/guzzle", "GUZZLE"),
    PackageTarget("packagist", "doctrine/orm", "DOCTRINE"),
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


def crates_events_from_metadata(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    crate = payload.get("crate") if isinstance(payload.get("crate"), dict) else {}
    versions = payload.get("versions") if isinstance(payload.get("versions"), list) else []
    homepage = str(crate.get("homepage") or crate.get("repository") or "").strip()
    repo_url = str(crate.get("repository") or "").removesuffix(".git")
    evidence_url = homepage or repo_url or f"https://crates.io/crates/{package.name}"
    description = str(crate.get("description") or "").strip()
    out: list[Event] = []
    for version in versions:
        if not isinstance(version, dict):
            continue
        num = str(version.get("num") or "").strip()
        if not num:
            continue
        published = _parse_datetime(str(version.get("created_at") or version.get("updated_at") or ""))
        if published is None or published < since:
            continue
        yanked = bool(version.get("yanked"))
        downloads = version.get("downloads")
        content_parts = [description]
        if yanked:
            content_parts.append("yanked")
        if isinstance(downloads, int):
            content_parts.append(f"downloads={downloads}")
        raw_hash = _hash("crates-io", package.name, num, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"packages:crates-io:{package.name}",
                source_url=evidence_url,
                published_at=published,
                title=f"crates.io release: {package.name} {num}",
                content=" | ".join(p for p in content_parts if p)[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=evidence_url,
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=version,
                    parsed_fields={
                        "ecosystem": package.ecosystem,
                        "package": package.name,
                        "version": num,
                    },
                ),
            )
        )
    return out


def crates_events_from_trending(
    payload: dict[str, Any], since: datetime
) -> list[Event]:
    crates = payload.get("crates") if isinstance(payload.get("crates"), list) else []
    out: list[Event] = []
    published = datetime.now(timezone.utc)
    if published < since:
        return out
    for crate in crates:
        if not isinstance(crate, dict):
            continue
        name = str(crate.get("id") or crate.get("name") or "").strip()
        if not name:
            continue
        downloads = crate.get("recent_downloads") or crate.get("downloads") or 0
        raw_hash = _hash("crates-io-trending", name, published.date().isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"packages:crates-io:{name}",
                source_url=f"https://crates.io/crates/{name}",
                published_at=published,
                title=f"crates.io trending: {name} (recent downloads: {downloads})",
                content=str(crate.get("description") or "").strip()[:20_000] or None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=f"https://crates.io/crates/{name}",
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=crate,
                    parsed_fields={
                        "ecosystem": "crates-io",
                        "package": name,
                        "recent_downloads": downloads,
                        "trending": True,
                    },
                ),
            )
        )
    return out


def maven_events_from_response(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    docs = response.get("docs") if isinstance(response.get("docs"), list) else []
    group, _, artifact = package.name.partition(":")
    evidence_url = f"https://central.sonatype.com/artifact/{group}/{artifact}"
    out: list[Event] = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        version = str(doc.get("v") or "").strip()
        if not version:
            continue
        ts = doc.get("timestamp")
        if isinstance(ts, (int, float)):
            published = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc)
        else:
            published = _parse_datetime(str(ts or ""))
        if published is None or published < since:
            continue
        raw_hash = _hash("maven", package.name, version, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"packages:maven:{package.name}",
                source_url=evidence_url,
                published_at=published,
                title=f"Maven Central release: {package.name} {version}",
                content=str(doc.get("p") or "").strip()[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=evidence_url,
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=doc,
                    parsed_fields={
                        "ecosystem": package.ecosystem,
                        "package": package.name,
                        "version": version,
                    },
                ),
            )
        )
    return out


def rubygems_events_from_metadata(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    version = str(payload.get("version") or "").strip()
    homepage = str(payload.get("homepage_uri") or "").strip()
    source_code = str(payload.get("source_code_uri") or "").strip()
    evidence_url = homepage or source_code or f"https://rubygems.org/gems/{package.name}"
    description = str(payload.get("info") or payload.get("description") or "").strip()
    out: list[Event] = []
    if not version:
        return out
    published = _parse_datetime(str(payload.get("version_created_at") or payload.get("created_at") or ""))
    if published is None or published < since:
        return out
    raw_hash = _hash("rubygems", package.name, version, published.isoformat())
    out.append(
        Event(
            id=raw_hash[:16],
            source=f"packages:rubygems:{package.name}",
            source_url=evidence_url,
            published_at=published,
            title=f"RubyGems release: {package.name} {version}",
            content=description[:20_000] or None,
            primary_entity_id=package.entity_id,
            raw_hash=raw_hash,
            source_document=SourceDocument(
                canonical_url=evidence_url,
                published_at=published,
                raw_hash=raw_hash,
                raw_json=payload,
                parsed_fields={
                    "ecosystem": package.ecosystem,
                    "package": package.name,
                    "version": version,
                },
            ),
        )
    )
    return out


def packagist_events_from_metadata(
    package: PackageTarget, payload: dict[str, Any], since: datetime
) -> list[Event]:
    packages = payload.get("packages") if isinstance(payload.get("packages"), dict) else {}
    versions_list = packages.get(package.name) if isinstance(packages.get(package.name), list) else []
    evidence_url = f"https://packagist.org/packages/{package.name}"
    out: list[Event] = []
    for entry in versions_list:
        if not isinstance(entry, dict):
            continue
        version = str(entry.get("version") or "").strip()
        if not version or version.startswith("dev-"):
            # skip branch/dev versions; keep normalised tagged releases
            continue
        published = _parse_datetime(str(entry.get("time") or ""))
        if published is None or published < since:
            continue
        raw_hash = _hash("packagist", package.name, version, published.isoformat())
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"packages:packagist:{package.name}",
                source_url=evidence_url,
                published_at=published,
                title=f"Packagist release: {package.name} {version}",
                content=str(entry.get("description") or "").strip()[:20_000] or None,
                primary_entity_id=package.entity_id,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=evidence_url,
                    published_at=published,
                    raw_hash=raw_hash,
                    raw_json=entry,
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


def fetch_crates(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    # Crates.io requires a descriptive User-Agent per their API policy.
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or CRATES_TARGETS:
            payload = _get_json(client, f"https://crates.io/api/v1/crates/{package.name}")
            if payload:
                out.extend(crates_events_from_metadata(package, payload, since))
        # Trending crates by recent downloads.
        trending = _get_json(
            client, "https://crates.io/api/v1/crates?sort=recent-downloads&per_page=10"
        )
        if trending:
            out.extend(crates_events_from_trending(trending, since))
    return out


def fetch_maven(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or MAVEN_TARGETS:
            group, _, artifact = package.name.partition(":")
            url = (
                f"https://search.maven.org/solrsearch/select"
                f"?q=g:{group}+AND+a:{artifact}&rows=5&wt=json"
            )
            payload = _get_json(client, url)
            if payload:
                out.extend(maven_events_from_response(package, payload, since))
    return out


def fetch_rubygems(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or RUBYGEMS_TARGETS:
            payload = _get_json(client, f"https://rubygems.org/api/v1/gems/{package.name}.json")
            if payload:
                out.extend(rubygems_events_from_metadata(package, payload, since))
    return out


def fetch_packagist(days: int = 7, targets: list[PackageTarget] | None = None) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for package in targets or PACKAGIST_TARGETS:
            vendor, _, project = package.name.partition("/")
            payload = _get_json(client, f"https://repo.packagist.org/p2/{vendor}/{project}.json")
            if payload:
                out.extend(packagist_events_from_metadata(package, payload, since))
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
    return [
        *fetch_npm(days=days),
        *fetch_pypi(days=days),
        *fetch_crates(days=days),
        *fetch_maven(days=days),
        *fetch_rubygems(days=days),
        *fetch_packagist(days=days),
        *fetch_osv(days=max(days, 30)),
    ]
