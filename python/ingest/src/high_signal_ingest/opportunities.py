"""Brand opportunity scorer — a RedShip-style monitored, scored inbox.

RedShip (redship.io) monitors Reddit for a brand's keywords, scores each post
0-100 for relevance, and delivers a daily inbox of engagement opportunities.
This module does the same over High Signal's already-ingested **community /
discussion** sources (Reddit, Hacker News, Stack Overflow, Lobsters, Substack),
generalised beyond Reddit.

Scoring is deterministic (no RAG, no LLM call) — keyword relevance + buying /
pain intent (reused from `analysis.lightweight_nlp`) + recency. An LLM reply
draft can layer on later; this is the monitoring + scoring + ranking core.

Run: ``python -m high_signal_ingest.opportunities --keywords "vector db,rag" \
        --source all --days 7``
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from . import pipeline
from .analysis.lightweight_nlp import annotate
from .dedupe import dedupe_events
from .types import Event

# Community / discussion sources — the surfaces where a founder can find and
# engage prospects (the RedShip surface, generalised beyond Reddit).
COMMUNITY_SOURCES = ("reddit", "hackernews", "stackexchange", "lobsters", "substack")

# Intent → opportunity weight. Pain / buying / building intents are the
# highest-value engagement moments.
_INTENT_WEIGHT = {
    "purchase-intent": 30,
    "complaint": 26,
    "feature-request": 24,
    "startup-validation": 20,
    "operational-risk": 16,
    "market-signal": 14,
    "developer-workflow": 12,
    "regional-pressure": 8,
    "general": 4,
}


@dataclass
class Opportunity:
    score: int
    source: str
    title: str
    link: str
    published_at: str | None
    intent: str
    sentiment: str
    matched_keywords: list[str]


def _recency_points(published: datetime | None) -> int:
    if published is None:
        return 5
    age = (datetime.now(timezone.utc) - published).days
    if age <= 1:
        return 20
    if age <= 3:
        return 15
    if age <= 7:
        return 10
    return 5


def score_event(ev: Event, keywords: list[str]) -> Opportunity | None:
    """Score one event 0-100 for brand relevance + intent. None if no keyword hit."""
    title = ev.title or ""
    body = ev.content or ""
    low = f"{title}\n{body}".lower()
    matched = [k for k in keywords if k.lower() in low]
    if not matched:
        return None

    # Keyword relevance (0-50): title hits weigh more than body hits.
    title_low = title.lower()
    title_hits = sum(1 for k in keywords if k.lower() in title_low)
    kw_points = min(50, title_hits * 18 + len(matched) * 8)

    ann = annotate(low)
    intent_points = _INTENT_WEIGHT.get(ann.intent, 4)
    recency = _recency_points(ev.published_at)

    score = max(0, min(100, kw_points + intent_points + recency))
    return Opportunity(
        score=score,
        source=ev.source,
        title=title[:200],
        link=ev.source_url,
        published_at=ev.published_at.isoformat() if ev.published_at else None,
        intent=ann.intent,
        sentiment=ann.sentiment,
        matched_keywords=matched,
    )


def rank_opportunities(
    events: list[Event], keywords: list[str], min_score: int = 0
) -> list[Opportunity]:
    scored = [op for ev in events if (op := score_event(ev, keywords)) and op.score >= min_score]
    scored.sort(key=lambda o: o.score, reverse=True)
    return scored


def run(keywords: list[str], source: str, days: int, min_score: int) -> list[Opportunity]:
    events = pipeline.fetch(source, days)  # type: ignore[arg-type]
    community = [e for e in events if e.source.split(":", 1)[0] in COMMUNITY_SOURCES]
    # Collapse duplicates so the same opportunity never appears twice.
    return rank_opportunities(dedupe_events(community), keywords, min_score=min_score)


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a brand's community opportunities (RedShip-style).")
    parser.add_argument("--keywords", required=True, help="comma-separated brand keywords")
    parser.add_argument("--source", default="all", help="all | reddit | hackernews | ...")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--min-score", type=int, default=40)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args([a for a in sys.argv[1:] if a != "--"])

    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    ops = run(keywords, args.source, args.days, args.min_score)[: args.limit]
    if args.json:
        print(json.dumps([asdict(o) for o in ops], indent=2))
        return
    print(f"{len(ops)} opportunities for {keywords} (min score {args.min_score}):\n")
    for o in ops:
        print(f"  [{o.score:3}] {o.source:14} {o.intent:18} {o.title[:70]}")
        print(f"        {o.link}")


if __name__ == "__main__":
    main()
