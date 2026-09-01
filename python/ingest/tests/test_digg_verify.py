from __future__ import annotations

import httpx

from high_signal_ingest import digg_verify
from high_signal_ingest.digg_verify import (
    _allowed_original_url,
    discovery_query,
    discover_articles,
    retrieve_events,
    title_alignment,
)


def test_title_alignment_requires_semantic_overlap() -> None:
    assert (
        title_alignment(
            "Anthropic launches a new safety evaluation", "New Anthropic safety evaluation launches"
        )
        >= 0.75
    )
    assert (
        title_alignment("Anthropic launches safety evaluation", "Apple updates iPhone camera") == 0
    )


def test_discovery_query_drops_filler_words() -> None:
    query = discovery_query("The future of AI in the enterprise")
    assert "the" not in query.split()
    assert {"future", "enterprise"}.issubset(set(query.split()))


def test_discovery_query_is_short_and_preserves_title_order() -> None:
    assert (
        discovery_query("Perplexity partners with Nvidia to launch Portable Computer locally")
        == "perplexity partners nvidia"
    )


def test_attention_and_social_urls_are_never_original_evidence() -> None:
    assert _allowed_original_url("https://digg.com/tech/abc") is None
    assert _allowed_original_url("https://x.com/user/status/1") is None
    assert _allowed_original_url("https://www.reddit.com/r/hardware/comments/abc") is None
    assert _allowed_original_url("https://news.ycombinator.com/item?id=1") is None
    assert _allowed_original_url("https://www.mts.now/situations") is None
    assert _allowed_original_url("https://api.mts.now/situations") is None
    assert _allowed_original_url("https://reuters.com/technology/story") is not None


def test_gdelt_rejects_entity_overlap_without_claim_alignment() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "articles": [
                    {
                        "url": "https://cnbc.com/openai-chip",
                        "title": "OpenAI chip brings new threat to Nvidia margins",
                    },
                    {
                        "url": "https://reuters.com/openai-anthropic-cyber",
                        "title": "OpenAI and Anthropic warn of AI cyber threats",
                    },
                ]
            },
        )

    request = {"title": "OpenAI and Anthropic Warn of AI Cyber Threats", "sourceUrls": []}
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        articles = discover_articles(request, client)

    assert [article["url"] for article in articles] == [
        "https://reuters.com/openai-anthropic-cyber"
    ]


def test_gdelt_discovery_retries_and_uses_three_day_window() -> None:
    attempts = 0
    schemes: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        schemes.append(request.url.scheme)
        assert request.url.params["timespan"] == "3d"
        assert request.headers["Connection"] == "close"
        if attempts == 1:
            raise httpx.ConnectTimeout("temporary timeout", request=request)
        return httpx.Response(
            200,
            json={
                "articles": [
                    {
                        "url": "https://reuters.com/technology/anthropic-safety",
                        "title": "Anthropic launches a new safety evaluation",
                    }
                ]
            },
        )

    request = {"title": "Anthropic launches a new safety evaluation", "sourceUrls": []}
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        articles = discover_articles(request, client)

    assert attempts == 2
    assert schemes == ["https", "http"]
    assert [article["url"] for article in articles] == [
        "https://reuters.com/technology/anthropic-safety"
    ]


def test_direct_original_urls_survive_gdelt_outage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("temporary timeout", request=request)

    request = {
        "title": "Anthropic launches a new safety evaluation",
        "sourceUrls": [
            "https://reuters.com/technology/anthropic-safety",
            "https://apnews.com/article/anthropic-safety",
            "https://x.com/user/status/1",
        ],
    }
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        articles = discover_articles(request, client)

    assert {article["url"] for article in articles} == {
        "https://reuters.com/technology/anthropic-safety",
        "https://apnews.com/article/anthropic-safety",
    }


def test_gdelt_rate_limit_uses_bounded_retry_after(monkeypatch) -> None:
    attempts = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(200, json={"articles": []})

    monkeypatch.setattr(digg_verify.time, "sleep", delays.append)
    request = {"title": "Anthropic launches safety evaluation", "sourceUrls": []}
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert discover_articles(request, client) == []

    assert attempts == 2
    assert delays == [2.0]


def test_publisher_retrieval_overrides_feed_accept_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Accept"].startswith("text/html")
        article = " ".join(["Anthropic launched a documented safety evaluation."] * 120)
        return httpx.Response(200, text=f"<html><article><p>{article}</p></article></html>")

    request = {"shortId": "abc", "title": "Anthropic launches safety evaluation"}
    articles = [
        {
            "url": "https://reuters.com/technology/anthropic-safety",
            "title": "Anthropic launches safety evaluation",
        }
    ]
    with httpx.Client(
        transport=httpx.MockTransport(handler),
        headers={"Accept": "application/json, application/yaml, text/yaml"},
    ) as client:
        events = retrieve_events(request, articles, client)

    assert len(events) == 1
    assert events[0].source == "news:digg-verification:reuters.com"


def test_mts_discovery_uses_the_same_original_source_gate() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        article = " ".join(["OpenAI launched documented infrastructure changes."] * 120)
        return httpx.Response(200, text=f"<html><article><p>{article}</p></article></html>")

    request = {
        "shortId": "situation-1",
        "attentionSource": "mts",
        "title": "OpenAI launches infrastructure change",
    }
    articles = [
        {
            "url": "https://reuters.com/technology/openai-infrastructure",
            "title": "OpenAI launches infrastructure change",
        }
    ]
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        events = retrieve_events(request, articles, client)

    assert len(events) == 1
    assert events[0].source == "news:mts-verification:reuters.com"
    assert events[0].source_document is not None
    assert events[0].source_document.parsed_fields["attentionSource"] == "mts"


def test_retained_evidence_is_reused_without_refetching() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.gdeltproject.org":
            return httpx.Response(200, json={"articles": []})
        raise AssertionError(f"unexpected network request: {request.url}")

    content = " ".join(["Keenable builds web search infrastructure for AI agents."] * 100)
    request = {
        "shortId": "keenable",
        "title": "Conviction Backs KeenableAI AI Search Team",
        "sourceUrls": [],
        "retainedEvidence": [
            {
                "url": "https://techcrunch.com/keenable",
                "title": "Accel-backed Keenable is indexing the web for AI agents",
                "retainedContent": content,
                "seendate": "2026-08-25T12:00:00+00:00",
            }
        ],
    }
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        articles = discover_articles(request, client)
        events = retrieve_events(request, articles, client)

    assert len(articles) == 1
    assert len(events) == 1
    assert events[0].source_url == "https://techcrunch.com/keenable"


def test_verification_batch_is_bounded_to_six_requests(monkeypatch) -> None:
    seen: list[str] = []

    def fake_verify(request: dict[str, object], client: httpx.Client) -> dict[str, object]:
        short_id = str(request["shortId"])
        seen.append(short_id)
        return {"shortId": short_id, "status": "insufficient_evidence"}

    monkeypatch.setattr(digg_verify, "verify_request", fake_verify)
    requests = [{"shortId": f"cluster-{index}"} for index in range(10)]
    with httpx.Client() as client:
        results = digg_verify.verify_requests(requests, client)

    assert seen == [f"cluster-{index}" for index in range(6)]
    assert len(results) == 6
