"""Developer-ecosystem adapters beyond npm/PyPI (package_registries.py) and
GitHub (github.py).

Surfaces trending / recently-active artefacts from sources that don't fit the
curated-package or release-tracking mould:

- Papers with Code (keyless) — recent ML papers + implementations
- GitLab (keyless, optional ``GITLAB_TOKEN``) — recently active projects
- Docker Hub (keyless) — recently updated container images
- dev.to (keyless) — top developer articles from the past week
- libraries.io (free-key ``LIBRARIES_IO_API_KEY``) — cross-platform package search
- Replicate Hub (free-key ``REPLICATE_API_TOKEN``) — trending AI models

Key-gated sub-sources are skipped gracefully when their env var is missing.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 dev-ecosystems-ingest"
LOGGER = logging.getLogger(__name__)

CONTENT_CAP = 20_000


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        # Fall back to a date-only slice in case the API returns a bare date.
        try:
            parsed = datetime.fromisoformat(value[:10])
        except ValueError:
            return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _get_json(url: str, *, headers: dict[str, str] | None = None) -> Any:
    """Single GET that returns parsed JSON (dict or list) or None on failure."""
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        merged.update(headers)
    try:
        response = httpx.get(url, headers=merged, timeout=20.0, follow_redirects=True)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("dev-ecosystems fetch failed url=%s error=%s", url, exc)
        return None


def _within_days(published: datetime | None, since: datetime) -> bool:
    return published is not None and published >= since


# ---------------------------------------------------------------------------
# Papers with Code
# ---------------------------------------------------------------------------


def _fetch_papers_with_code(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []

    payload = _get_json(
        "https://paperswithcode.com/api/v1/papers/?ordering=-created&limit=20"
    )
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            for paper in results:
                if not isinstance(paper, dict):
                    continue
                paper_id = str(paper.get("id") or "").strip()
                title = str(paper.get("title") or "").strip()
                published = _parse_datetime(paper.get("created") or paper.get("published"))
                if not paper_id or not title:
                    continue
                # Papers with Code lists papers regardless of age; keep only
                # recent ones when a publish date is available, otherwise
                # still emit (so brand-new entries without dates surface).
                if published is not None and not _within_days(published, since):
                    continue
                url = paper.get("url") or f"https://paperswithcode.com/paper/{paper_id}"
                abstract = str(paper.get("abstract") or "").strip()
                content_parts = [abstract]
                if paper.get("authors"):
                    content_parts.append(f"Authors: {', '.join(str(a) for a in paper['authors'] if a)}")
                content = "\n\n".join(p for p in content_parts if p)[:CONTENT_CAP]
                raw_hash = event_hash("dev-ecosystems:papers-with-code", paper_id, title)
                out.append(
                    Event(
                        id=raw_hash[:16],
                        source="dev-ecosystems:papers-with-code",
                        source_url=url,
                        published_at=published or datetime.now(timezone.utc),
                        title=f"Papers with Code: {title}",
                        content=content or None,
                        raw_hash=raw_hash,
                    )
                )

    # Trending endpoint (best-effort — not always present/stable).
    trending = _get_json("https://paperswithcode.com/api/v1/latest/trending/")
    if isinstance(trending, dict):
        results = trending.get("results") or trending.get("papers")
        if isinstance(results, list):
            for paper in results:
                if not isinstance(paper, dict):
                    continue
                paper_id = str(paper.get("id") or "").strip()
                title = str(paper.get("title") or paper.get("paper_title") or "").strip()
                if not paper_id or not title:
                    continue
                published = _parse_datetime(paper.get("created") or paper.get("published"))
                url = paper.get("url") or f"https://paperswithcode.com/paper/{paper_id}"
                abstract = str(paper.get("abstract") or "").strip()
                raw_hash = event_hash(
                    "dev-ecosystems:papers-with-code", "trending", paper_id, title
                )
                out.append(
                    Event(
                        id=raw_hash[:16],
                        source="dev-ecosystems:papers-with-code",
                        source_url=url,
                        published_at=published or datetime.now(timezone.utc),
                        title=f"Papers with Code (trending): {title}",
                        content=abstract[:CONTENT_CAP] or None,
                        raw_hash=raw_hash,
                    )
                )

    return out


# ---------------------------------------------------------------------------
# GitLab
# ---------------------------------------------------------------------------


def _fetch_gitlab(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    headers: dict[str, str] = {}
    token = os.environ.get("GITLAB_TOKEN")
    if token:
        headers["PRIVATE-TOKEN"] = token

    payload = _get_json(
        "https://gitlab.com/api/v4/projects?order_by=last_activity_at&sort=desc&per_page=20",
        headers=headers or None,
    )
    if not isinstance(payload, list):
        return out

    for project in payload:
        if not isinstance(project, dict):
            continue
        path = str(project.get("path_with_namespace") or "").strip()
        if not path:
            continue
        last_activity = _parse_datetime(project.get("last_activity_at"))
        created = _parse_datetime(project.get("created_at"))
        published = last_activity or created
        if published is not None and not _within_days(published, since):
            continue
        web_url = str(project.get("web_url") or f"https://gitlab.com/{path}").strip()
        description = str(project.get("description") or "").strip()
        stars = project.get("star_count")
        forks = project.get("forks_count")
        topics = project.get("topics") or []
        content_parts: list[str] = []
        if description:
            content_parts.append(description)
        meta_bits = []
        if stars is not None:
            meta_bits.append(f"stars={stars}")
        if forks is not None:
            meta_bits.append(f"forks={forks}")
        if topics:
            meta_bits.append(f"topics={', '.join(str(t) for t in topics if t)}")
        if meta_bits:
            content_parts.append(" | ".join(meta_bits))
        content = "\n\n".join(content_parts)[:CONTENT_CAP]
        raw_hash = event_hash("dev-ecosystems:gitlab", path, str(published or ""))
        out.append(
            Event(
                id=raw_hash[:16],
                source="dev-ecosystems:gitlab",
                source_url=web_url,
                published_at=published or datetime.now(timezone.utc),
                title=f"GitLab active: {path}",
                content=content or None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Docker Hub
# ---------------------------------------------------------------------------


def _fetch_docker_hub(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []

    payload = _get_json(
        "https://hub.docker.com/v2/repositories/?ordering=last_updated&page_size=20"
    )
    if not isinstance(payload, dict):
        return out
    results = payload.get("results")
    if not isinstance(results, list):
        return out

    for image in results:
        if not isinstance(image, dict):
            continue
        name = str(image.get("name") or "").strip()
        namespace = str(image.get("namespace") or "").strip()
        if not name:
            continue
        full_name = f"{namespace}/{name}" if namespace else name
        updated = _parse_datetime(image.get("last_updated"))
        if updated is not None and not _within_days(updated, since):
            continue
        url = (
            image.get("url")
            or f"https://hub.docker.com/r/{namespace}/{name}" if namespace else f"https://hub.docker.com/_/{name}"
        )
        description = str(image.get("description") or "").strip()
        pulls = image.get("pull_count")
        stars = image.get("star_count")
        content_parts: list[str] = []
        if description:
            content_parts.append(description)
        meta_bits = []
        if pulls is not None:
            meta_bits.append(f"pulls={pulls}")
        if stars is not None:
            meta_bits.append(f"stars={stars}")
        if meta_bits:
            content_parts.append(" | ".join(meta_bits))
        content = "\n\n".join(content_parts)[:CONTENT_CAP]
        raw_hash = event_hash("dev-ecosystems:docker-hub", full_name, str(updated or ""))
        out.append(
            Event(
                id=raw_hash[:16],
                source="dev-ecosystems:docker-hub",
                source_url=url,
                published_at=updated or datetime.now(timezone.utc),
                title=f"Docker Hub: {full_name}",
                content=content or None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# dev.to
# ---------------------------------------------------------------------------


def _fetch_devto(days: int = 7) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []

    payload = _get_json("https://dev.to/api/articles?per_page=30&top=7")
    if not isinstance(payload, list):
        return out

    for article in payload:
        if not isinstance(article, dict):
            continue
        article_id = str(article.get("id") or "").strip()
        title = str(article.get("title") or "").strip()
        if not article_id or not title:
            continue
        published = _parse_datetime(article.get("published_at") or article.get("published_timestamp"))
        if published is not None and not _within_days(published, since):
            continue
        url = str(article.get("url") or "").strip()
        if not url:
            continue
        description = str(article.get("description") or "").strip()
        tags = article.get("tag_list") or []
        if isinstance(tags, str):
            tags = [tags]
        content_parts: list[str] = []
        if description:
            content_parts.append(description)
        if tags:
            content_parts.append(f"tags: {', '.join(str(t) for t in tags if t)}")
        reactions = article.get("positive_reactions_count")
        comments = article.get("comments_count")
        meta_bits = []
        if reactions is not None:
            meta_bits.append(f"reactions={reactions}")
        if comments is not None:
            meta_bits.append(f"comments={comments}")
        if meta_bits:
            content_parts.append(" | ".join(meta_bits))
        content = "\n\n".join(content_parts)[:CONTENT_CAP]
        raw_hash = event_hash("dev-ecosystems:devto", article_id, title)
        out.append(
            Event(
                id=raw_hash[:16],
                source="dev-ecosystems:devto",
                source_url=url,
                published_at=published or datetime.now(timezone.utc),
                title=f"dev.to: {title}",
                content=content or None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# libraries.io
# ---------------------------------------------------------------------------


def _fetch_libraries_io(days: int = 7) -> list[Event]:
    api_key = os.environ.get("LIBRARIES_IO_API_KEY")
    if not api_key:
        LOGGER.debug("libraries.io skipped — LIBRARIES_IO_API_KEY not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []

    # Cross-platform search: a few broad queries that surface newly added /
    # recently updated packages across ecosystems.
    queries = ["machine learning", "ai agent", "llm", "inference"]
    for query in queries:
        payload = _get_json(
            f"https://libraries.io/api/search?api_key={api_key}&q={query}&per_page=10&sort=stars"
        )
        if not isinstance(payload, list):
            continue
        for package in payload:
            if not isinstance(package, dict):
                continue
            name = str(package.get("name") or "").strip()
            platform = str(package.get("platform") or "").strip()
            if not name or not platform:
                continue
            updated = _parse_datetime(
                package.get("updated_at") or package.get("latest_release_published_at")
            )
            if updated is not None and not _within_days(updated, since):
                continue
            url = (
                package.get("package_manager_url")
                or f"https://libraries.io/{platform}/{name}"
            )
            description = str(package.get("description") or "").strip()
            stars = package.get("stars")
            forks = package.get("forks")
            content_parts: list[str] = []
            if description:
                content_parts.append(description)
            meta_bits = [f"platform={platform}"]
            if stars is not None:
                meta_bits.append(f"stars={stars}")
            if forks is not None:
                meta_bits.append(f"forks={forks}")
            content_parts.append(" | ".join(meta_bits))
            content = "\n\n".join(content_parts)[:CONTENT_CAP]
            raw_hash = event_hash(
                "dev-ecosystems:libraries-io", platform, name, str(updated or "")
            )
            out.append(
                Event(
                    id=raw_hash[:16],
                    source="dev-ecosystems:libraries-io",
                    source_url=url,
                    published_at=updated or datetime.now(timezone.utc),
                    title=f"libraries.io: {platform}/{name}",
                    content=content or None,
                    raw_hash=raw_hash,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Replicate Hub
# ---------------------------------------------------------------------------


def _fetch_replicate(days: int = 7) -> list[Event]:
    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        LOGGER.debug("replicate skipped — REPLICATE_API_TOKEN not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []

    payload = _get_json(
        "https://api.replicate.com/v1/models?per_page=20",
        headers={"Authorization": f"Bearer {token}"},
    )
    if not isinstance(payload, dict):
        return out
    results = payload.get("results")
    if not isinstance(results, list):
        return out

    for model in results:
        if not isinstance(model, dict):
            continue
        owner = str(model.get("owner") or "").strip()
        name = str(model.get("name") or "").strip()
        if not name:
            continue
        full_name = f"{owner}/{name}" if owner else name
        updated = _parse_datetime(model.get("latest_version", {}).get("created_at")) if isinstance(
            model.get("latest_version"), dict
        ) else None
        if updated is None:
            updated = _parse_datetime(model.get("created_at"))
        if updated is not None and not _within_days(updated, since):
            continue
        url = model.get("url") or f"https://replicate.com/{full_name}" if owner else f"https://replicate.com/{name}"
        description = str(model.get("description") or "").strip()
        visibility = str(model.get("visibility") or "").strip()
        content_parts: list[str] = []
        if description:
            content_parts.append(description)
        meta_bits = []
        if visibility:
            meta_bits.append(f"visibility={visibility}")
        if meta_bits:
            content_parts.append(" | ".join(meta_bits))
        content = "\n\n".join(content_parts)[:CONTENT_CAP]
        raw_hash = event_hash("dev-ecosystems:replicate", full_name, str(updated or ""))
        out.append(
            Event(
                id=raw_hash[:16],
                source="dev-ecosystems:replicate",
                source_url=url,
                published_at=updated or datetime.now(timezone.utc),
                title=f"Replicate: {full_name}",
                content=content or None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Fan-out
# ---------------------------------------------------------------------------


def fetch_all(days: int = 7) -> list[Event]:
    """Run every dev-ecosystem sub-fetcher and concatenate results.

    Key-gated sub-sources (libraries.io, Replicate) return an empty list when
    their env var is missing, so this is always safe to call.
    """
    return [
        *_fetch_papers_with_code(days=days),
        *_fetch_gitlab(days=days),
        *_fetch_docker_hub(days=days),
        *_fetch_devto(days=days),
        *_fetch_libraries_io(days=days),
        *_fetch_replicate(days=days),
    ]
