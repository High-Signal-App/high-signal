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


def test_legacy_and_archive_pauses_suppress_replacement_and_explicit_overrides() -> None:
    source = {
        **SEED,
        "rss": None,
        "archive": {"url": "https://publisher.example.org/archive", "kind": "beehiiv"},
        "feed_aliases": [SEED["rss"]],
    }
    assert feeds.merge_sources([source], [], 2) == [source]
    pause = {**ROW, "enabled": False}
    assert feeds.merge_sources([source], [pause], 2) == []
    assert feeds.merge_sources([source], [{**pause, "feedUrl": source["archive"]["url"]}], 2) == []
    override = {**ROW, "id": source["id"], "feedUrl": "https://writer.example.org/atom"}
    assert "archive" not in feeds.merge_sources([source], [override], 2)[0]
    assert feeds.merge_sources([source], [pause, override], 2) == []
    changed = {
        **SEED,
        "rss": "https://publisher.example.org/new-feed",
        "feed_aliases": [SEED["rss"]],
    }
    assert feeds.merge_sources([changed], [pause], 2) == []


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


def test_feed_specific_cap_and_archive_prefix_do_not_expand_article_default(monkeypatch) -> None:
    async def public_dns(_url):
        return None

    monkeypatch.setattr(feeds, "check_public_host", public_dns)
    data = b"x" * (3 * 1024 * 1024)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _r: httpx.Response(200, content=data))
        ) as client:
            document = await feeds.fetch_public_document(
                client, "https://publisher.example.org/feed", max_bytes=4 * 1024 * 1024
            )
            assert len(document.text) == len(data) and not document.truncated
            prefix = await feeds.fetch_public_document(
                client, "https://publisher.example.org/archive", allow_prefix=True
            )
            assert len(prefix.text) == 2 * 1024 * 1024 and prefix.truncated
            with pytest.raises(feeds.PublicFeedFetchError, match="2 MB"):
                await feeds.fetch_public_document(client, "https://publisher.example.org/article")
            with pytest.raises(feeds.PublicFeedFetchError, match="Invalid"):
                await feeds.fetch_public_document(
                    client, "https://publisher.example.org/feed", max_bytes=5 * 1024 * 1024
                )

    asyncio.run(run())


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
    monkeypatch.setattr(
        audit.httpx,
        "get",
        lambda url, **kwargs: httpx.Response(200, json={}, request=httpx.Request("GET", url)),
    )
    assert audit.fetch_feed_sources() is None
    monkeypatch.delenv("ADMIN_TOKEN")
    assert audit.fetch_feed_sources() == []


def test_managed_known_archive_uses_collector_and_pause_survives_aliases() -> None:
    seed = {
        "id": "ml-the-batch",
        "type": "mailing_list",
        "tier": 3,
        "rss": None,
        "archive": {"url": "https://www.deeplearning.ai/the-batch", "kind": "batch"},
        "feed_aliases": ["https://www.deeplearning.ai/the-batch/feed/"],
    }
    row = {
        "id": "feed-batch",
        "feedUrl": seed["archive"]["url"],
        "enabled": True,
        "format": "archive",
    }
    [source] = feeds.merge_sources([seed], [row], 2)
    assert source["id"] == seed["id"]
    assert source["archive"] == seed["archive"] and source["rss"] is None
    assert source["_registry_id"] == "feed-batch"
    assert feeds.merge_sources([seed], [{**row, "enabled": False}], 2) == []
    alias = {**row, "feedUrl": seed["feed_aliases"][0]}
    assert feeds.merge_sources([seed], [alias], 2)[0]["archive"] == seed["archive"]
    assert feeds.merge_sources([seed], [{**alias, "enabled": False}, row], 2) == []
    override = {
        **row,
        "id": seed["id"],
        "format": "rss",
        "feedUrl": "https://publisher.example.org/explicit.xml",
    }
    selected = feeds.merge_sources([seed], [override], 2)
    assert len(selected) == 1 and "archive" not in selected[0]
    assert selected[0]["rss"].endswith("explicit.xml")
    assert feeds.merge_sources([seed], [{**alias, "enabled": False}, override], 2) == []


def test_archive_registry_rejects_unknown_hosts_and_keeps_legacy_feed_rows() -> None:
    with pytest.raises(feeds.PublicFeedFetchError, match="Unsupported public archive"):
        feeds.registry_rows(
            [{**ROW, "format": "archive", "feedUrl": "https://unknown.beehiiv.com/"}]
        )
    assert feeds.registry_rows([ROW])[0].format == "rss"
    source = feeds.merge_sources(
        [], [{**ROW, "format": "archive", "feedUrl": "https://www.cerebras.ai/blog"}], 2
    )[0]
    assert source["archive"] == {"kind": "cerebras", "url": "https://www.cerebras.ai/blog"}
    assert source["_registry_id"] == ROW["id"]


def test_registered_archive_fetches_and_reports_with_standard_receipts(monkeypatch) -> None:
    from high_signal_ingest.sources.public_archives import ArchiveResult

    row = {**ROW, "format": "archive", "feedUrl": "https://www.cerebras.ai/blog"}
    receipts = []

    async def archive(source, since, client, semaphore, extract):
        assert source["archive"]["kind"] == "cerebras"
        return ArchiveResult(
            items=[
                {
                    "title": "Cerebras releases inference improvements",
                    "link": "https://www.cerebras.ai/blog/inference",
                    "published": datetime.now(timezone.utc),
                    "content": "A public dated article describes the released inference changes.",
                }
            ],
            dated=1,
        )

    async def report(source, **kwargs):
        receipts.append((source["_registry_id"], kwargs))

    monkeypatch.setattr(news.public_archives, "fetch_archive", archive)
    monkeypatch.setattr(feeds, "report_fetch", report)
    [source] = feeds.merge_sources([], [row], 2)

    async def run():
        async with httpx.AsyncClient() as client:
            return await news._fetch_source(
                source,
                datetime(2026, 1, 1, tzinfo=timezone.utc),
                client,
                asyncio.Semaphore(2),
                fetch_body=True,
            )

    [event] = asyncio.run(run())
    assert event.source == "news:feed-managed"
    assert receipts[0][0] == row["id"] and receipts[0][1]["count"] == 1
    assert receipts[0][1]["error"] is None
