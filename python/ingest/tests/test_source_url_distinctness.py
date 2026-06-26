"""Regression: multi-item snapshot/review sources must give each event a
*distinct* source_url, else the write-path `dedupe_exact` collapses them all
(shared landing-page bug found 2026-06-27 — eia/bls/google-trends/app-reviews
were collapsing to ~1 event)."""

from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest.sources import appstore_reviews, bls, eia, google_trends, playstore_reviews

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
