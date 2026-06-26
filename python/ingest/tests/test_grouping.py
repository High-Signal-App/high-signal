from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import grouping
from high_signal_ingest.types import Event


def _ev(source: str, title: str, eid: str | None = None) -> Event:
    return Event(
        id=title[:16],
        source=source,
        source_url=f"https://x/{title}",
        published_at=datetime(2026, 6, 20, tzinfo=timezone.utc),
        title=title,
        content=None,
        primary_entity_id=eid,
        raw_hash=title,
    )


def test_classify_themes_multilabel() -> None:
    themes = grouping.classify_themes("New data center rezoning approved; GPU cluster power purchase")
    assert "ai-infra" in themes
    assert "data-center-buildout" in themes
    assert "energy-power" in themes


def test_source_family_collapses() -> None:
    assert grouping.source_family("legistar:phoenix") == "legistar"
    assert grouping.source_family("macro-rates:fred:dgs10") == "macro-rates"


def test_group_events_axes_and_convergence() -> None:
    events = [
        _ev("hackernews", "NVIDIA ships new GPU datacenter accelerator"),
        _ev("legistar:phoenix", "NVIDIA data center rezoning conditional use permit"),
        _ev("reddit", "unrelated lifestyle post about coffee"),
    ]
    axes = grouping.group_events(events)
    assert "NVDA" in axes["entity"]  # both NVIDIA items map
    assert axes["entity"]["NVDA"].events == 2
    # NVDA spans two distinct sources -> appears in convergence at min_sources=2
    conv = grouping.convergence(axes, min_sources=2)
    keys = {c.key for c in conv}
    assert "NVDA" in keys
    nvda = next(c for c in conv if c.key == "NVDA")
    assert nvda.distinct_sources == 2
