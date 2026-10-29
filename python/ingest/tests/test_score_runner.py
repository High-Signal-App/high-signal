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


def test_pagination_reaches_a_scorable_signal_after_200_temporary_gaps(monkeypatch):
    import json
    import httpx

    row = {
        "id": "stuck",
        "primary_entity_id": "STUCK",
        "predicted_window_days": 30,
        "published_at": 1,
        "direction": "up",
    }
    posted = []

    def response(request):
        if request.method == "POST":
            posted.extend(json.loads(request.content)["runs"])
            return httpx.Response(200, json={"inserted": len(posted)})
        if not request.url.params.get("after"):
            return httpx.Response(
                200,
                json={
                    "pending": [{**row, "id": f"stuck-{index:03}"} for index in range(200)],
                    "nextCursor": "stuck-199",
                },
            )
        return httpx.Response(
            200,
            json={
                "pending": [{**row, "id": "valid", "primary_entity_id": "VALID"}],
                "nextCursor": None,
            },
        )

    original = httpx.Client
    monkeypatch.setattr(
        runner.httpx,
        "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(response), **kwargs),
    )
    monkeypatch.setattr(runner, "_admin_token", lambda: "unit-test")
    monkeypatch.setattr(runner, "_ticker_for_entity", lambda entity: entity)
    monkeypatch.setattr(
        runner, "forward_return", lambda ticker, *args: 10.0 if ticker == "VALID" else None
    )
    assert runner.run() == {"pending": 201, "runs_submitted": 1, "inserted": 1}
    assert [run["signalId"] for run in posted] == ["valid"]


def test_score_writes_are_bounded_for_a_large_backlog(monkeypatch):
    import json
    import httpx

    batch_sizes = []

    def response(request):
        rows = json.loads(request.content)["runs"]
        batch_sizes.append(len(rows))
        return httpx.Response(200, json={"inserted": len(rows)})

    monkeypatch.setattr(runner, "_admin_token", lambda: "unit-test")
    with httpx.Client(transport=httpx.MockTransport(response)) as client:
        assert runner.submit_runs(client, [{"signalId": str(index)} for index in range(201)]) == {
            "inserted": 201
        }
    assert batch_sizes == [50, 50, 50, 50, 1]
