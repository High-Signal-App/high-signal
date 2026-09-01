from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx

from high_signal_ingest import mts


STORY = {
    "id": "situation-1",
    "name": "A consequential AI infrastructure change",
    "description": "This must not be retained.",
    "criticality": "Elevated",
    "lifecycle": "confirmed",
    "eventType": "product_release",
    "genre": "technology",
    "confirmationInferred": True,
    "createdAt": "2026-09-01T20:14:11.310Z",
    "lastUpdatedAt": "2026-09-01T20:30:17.000Z",
    "rankScore": 83.05,
    "rankBreakdown": {
        "velocity": 1.5,
        "distinct_sources": 3,
        "total_likes": 492,
        "private_metric": 99,
    },
    "entities": [{"id": "external-id", "name": "OpenAI", "type": "company"}],
    "topics": [{"slug": "ai", "name": "AI", "confidence": 1}],
    "sources": [
        {
            "url": "https://www.example.com/story?utm_source=mts",
            "evidenceRole": "official_confirmation",
            "postedAt": "2026-09-01T20:00:00Z",
            "text": "This source-post text must not be retained.",
            "avatarUrl": "https://example.com/avatar.png",
            "handle": "person",
        }
    ],
}


def test_normalize_feed_retains_reference_metadata_only() -> None:
    feed = mts.normalize_feed(
        {"count": 1, "stories": [STORY]},
        "2026-09-01T20:35:00+00:00",
    )
    situation = feed["situations"][0]

    assert situation["situationId"] == "situation-1"
    assert situation["position"] == 1
    assert situation["sourceUrls"] == ["https://example.com/story"]
    assert situation["sourceReferences"] == [
        {
            "url": "https://example.com/story",
            "evidenceRole": "official_confirmation",
            "postedAt": "2026-09-01T20:00:00Z",
        }
    ]
    assert situation["entities"] == [{"name": "OpenAI", "type": "company"}]
    assert situation["attentionMetrics"] == {
        "velocity": 1.5,
        "distinct_sources": 3.0,
        "total_likes": 492.0,
    }
    assert situation["sourceClass"] == "attention_aggregator"
    assert situation["confidenceContribution"] == "none"
    encoded = json.dumps(feed)
    assert "must not be retained" not in encoded
    assert "avatar" not in encoded
    assert "external-id" not in encoded
    assert "rawPayload" not in encoded


def test_poll_skips_upstream_when_server_refresh_guard_is_fresh(monkeypatch) -> None:
    requests: list[str] = []
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if request.url.path == "/admin/mts/status":
            return httpx.Response(200, json={"isDue": False})
        return httpx.Response(500)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.client = original_client(transport=httpx.MockTransport(handler), **kwargs)

        def __enter__(self):
            return self.client

        def __exit__(self, *args):
            self.client.close()

    monkeypatch.setattr(mts.httpx, "Client", FakeClient)
    result = mts.poll(
        "https://api.example",
        "token",
        now=datetime(2026, 9, 1, 20, 35, tzinfo=timezone.utc),
    )
    assert result == {"skipped": True, "reason": "minimum_refresh_interval", "feeds": 0}
    assert requests == ["https://api.example/admin/mts/status"]


def test_poll_posts_only_compact_attention_metadata(monkeypatch) -> None:
    posted: dict[str, object] = {}
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.example" and request.url.path == "/admin/mts/status":
            return httpx.Response(200, json={"isDue": True})
        if request.url.host == "api.mts.now" and request.url.path == "/situations":
            return httpx.Response(200, json={"count": 1, "stories": [STORY]})
        if request.url.host == "api.example" and request.url.path == "/admin/mts":
            posted.update(json.loads(request.content))
            return httpx.Response(200, json={"situations": 1, "verificationRequests": []})
        return httpx.Response(500)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.client = original_client(transport=httpx.MockTransport(handler), **kwargs)

        def __enter__(self):
            return self.client

        def __exit__(self, *args):
            self.client.close()

    monkeypatch.setattr(mts.httpx, "Client", FakeClient)
    result = mts.poll(
        "https://api.example",
        "token",
        now=datetime(2026, 9, 1, 20, 35, tzinfo=timezone.utc),
    )

    assert result["situations"] == 1
    encoded = json.dumps(posted)
    assert "must not be retained" not in encoded
    assert "avatarUrl" not in encoded
    assert "rawPayload" not in encoded
