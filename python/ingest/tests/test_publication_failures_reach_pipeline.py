"""Publisher failures must remain visible when another publication succeeds."""

from datetime import datetime, timezone
import json

import httpx
import pytest

from high_signal_ingest import pipeline
from high_signal_ingest.sources import news


@pytest.fixture
def publications(monkeypatch):
    sources = [
        {"id": name, "type": "blog", "tier": 2, "rss": f"https://{name}.example.org/feed"}
        for name in ["healthy", "blocked", "invalid", "quiet", "paused"]
    ]
    requested = []
    individual_receipts = []
    run_receipts = []
    delivered = []
    published = datetime.now(timezone.utc).isoformat()

    def respond(request):
        requested.append(request.url.host)
        name = request.url.host.split(".")[0]
        if name == "blocked":
            return httpx.Response(403)
        if name == "invalid":
            return httpx.Response(200, text="<html>Not RSS</html>")
        if name == "quiet":
            return httpx.Response(200, text='<rss version="2.0"><channel/></rss>')
        if request.url.path == "/article":
            return httpx.Response(503)
        return httpx.Response(
            200,
            text=f"""<rss version="2.0"><channel><item>
            <title>Public research update</title>
            <link>https://healthy.example.org/article</link><pubDate>{published}</pubDate>
            <description>Researchers published their findings and the full public dataset.
            The report describes the methods and limitations of the new experiment.</description>
            </item></channel></rss>""",
        )

    async def public_host(_url):
        return None

    client = httpx.AsyncClient
    monkeypatch.setattr(news, "load_sources", lambda: sources)
    monkeypatch.setattr(
        news.audit,
        "fetch_feed_sources",
        lambda: [{"id": "paused", "feedUrl": sources[-1]["rss"], "enabled": False}],
    )
    monkeypatch.setattr(
        news.audit, "push_ingest_runs", lambda rows: individual_receipts.extend(rows)
    )
    monkeypatch.setattr(news.registered_feeds, "check_public_host", public_host)
    monkeypatch.setattr(
        news.httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs),
    )
    monkeypatch.setattr(
        pipeline.audit, "push_events", lambda events, _run: delivered.extend(events) or len(events)
    )
    monkeypatch.setattr(
        pipeline.audit, "push_ingest_run", lambda **kwargs: run_receipts.append(kwargs)
    )
    monkeypatch.setattr(pipeline, "_event_entity", lambda _event: None)
    return requested, individual_receipts, run_receipts, delivered


def test_mixed_publications_keep_articles_and_report_each_failure_once(publications):
    requested, individual, runs, delivered = publications
    result = pipeline.run("news", 1, generate_signals=False)

    assert result["events"] == result["events_pushed"] == 1
    assert [event.source for event in delivered] == ["news:healthy"]
    assert result["errors"] == 2
    assert runs[0]["errors"] == 2
    assert "news:blocked: Publisher returned HTTP 403" in runs[0]["error_sample"]
    assert {row["source"]: row["errors"] for row in individual} == {
        "news:healthy": 0,
        "news:blocked": 1,
        "news:invalid": 1,
        "news:quiet": 0,
    }
    assert requested.count("blocked.example.org") == 1
    assert "paused.example.org" not in requested


@pytest.mark.parametrize("source,errors", [("blocked", 1), ("quiet", 0), ("paused", 0)])
def test_single_publication_distinguishes_failure_from_quiet_or_paused(
    publications, source, errors
):
    result = pipeline.run(f"news:{source}", 1, generate_signals=False)
    assert result["events"] == 0
    assert result["errors"] == errors
    assert publications[2][0]["errors"] == errors


@pytest.mark.parametrize("source,exit_code,errors", [("news:blocked", 2, 1), ("news", None, 2)])
def test_cli_fails_for_total_outage_but_keeps_partial_success(
    publications, monkeypatch, capfd, source, exit_code, errors
):
    monkeypatch.setattr(
        pipeline.sys, "argv", ["ingest", "--source", source, "--fetch-only", "--json"]
    )
    if exit_code is None:
        pipeline.main()
    else:
        with pytest.raises(SystemExit) as exc:
            pipeline.main()
        assert exc.value.code == exit_code
    assert json.loads(capfd.readouterr().out)["errors"] == errors
