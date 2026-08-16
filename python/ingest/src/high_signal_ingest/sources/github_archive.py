"""GitHub Archive adapter.

Reads the public hourly GitHub Archive files and keeps only events for the
curated repos already tracked by the GitHub releases adapter. This provides
public-event firehose coverage without ingesting unrelated GitHub noise.
"""

from __future__ import annotations

import gzip
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx

from ..types import Event
from .github import DEFAULT_REPOS
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 github-archive-ingest"
LOGGER = logging.getLogger(__name__)
ARCHIVE_URL = "https://data.gharchive.org/{stamp}.json.gz"
EVENT_TYPES = {"WatchEvent", "ForkEvent", "PullRequestEvent", "IssuesEvent", "ReleaseEvent"}


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


def _repo_map(repos: list[tuple[str, str | None]] | None = None) -> dict[str, str | None]:
    return {repo.lower(): entity_id for repo, entity_id in (repos or DEFAULT_REPOS)}


def events_from_lines(
    lines: list[str], tracked_repos: dict[str, str | None], since: datetime
) -> list[Event]:
    out: list[Event] = []
    for line in lines:
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if not isinstance(item, dict):
            continue
        event_type = str(item.get("type") or "")
        repo = item.get("repo") if isinstance(item.get("repo"), dict) else {}
        repo_name = str(repo.get("name") or "").lower()
        if event_type not in EVENT_TYPES or repo_name not in tracked_repos:
            continue
        created = _parse_datetime(str(item.get("created_at") or ""))
        event_id = str(item.get("id") or "").strip()
        if created is None or created < since or not event_id:
            continue
        raw_hash = event_hash("github-archive", event_id)
        actor = item.get("actor") if isinstance(item.get("actor"), dict) else {}
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        title = f"GitHub Archive {event_type}: {repo.get('name') or repo_name}"
        content = "\n".join(
            part
            for part in [
                f"Actor: {actor.get('login')}" if actor.get("login") else "",
                f"Action: {payload.get('action')}" if payload.get("action") else "",
                f"Ref: {payload.get('ref')}" if payload.get("ref") else "",
            ]
            if part
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"github-archive:{repo_name}",
                source_url=f"https://github.com/{repo.get('name') or repo_name}",
                published_at=created,
                title=title,
                content=content[:20_000] or None,
                primary_entity_id=tracked_repos[repo_name],
                raw_hash=raw_hash,
            )
        )
    return out


def _hour_stamps(days: int, max_hours: int) -> list[str]:
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    hours = min(max(1, days * 24), max_hours)
    return [
        (now - timedelta(hours=offset)).strftime("%Y-%m-%d-%H") for offset in range(1, hours + 1)
    ]


def fetch_all(days: int = 1, max_hours: int = 6) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    tracked = _repo_map()
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/gzip"},
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for stamp in _hour_stamps(days, max_hours=max_hours):
            try:
                response = client.get(ARCHIVE_URL.format(stamp=stamp))
                response.raise_for_status()
                text = gzip.decompress(response.content).decode("utf-8", errors="replace")
            except (httpx.HTTPError, OSError, UnicodeDecodeError) as exc:
                LOGGER.debug("github archive fetch failed stamp=%s error=%s", stamp, exc)
                continue
            out.extend(events_from_lines(text.splitlines(), tracked, since))
    return out
