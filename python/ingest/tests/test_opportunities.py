from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import opportunities
from high_signal_ingest.types import Event


def _ev(title: str, content: str = "") -> Event:
    return Event(
        id=title[:16],
        source="hackernews",
        source_url=f"https://news.ycombinator.com/{title}",
        published_at=datetime.now(timezone.utc),
        title=title,
        content=content or None,
        primary_entity_id=None,
        raw_hash=title,
    )


def test_score_event_requires_keyword_match() -> None:
    ev = _ev("A post about gardening")
    assert opportunities.score_event(ev, ["vector database", "rag"]) is None


def test_score_event_scores_and_classifies_intent() -> None:
    ev = _ev(
        "Looking for a vector database alternative — current pricing is too expensive",
        "We need to switch vendors, the current one is broken.",
    )
    op = opportunities.score_event(ev, ["vector database"])
    assert op is not None
    assert op.score >= 40
    assert "vector database" in op.matched_keywords
    # buying / pain language -> a high-weight intent
    assert op.intent in {"purchase-intent", "complaint", "feature-request"}


def test_draft_reply_returns_none_without_ai_key(monkeypatch) -> None:
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    op = opportunities.score_event(_ev("Looking for a vector database"), ["vector database"])
    assert op is not None
    # No key configured → graceful None (no crash, no draft).
    assert opportunities.draft_reply(op, "Acme", "vector DB for RAG") is None


def test_rank_orders_by_score_and_filters_min() -> None:
    strong = _ev("Best vector database for RAG? pricing and vendor recommendations", "")
    weak = _ev("vector database mentioned once in passing")
    ranked = opportunities.rank_opportunities([weak, strong], ["vector database", "rag"], min_score=40)
    assert ranked
    assert ranked[0].title.startswith("Best vector database")
    assert all(o.score >= 40 for o in ranked)
