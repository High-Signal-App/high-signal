from high_signal_ingest.seed import load_sources
from high_signal_ingest.sources import registered_feeds as feeds


def test_written_strictlyvc_archive_keeps_identity_and_respects_retired_podcast_pause():
    source = next(row for row in load_sources() if row["id"] == "strictlyvc")
    archived = {
        "id": "operator-written-feed",
        "feedUrl": "https://newsletter.strictlyvc.com/",
        "format": "archive",
        "enabled": True,
    }
    selected = feeds.merge_sources([source], [archived], 2)
    assert len(selected) == 1
    assert selected[0]["id"] == "strictlyvc"
    assert selected[0]["rss"] is None
    assert selected[0]["archive"]["url"] == "https://newsletter.strictlyvc.com/"
    retired_pause = {
        "id": "operator-old-feed",
        "feedUrl": "https://feeds.buzzsprout.com/850276.rss",
        "enabled": False,
    }
    assert feeds.merge_sources([source], [retired_pause, archived], 2) == []
    assert feeds.merge_sources([source], [archived, retired_pause], 2) == []


def test_official_newsletter_aliases_select_known_public_archive_in_operator_intake():
    startups = feeds.known_public_archive("https://www.startups.fyi/")
    assert startups is not None and startups["url"] == "https://startupsfyi.beehiiv.com/"
    strictly = feeds.known_public_archive("https://strictlyvc.com/newsletter/")
    assert strictly is not None and strictly["id"] == "strictlyvc"
