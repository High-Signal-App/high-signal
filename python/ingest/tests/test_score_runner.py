from datetime import datetime, timezone

from high_signal_ingest.score import runner


def test_missing_rights_or_history_does_not_finalize_a_pending_signal(monkeypatch):
    row = {
        "id": "signal",
        "primary_entity_id": "NVDA",
        "predicted_window_days": 30,
        "published_at": int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()),
        "direction": "up",
    }
    monkeypatch.setattr(runner, "_ticker_for_entity", lambda entity: "NVDA")
    monkeypatch.setattr(runner, "fetch_pending", lambda client: [row])
    monkeypatch.setattr(runner, "forward_return", lambda *args: None)
    posted = []

    def submit(client, rows):
        posted.extend(rows)
        return {"inserted": len(rows)}

    monkeypatch.setattr(runner, "submit_runs", submit)
    assert runner.run()["runs_submitted"] == 0
    assert posted == []
    # The same still-eligible signal can be measured when its inputs qualify.
    monkeypatch.setattr(runner, "forward_return", lambda *args: 10.0)
    assert runner.run()["runs_submitted"] == 1
    assert posted[0]["outcome"] == "hit"


def test_unmapped_entity_keeps_the_existing_unscorable_classification(monkeypatch):
    monkeypatch.setattr(runner, "_ticker_for_entity", lambda entity: None)
    result = runner.score_one(
        {"id": "private-signal", "primary_entity_id": "unknown", "predicted_window_days": 30}
    )
    assert result["outcome"] == "pending"
    assert result["notes"] == "no ticker for entity unknown"
