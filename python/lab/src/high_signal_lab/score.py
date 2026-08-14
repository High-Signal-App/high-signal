"""3-factor signal scoring: HN discussion, GitHub momentum, recency.

Kept deliberately small per plan 0007. Calibrate weights by eyeball.
"""

from __future__ import annotations

import argparse
import math
import re
from datetime import UTC, datetime

from .db import connect

GITHUB_URL_RE = re.compile(
    r"^https?://(?:www\.)?github\.com/([^/]+)/([^/?#]+)", re.IGNORECASE
)

# Weights — eyeball-tuned starting point. Calibrate against the feed.
# Recency captures "is this new?"; velocity captures "is this *accelerating*?"
# (the Digg-review follow-on per plan 0007).
WEIGHT_HN = 0.4
WEIGHT_RECENCY = 0.25
WEIGHT_VELOCITY = 0.2
WEIGHT_GITHUB = 0.15

# Half-life for recency decay (days).
RECENCY_HALF_LIFE_DAYS = 2.5
# Window for velocity counting (hours).
VELOCITY_WINDOW_HOURS = 48


def recency_factor(published_at: datetime | None) -> float:
    if not published_at:
        return 0.0
    now = datetime.now(UTC)
    age_days = max(0.0, (now - published_at).total_seconds() / 86400.0)
    return math.exp(-age_days / RECENCY_HALF_LIFE_DAYS)


def hn_factor(score: int, comments: int) -> float:
    # Squash so a 500-point story scores ~0.85, comments contribute the long tail.
    return math.tanh((score + 2 * comments) / 250.0)


def github_factor(stars: int) -> float:
    return math.tanh(stars / 5000.0)


def velocity_factor(inbound_link_count_recent: int) -> float:
    """Rate of new mentions/links targeting this document in VELOCITY_WINDOW_HOURS.

    Bot-discounted in principle — we count distinct upstream documents only, so
    a single noisy crawler can't pump the number.
    """
    return math.tanh(inbound_link_count_recent / 6.0)


def _parse_github_full_name(url: str | None) -> str | None:
    """Extract `owner/repo` from a github.com URL. Returns None for non-GitHub URLs."""
    if not url:
        return None
    match = GITHUB_URL_RE.match(url)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    repo = repo.split(".git")[0]  # strip ".git" trailing
    return f"{owner.lower()}/{repo.lower()}"


def score_documents() -> int:
    updated = 0
    with connect() as conn:
        # Pull all repo stars once into memory for a cheap left-join in code.
        repo_stars: dict[str, int] = {}
        with conn.cursor() as cur:
            cur.execute("SELECT lower(full_name), stars FROM repos")
            for full_name, stars in cur.fetchall() or []:
                if full_name:
                    repo_stars[full_name] = int(stars or 0)

        rows = []
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT d.id, d.url, d.published_at,
                       COALESCE(ht.score, 0) AS hn_score,
                       COALESCE(ht.comment_count, 0) AS hn_comments,
                       (
                         SELECT COUNT(DISTINCT l.from_document_id)
                           FROM links l
                          WHERE l.to_document_id = d.id
                            AND l.discovered_at >= now() - INTERVAL '{VELOCITY_WINDOW_HOURS} hours'
                       ) AS recent_inbound
                FROM documents d
                LEFT JOIN hn_threads ht ON ht.document_id = d.id
                """
            )
            rows = cur.fetchall()
        for doc_id, url, published_at, hn_score, hn_comments, recent_inbound in rows:
            hn = hn_factor(int(hn_score or 0), int(hn_comments or 0))
            recency = recency_factor(published_at)
            velocity = velocity_factor(int(recent_inbound or 0))
            github_repo = _parse_github_full_name(url)
            github_stars = repo_stars.get(github_repo, 0) if github_repo else 0
            github = github_factor(github_stars)
            blended = (
                WEIGHT_HN * hn
                + WEIGHT_RECENCY * recency
                + WEIGHT_VELOCITY * velocity
                + WEIGHT_GITHUB * github
            )
            factors = {
                "hn": round(hn, 4),
                "recency": round(recency, 4),
                "velocity": round(velocity, 4),
                "github": round(github, 4),
                "recent_inbound": int(recent_inbound or 0),
                "github_repo": github_repo,
                "github_stars": github_stars,
            }
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE documents
                       SET signal_score = %s, score_factors = %s::jsonb
                     WHERE id = %s
                    """,
                    (round(blended, 4), _json(factors), doc_id),
                )
            updated += 1
    return updated


def _json(payload: dict) -> str:
    import json

    return json.dumps(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab signal scorer")
    parser.parse_args()
    updated = score_documents()
    print(f"score: updated {updated} documents")


if __name__ == "__main__":
    main()
