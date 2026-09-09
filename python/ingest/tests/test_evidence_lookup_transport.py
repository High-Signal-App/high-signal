import httpx
import pytest

from high_signal_ingest import audit


@pytest.mark.parametrize("failures", [0, 1, 2])
def test_read_only_lookup_recovers_once_or_preserves_failure(monkeypatch, failures):
    monkeypatch.setenv("API_BASE", "https://audit.example")
    monkeypatch.setenv("ADMIN_TOKEN", "test-only")
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs["json"]))
        if len(calls) <= failures:
            raise httpx.ConnectError("connection reset by peer")
        return httpx.Response(200, json={"evidence": [{"url": "https://source.example/article"}]})

    monkeypatch.setattr(audit.httpx, "post", post)
    result = audit.fetch_related_evidence("Example retained article title")
    assert len(calls) == min(failures + 1, 2)
    assert all(call == calls[0] for call in calls)
    if failures == 2:
        assert result is None
    else:
        assert result["evidence"][0]["url"] == "https://source.example/article"


def test_valid_empty_result_is_not_retried(monkeypatch):
    calls = []
    monkeypatch.setattr(audit, "_post_result", lambda *args: calls.append(args) or {"evidence": []})
    assert audit.fetch_related_evidence("No matching report") == {"evidence": []}
    assert len(calls) == 1
