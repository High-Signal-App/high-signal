"""Regression: multi-item snapshot/review sources must give each event a
*distinct* source_url, else the write-path `dedupe_exact` collapses them all
(shared landing-page bug found 2026-06-27 — eia/bls/google-trends/app-reviews
were collapsing to ~1 event)."""

from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest.sources import (
    appstore_reviews,
    bls,
    eia,
    google_trends,
    jobs,
    package_registries,
    playstore_reviews,
    us_gov_api,
)

_SINCE = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _urls(events):
    return {e.source_url for e in events}


def test_bls_distinct_urls() -> None:
    payload = {"Results": {"series": [
        {"seriesID": "LNS14000000", "data": [{"year": "2026", "period": "M05", "periodName": "May", "value": "4.3"}]},
        {"seriesID": "CUUR0000SA0", "data": [{"year": "2026", "period": "M05", "periodName": "May", "value": "335"}]},
    ]}}
    ev = bls.events_from_response(payload, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_eia_distinct_urls() -> None:
    payload = {"response": {"data": [
        {"period": "2026-04", "stateid": "VA", "price": 7.4},
        {"period": "2026-04", "stateid": "TX", "price": 6.1},
    ]}}
    ev = eia.events_from_response(payload, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_google_trends_distinct_urls() -> None:
    feed = """<rss version="2.0"><channel>
      <item><title>ai notetaker</title><pubDate>Thu, 25 Jun 2026 10:00:00 +0000</pubDate></item>
      <item><title>vector database</title><pubDate>Thu, 25 Jun 2026 10:00:00 +0000</pubDate></item>
    </channel></rss>"""
    ev = google_trends.events_from_feed("US", feed, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_appstore_reviews_distinct_urls() -> None:
    def rev(rid):
        return {"im:rating": {"label": "1"}, "title": {"label": f"t{rid}"}, "content": {"label": "x"},
                "id": {"label": rid}, "updated": {"label": "2026-06-25T08:00:00-07:00"},
                "link": {"attributes": {"href": "https://apps.apple.com/app/id1"}}}
    payload = {"feed": {"entry": [{"x": 1}, rev("11"), rev("22")]}}
    ev = appstore_reviews.reviews_from_feed("App", payload, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_playstore_reviews_distinct_urls() -> None:
    rows = [
        {"reviewId": "a", "content": "c1", "score": 1, "at": datetime(2026, 6, 25, tzinfo=timezone.utc), "_appId": "com.x"},
        {"reviewId": "b", "content": "c2", "score": 5, "at": datetime(2026, 6, 25, tzinfo=timezone.utc), "_appId": "com.x"},
    ]
    ev = playstore_reviews.reviews_to_events("App", rows, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2

# ── 2026-08-30: same bug class, second wave ──────────────────────────────────
# Found by replaying the 2026-08-30T02:30Z daily run (GH run 33288136740)
# against production `/data/sources/*`: of 815 events `dedupe_exact` collapsed
# across a 3,013-event sample, only 271 were true duplicates (title Jaccard
# >= 0.9). The other 544 were distinct records sharing a landing-page URL —
# npm/PyPI/crates release histories, whole job boards, and the entire NOAA
# active-alert set.


def test_npm_releases_have_distinct_urls() -> None:
    payload = {
        "homepage": "https://nextjs.org",
        "time": {
            "created": "2025-01-01T00:00:00.000Z",
            "16.3.1": "2026-06-25T05:00:00.000Z",
            "16.3.2": "2026-06-25T06:00:00.000Z",
            "16.4.0-canary.1": "2026-06-25T07:00:00.000Z",
        },
        "versions": {},
    }
    ev = package_registries.npm_events_from_metadata(
        package_registries.PackageTarget("npm", "next", "VERCEL"), payload, _SINCE
    )
    assert len(ev) == 3 and len(_urls(ev)) == 3


def test_pypi_releases_have_distinct_urls() -> None:
    def rel(ts):
        return [{"upload_time_iso_8601": ts}]

    payload = {
        "info": {"summary": "x", "project_url": "https://pypi.org/project/langflow/"},
        "releases": {
            "1.11.4": rel("2026-06-25T05:00:00.000Z"),
            "1.12.0rc1": rel("2026-06-25T06:00:00.000Z"),
        },
    }
    ev = package_registries.pypi_events_from_metadata(
        package_registries.PackageTarget("pypi", "langflow", "LANGFLOW"), payload, _SINCE
    )
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_crates_releases_have_distinct_urls() -> None:
    payload = {
        "crate": {"homepage": "https://tokio.rs", "description": "async runtime"},
        "versions": [
            {"num": "1.40.0", "created_at": "2026-06-25T05:00:00.000Z"},
            {"num": "1.41.0", "created_at": "2026-06-25T06:00:00.000Z"},
        ],
    }
    ev = package_registries.crates_events_from_metadata(
        package_registries.PackageTarget("crates-io", "tokio", "TOKIO"), payload, _SINCE
    )
    assert len(ev) == 2 and len(_urls(ev)) == 2


def test_job_postings_have_distinct_urls_without_hosted_link() -> None:
    """A board payload missing its hosted link must not collapse the board."""
    target = jobs.JobBoardTarget("ashby", "OpenAI", "OPENAI", "OpenAI")
    payload = {
        "jobs": [
            {"id": "j1", "title": "Research Engineer", "publishedAt": "2026-06-25T05:00:00Z"},
            {"id": "j2", "title": "Platform Engineer", "publishedAt": "2026-06-25T06:00:00Z"},
        ]
    }
    ev = jobs.ashby_events_from_payload(target, payload, _SINCE)
    assert len(ev) == 2 and len(_urls(ev)) == 2
    assert "https://jobs.ashbyhq.com/OpenAI/j1" in _urls(ev)

    gh_target = jobs.JobBoardTarget("greenhouse", "anthropic", "ANTHROPIC", "Anthropic")
    gh = jobs.greenhouse_events_from_payload(
        gh_target,
        {
            "jobs": [
                {"id": 1, "title": "Research Engineer", "updated_at": "2026-06-25T05:00:00Z"},
                {"id": 2, "title": "Platform Engineer", "updated_at": "2026-06-25T06:00:00Z"},
            ]
        },
        _SINCE,
    )
    assert len(gh) == 2 and len(_urls(gh)) == 2
    assert "https://boards.greenhouse.io/anthropic/jobs/1" in _urls(gh)


def test_hosted_posting_link_still_wins() -> None:
    target = jobs.JobBoardTarget("lever", "huggingface", "HUGGINGFACE", "Hugging Face")
    ev = jobs.lever_events_from_payload(
        target,
        [
            {
                "id": "abc",
                "text": "Inference Engineer",
                "hostedUrl": "https://jobs.lever.co/huggingface/abc",
                "createdAt": 1_780_312_400_000,
                "categories": {"team": "Inference"},
            }
        ],
        _SINCE,
    )
    assert [e.source_url for e in ev] == ["https://jobs.lever.co/huggingface/abc"]


def test_noaa_alerts_have_distinct_urls() -> None:
    """`properties.web` is almost never present; the alert URI must be used."""
    assert (
        us_gov_api._noaa_alert_url(None, "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.a")
        == "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.a"
    )
    assert (
        us_gov_api._noaa_alert_url(None, "urn:oid:2.49.0.1.840.b")
        == "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.b"
    )
    # An explicit `web` link still wins, and a payload with no identity at all
    # keeps the old landing page rather than inventing one.
    assert us_gov_api._noaa_alert_url("https://www.weather.gov/xyz", "") == (
        "https://www.weather.gov/xyz"
    )
    assert us_gov_api._noaa_alert_url(None, "") == "https://www.weather.gov/"
