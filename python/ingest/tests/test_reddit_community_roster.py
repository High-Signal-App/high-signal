from __future__ import annotations

import json
from pathlib import Path

from high_signal_ingest.sources.reddit import DEFAULT_SUBS


ROSTER_PATH = (
    Path(__file__).parents[1]
    / "src"
    / "high_signal_ingest"
    / "seed"
    / "reddit_communities.json"
)


def test_reddit_community_roster_and_rollout_cohorts() -> None:
    roster = json.loads(ROSTER_PATH.read_text())
    communities = roster["communities"]
    normalized = {community.casefold() for community in communities}
    phase10 = roster["rollout"]["phase10"]
    phase50_additional = roster["rollout"]["phase50Additional"]
    phase50 = {community.casefold() for community in phase10 + phase50_additional}

    assert roster["schemaVersion"] == "1"
    assert roster["communityCount"] == 200
    assert len(communities) == 200
    assert len(normalized) == 200
    assert len(phase10) == 10
    assert len(phase50_additional) == 40
    assert len(phase50) == 50
    assert phase50 <= normalized
    assert {community.casefold() for community in DEFAULT_SUBS} <= normalized
