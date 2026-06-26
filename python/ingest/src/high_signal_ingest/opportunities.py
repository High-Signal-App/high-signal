"""Brand opportunity scorer — a RedShip-style monitored, scored inbox.

RedShip (redship.io) monitors Reddit for a brand's keywords, scores each post
0-100 for relevance, and delivers a daily inbox of engagement opportunities.
This module does the same over High Signal's already-ingested **community /
discussion** sources (Reddit, Hacker News, Stack Overflow, Lobsters, Substack),
generalised beyond Reddit.

Scoring is deterministic (no RAG, no LLM call) — keyword relevance + buying /
pain intent (reused from `analysis.lightweight_nlp`) + recency.

Optional **reply drafts** (`draft_reply`) use the OpenAI-compatible AI gateway
to suggest a genuinely-helpful reply the *operator* can review and post — these
are suggestions, not auto-posts (High Signal is intelligence, not an
auto-engagement bot). Returns ``None`` without an API key. SEO-ranking detection
and Slack/webhook alerts are deferred to the worker/Mentions surface.

Run: ``python -m high_signal_ingest.opportunities --keywords "vector db,rag" \
        --source all --days 7 [--reply --brand "Acme" --brand-blurb "..."]``
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import httpx

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


def _complete_text(system: str, user: str) -> str | None:
    """Lean OpenAI-compatible text completion (same gateway as the generator).

    Returns ``None`` when no key is configured or the call fails — callers
    degrade gracefully (no reply draft rather than a crash).
    """
    base = os.environ.get("AI_BASE_URL", "https://free-ai-gateway.sarthakagrawal927.workers.dev/v1")
    key = os.environ.get("AI_API_KEY") or os.environ.get("HF_TOKEN")
    if not base or not key:
        return None
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": os.environ.get("AI_MODEL", "auto"),
                "project_id": os.environ.get("AI_PROJECT_ID", "high-signal"),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.5,
            },
            timeout=30.0,
        )
        r.raise_for_status()
        choice = r.json().get("choices", [{}])[0]
        text = (choice.get("message") or {}).get("content")
        return text.strip() if isinstance(text, str) and text.strip() else None
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None


_REPLY_SYSTEM = (
    "You help a founder engage authentically in online communities. Given a brand "
    "and a community post, write a SHORT (2-4 sentence) reply that is genuinely "
    "helpful first. Mention the brand only if it is directly relevant, and never "
    "sound like an ad. If the brand isn't a good fit for the post, say so in one "
    "line instead of forcing it. Output only the reply text."
)


def draft_reply(op: "Opportunity", brand: str, brand_blurb: str = "") -> str | None:
    """Suggest a helpful reply draft for an opportunity. None without AI configured."""
    user = (
        f"Brand: {brand}\n"
        + (f"What it does: {brand_blurb}\n" if brand_blurb else "")
        + f"Community post ({op.source}, intent={op.intent}): {op.title}\n"
        + f"Link: {op.link}\n\nWrite the reply draft."
    )
    return _complete_text(_REPLY_SYSTEM, user)


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a brand's community opportunities (RedShip-style).")
    parser.add_argument("--keywords", required=True, help="comma-separated brand keywords")
    parser.add_argument("--source", default="all", help="all | reddit | hackernews | ...")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--min-score", type=int, default=40)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--reply", action="store_true", help="generate an AI reply draft per opportunity")
    parser.add_argument("--brand", default="", help="brand name (for reply drafts)")
    parser.add_argument("--brand-blurb", default="", help="one-line brand description (for reply drafts)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args([a for a in sys.argv[1:] if a != "--"])

    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    ops = run(keywords, args.source, args.days, args.min_score)[: args.limit]
    brand = args.brand or (keywords[0] if keywords else "")
    replies = {}
    if args.reply:
        replies = {o.link: draft_reply(o, brand, args.brand_blurb) for o in ops}

    if args.json:
        out = []
        for o in ops:
            d = asdict(o)
            if args.reply:
                d["reply_draft"] = replies.get(o.link)
            out.append(d)
        print(json.dumps(out, indent=2))
        return
    print(f"{len(ops)} opportunities for {keywords} (min score {args.min_score}):\n")
    for o in ops:
        print(f"  [{o.score:3}] {o.source:14} {o.intent:18} {o.title[:70]}")
        print(f"        {o.link}")
        if args.reply:
            draft = replies.get(o.link)
            print(f"        ↳ reply: {draft if draft else '(no AI key configured)'}")


if __name__ == "__main__":
    main()
