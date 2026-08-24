from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx

from high_signal_ingest import digg


CLUSTER = {
    "id": "cluster-uuid",
    "short_id": "abc123",
    "url": "/tech/abc123?utm_source=test",
    "title": "A consequential AI infrastructure change",
    "tldr": "Several independent voices are discussing the same development.",
    "created_at": "2026-08-24T12:00:00Z",
    "first_post_at": "2026-08-24T11:30:00Z",
    "position": 4,
    "peak_rank": 2,
    "entry_status": "rising",
    "badges": ["rising"],
    "ai1000_touches": [{"username": "ExpertOne", "display_name": "Expert One"}],
    "representative_sources": [
        {
            "author_username": "ExpertTwo",
            "url": "https://x.com/expert/status/1?utm_campaign=test",
            "title": "Source post",
        }
    ],
    "conversation_shape": {"voice_count": 3, "effective_authors": 2.4},
    "engagement_sources": {"canonical_source_count": 1, "duplicate_source_count": 8},
}


def test_parse_and_normalize_cluster_preserves_attention_without_evidence_credit() -> None:
    feed = digg.normalize_feed(
        "ranked",
        digg.FEEDS["ranked"],
        {"metadata": {"generated_at": "2026-08-24T12:05:00Z"}, "clusters": [CLUSTER]},
        "2026-08-24T12:10:00+00:00",
    )

    cluster = feed["clusters"][0]
    assert cluster["shortId"] == "abc123"
    assert cluster["canonicalDiggUrl"] == "https://digg.com/tech/abc123"
    assert cluster["sourceUrls"] == ["https://x.com/expert/status/1"]
    assert cluster["distinctAccountCount"] == 3
    assert {a["username"] for a in cluster["contributingAccounts"]} == {
        "ExpertOne",
        "experttwo",
    }
    assert cluster["sourceClass"] == "attention_aggregator"
    assert cluster["evidenceTier"] == "derived"
    assert cluster["confidenceContribution"] == "none"
    assert cluster["attentionContribution"] == "allowed"
    assert cluster["externalGeneratedAnalysis"] is None


def test_documented_json_and_yaml_shapes_parse() -> None:
    json_payload = digg.parse_feed(json.dumps({"clusters": [CLUSTER]}), "feed.json")
    yaml_payload = digg.parse_feed("clusters:\n  - short_id: abc\n", "feed.yaml")
    assert len(json_payload["clusters"]) == 1
    assert yaml_payload["clusters"][0]["short_id"] == "abc"


def test_rising_feed_membership_sets_entry_status() -> None:
    cluster = {**CLUSTER, "entry_status": None}
    feed = digg.normalize_feed(
        "rising",
        digg.FEEDS["rising"],
        {"clusters": [cluster]},
        "2026-08-24T12:10:00+00:00",
    )
    assert feed["clusters"][0]["entryStatus"] == "rising"


def test_due_feed_kinds_respects_server_cache_guard(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer token"
        return httpx.Response(
            200,
            json={
                "feeds": [
                    {"feedKind": "ranked", "isDue": False},
                    {"feedKind": "rising", "isDue": True},
                ]
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert digg.due_feed_kinds(client, "https://api.example", "token") == {"rising"}


def test_redirect_resolution_uses_head_and_keeps_tracking_out() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "HEAD"
        if request.url.host == "final.example":
            return httpx.Response(200)
        return httpx.Response(
            302, headers={"location": "https://final.example/story?utm_source=x&id=7"}
        )

    with httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True) as client:
        assert digg.resolve_source_url("https://short.example/a", client) == (
            "https://final.example/story?id=7"
        )


def test_poll_skips_upstream_fetch_when_server_says_cache_is_fresh(monkeypatch) -> None:
    requests: list[str] = []
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if request.url.path == "/admin/digg/status":
            return httpx.Response(
                200,
                json={"feeds": [{"feedKind": kind, "isDue": False} for kind in digg.FEEDS]},
            )
        return httpx.Response(500)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.client = original_client(transport=httpx.MockTransport(handler), **kwargs)

        def __enter__(self):
            return self.client

        def __exit__(self, *args):
            self.client.close()

    monkeypatch.setattr(digg.httpx, "Client", FakeClient)
    result = digg.poll(
        "https://api.example",
        "token",
        now=datetime(2026, 8, 24, 12, tzinfo=timezone.utc),
    )
    assert result == {"skipped": True, "reason": "minimum_refresh_interval", "feeds": 0}
    assert requests == ["https://api.example/admin/digg/status"]
