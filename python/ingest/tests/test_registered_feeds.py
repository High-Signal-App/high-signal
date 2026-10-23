from __future__ import annotations

import asyncio
import gzip
import socket
from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest import audit
from high_signal_ingest.sources import news, registered_feeds as feeds


SEED = {
    "id": "existing-publisher",
    "type": "blog",
    "tier": 2,
    "rss": "https://publisher.example.org/feed/",
}
ROW = {"id": "feed-managed", "feedUrl": "https://publisher.example.org/feed", "enabled": True}


def test_registry_preserves_existing_identity_and_pause_overrides_seed() -> None:
    combined = feeds.merge_sources([SEED], [ROW], 2)
    assert len(combined) == 1
    assert combined[0]["id"] == "existing-publisher"
    assert combined[0]["_registry_id"] == "feed-managed"
    assert feeds.merge_sources([SEED], [{**ROW, "enabled": False}], 2) == []
    assert feeds.merge_sources([SEED], [], 2) == [SEED]
    extra = {**ROW, "feedUrl": "https://writer.example.org/atom"}
    assert {source["id"] for source in feeds.merge_sources([SEED], [extra], 2)} == {
        "existing-publisher",
        "feed-managed",
    }


def test_unavailable_or_malformed_registry_cannot_resume_paused_sources() -> None:
    with pytest.raises(feeds.PublicFeedFetchError, match="unavailable"):
        feeds.merge_sources([SEED], None, 2)
    with pytest.raises(feeds.PublicFeedFetchError, match="Invalid"):
        feeds.merge_sources([SEED], [{**ROW, "enabled": "false"}], 2)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/feed",
        "http://2130706433/feed",
        "http://[::1]/feed",
        "http://metadata.internal/feed",
        "file:///private/feed",
        "http://user:password@publisher.example.org/feed",
        "https://publisher.example.org/feed?token=private",
        "https://publisher.example.org:8443/feed",
    ],
)
def test_only_public_credential_free_urls_are_accepted(url: str) -> None:
    with pytest.raises(feeds.UnsafeFeedUrl):
        feeds.public_url(url)


def test_dns_resolution_rejects_private_addresses(monkeypatch) -> None:
    async def run() -> None:
        async def private_dns(*_args, **_kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))]

        monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", private_dns)
        with pytest.raises(feeds.UnsafeFeedUrl, match="non-public"):
            await feeds.check_public_host("https://publisher.example.org/feed")

    asyncio.run(run())


def test_redirects_and_compressed_bodies_cannot_bypass_public_fetch_bounds(monkeypatch) -> None:
    requested: list[str] = []

    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/large":
            return httpx.Response(
                200,
                content=gzip.compress(b"x" * (2 * 1024 * 1024 + 1)),
                headers={"Content-Encoding": "gzip"},
            )
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/private"})

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with pytest.raises(feeds.UnsafeFeedUrl):
                await feeds.fetch_public_document(client, "https://publisher.example.org/redirect")
            with pytest.raises(feeds.PublicFeedFetchError, match="2 MB"):
                await feeds.fetch_public_document(client, "https://publisher.example.org/large")

    asyncio.run(run())
    assert all("169.254" not in url for url in requested)


def test_registered_source_collects_relative_links_and_reports_real_fetch_result(
    monkeypatch,
) -> None:
    published = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    text = "Developers can deploy the new agent tools using public reproducible builds and a documented release process with measured operating costs."
    requested: list[str] = []
    receipts: list[dict] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/feed":
            return httpx.Response(302, headers={"Location": "/archive/rss.xml"})
        if request.url.path == "/archive/rss.xml":
            return httpx.Response(
                200,
                text=f"""<rss version="2.0"><channel><title>Publisher</title>
              <item><title>Agent tools launch</title><link>../articles/tools</link><pubDate>{published}</pubDate><description>{text}</description></item>
              <item><title>Unsafe link</title><link>http://127.0.0.1/private</link><pubDate>{published}</pubDate></item>
              <item><title>Missing link</title><pubDate>{published}</pubDate></item>
            </channel></rss>""",
            )
        return httpx.Response(503)

    async def public_dns(_url):
        return None

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: [SEED])
    monkeypatch.setattr(audit, "fetch_feed_sources", lambda: [ROW])
    monkeypatch.setattr(
        audit, "push_feed_fetch_result", lambda _id, result: receipts.append(result) or True
    )
    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    events = asyncio.run(news.fetch_all_async())
    assert len(events) == 1
    assert events[0].source == "news:existing-publisher"
    assert events[0].source_url == "https://publisher.example.org/articles/tools"
    assert events[0].content == text
    assert receipts[0]["count"] == 1 and receipts[0]["error"] is None
    assert receipts[0]["sourceKey"] == "news:existing-publisher"
    assert all("127.0.0.1" not in url for url in requested)


def test_publisher_failure_is_visible_in_registry_instead_of_reported_as_quiet(monkeypatch) -> None:
    receipts: list[dict] = []

    async def public_dns(_url):
        return None

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: [])
    monkeypatch.setattr(audit, "fetch_feed_sources", lambda: [ROW])
    monkeypatch.setattr(
        audit, "push_feed_fetch_result", lambda _id, result: receipts.append(result) or True
    )
    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(
            transport=httpx.MockTransport(lambda _request: httpx.Response(403)), **kwargs
        ),
    )
    assert asyncio.run(news.fetch_all_async()) == []
    assert receipts[0]["count"] == 0
    assert receipts[0]["error"] == "Publisher returned HTTP 403"


def test_registry_read_retries_and_distinguishes_empty_from_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("API_BASE", "https://api.example.org")
    monkeypatch.setenv("ADMIN_TOKEN", "fixture-token")
    attempts: list[str] = []

    def respond(url, **kwargs):
        attempts.append(url)
        status = 503 if len(attempts) == 1 else 200
        return httpx.Response(status, json={"sources": []}, request=httpx.Request("GET", url))

    monkeypatch.setattr(audit.httpx, "get", respond)
    assert audit.fetch_feed_sources() == []
    assert len(attempts) == 2
    monkeypatch.setattr(audit.httpx, "get", lambda url, **kwargs: httpx.Response(200, json={}, request=httpx.Request("GET", url)))
    assert audit.fetch_feed_sources() is None
    monkeypatch.delenv("ADMIN_TOKEN")
    assert audit.fetch_feed_sources() == []
