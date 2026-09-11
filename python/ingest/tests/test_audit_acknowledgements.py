from datetime import datetime, timezone

import httpx
import pytest

from high_signal_ingest import audit
from high_signal_ingest.types import Event


def events(count):
    return [
        Event(
            id=str(i),
            source="synthetic",
            source_url=f"https://example.invalid/{i}",
            published_at=datetime(2026, 9, 9, tzinfo=timezone.utc),
            raw_hash=f"hash-{i}",
        )
        for i in range(count)
    ]


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("API_BASE", "https://example.invalid")
    monkeypatch.setenv("ADMIN_TOKEN", "synthetic-test-token")


def test_partial_batches_count_only_acknowledged_events(monkeypatch, caplog):
    responses = iter([{"inserted": 23}, {"inserted": 1}])
    sizes = []

    def post(_url, **kwargs):
        sizes.append(len(kwargs["json"]["events"]))
        return httpx.Response(200, json=next(responses))

    monkeypatch.setattr(audit.httpx, "post", post)
    assert audit.push_events(events(26), "synthetic-run") == 24
    assert sizes == [25, 1]
    assert "2 unacknowledged" in caplog.text


@pytest.mark.parametrize(
    "body", [{}, {"inserted": True}, {"inserted": -1}, {"inserted": 2}, {"inserted": "1"}, []]
)
def test_invalid_acknowledgement_does_not_claim_persistence(monkeypatch, body):
    monkeypatch.setattr(audit.httpx, "post", lambda *_a, **_k: httpx.Response(200, json=body))
    assert audit.push_events(events(1), "synthetic-run") == 0


def test_failed_batch_does_not_hide_later_success(monkeypatch):
    responses = iter(
        [httpx.Response(503), httpx.Response(503), httpx.Response(200, json={"inserted": 1})]
    )
    monkeypatch.setattr(audit.httpx, "post", lambda *_a, **_k: next(responses))
    assert audit.push_events(events(26), "synthetic-run") == 1


def test_timeout_retries_identical_batch_without_double_counting(monkeypatch):
    payloads = []

    def post(_url, **kwargs):
        payloads.append(kwargs["json"])
        if len(payloads) == 1:
            raise httpx.ReadTimeout("response lost after writes")
        return httpx.Response(200, json={"inserted": len(kwargs["json"]["events"])})

    monkeypatch.setattr(audit.httpx, "post", post)
    assert audit.push_events(events(26), "same-run") == 26
    assert [len(payload["events"]) for payload in payloads] == [25, 25, 1]
    assert payloads[0] == payloads[1]


def test_non_json_success_does_not_claim_persistence(monkeypatch):
    monkeypatch.setattr(audit.httpx, "post", lambda *_a, **_k: httpx.Response(200, text="OK"))
    assert audit.push_events(events(1), "synthetic-run") == 0


def test_other_audit_posts_keep_boolean_contract(monkeypatch):
    monkeypatch.setattr(
        audit.httpx, "post", lambda *_a, **_k: httpx.Response(200, json={"inserted": 1})
    )
    assert audit._post("/admin/llm-runs", {"runs": [{}]}) is True


def test_invalid_header_failure_does_not_log_credentials(monkeypatch, caplog):
    credential = "synthetic-private-token\n"
    monkeypatch.setenv("ADMIN_TOKEN", credential)

    def post(_url, **kwargs):
        raise httpx.LocalProtocolError(
            f"Illegal header value {kwargs['headers']['Authorization']!r}"
        )

    monkeypatch.setattr(audit.httpx, "post", post)
    assert audit.push_events(events(1), "synthetic-run") == 0
    assert "LocalProtocolError" in caplog.text
    assert "synthetic-private-token" not in caplog.text
    assert "Bearer" not in caplog.text
    assert "Illegal header value" not in caplog.text


def test_token_surrounding_whitespace_is_normalized_at_request_boundary(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", " \tsynthetic-test-token\r\n")

    def post(_url, **kwargs):
        assert kwargs["headers"]["Authorization"] == "Bearer synthetic-test-token"
        return httpx.Response(200, json={"inserted": 1})

    monkeypatch.setattr(audit.httpx, "post", post)
    assert audit.push_events(events(1), "synthetic-run") == 1


def test_whitespace_only_token_is_unconfigured(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", " \r\n")

    def post(*_args, **_kwargs):
        pytest.fail("An empty credential must not make a request")

    monkeypatch.setattr(audit.httpx, "post", post)
    assert audit._enabled() is False
    assert audit.push_events(events(1), "synthetic-run") == 0


def test_http_failure_does_not_log_reflected_response_body(monkeypatch, caplog):
    monkeypatch.setattr(
        audit.httpx,
        "post",
        lambda *_a, **_k: httpx.Response(401, text="Bearer synthetic-private-token"),
    )
    assert audit.push_events(events(1), "synthetic-run") == 0
    assert "HTTP 401" in caplog.text
    assert "synthetic-private-token" not in caplog.text
    assert "Bearer" not in caplog.text
