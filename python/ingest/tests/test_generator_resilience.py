"""Resilience tests for the signal-generation LLM call (generator._ai_complete).

Covers: slow provider (timeout), 429, repeated 5xx, oversized input, and
terminal 4xx. All network is mocked via httpx.MockTransport — no real calls.
"""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import httpx
import pytest

from high_signal_ingest import generator


def _meta_reason(meta: dict) -> str:
    return meta.get("reason") or ""


def _make_response(status: int, body: dict | str | None = None) -> httpx.Response:
    content = json.dumps(body) if isinstance(body, dict) else (body or "")
    return httpx.Response(status_code=status, content=content.encode())


def _run_with_transport(transport: httpx.MockTransport, monkeypatch) -> tuple[dict | None, dict]:
    """Patch httpx.post to use the mock transport and run _ai_complete."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test-gateway.example/v1")
    monkeypatch.setenv("AI_RETRIES", "2")
    monkeypatch.setenv("AI_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("AI_BACKOFF_CAP", "0.05")
    monkeypatch.setenv("AI_TIMEOUT", "0.5")

    real_client = httpx.Client(transport=transport)

    def _fake_post(url, **kwargs):
        # Forward the request through the mock-transport-backed client.
        method = kwargs.get("method", "POST")
        headers = kwargs.get("headers", {})
        json_body = kwargs.get("json")
        content = json.dumps(json_body).encode() if json_body else None
        req = httpx.Request(method, url, headers=headers, content=content)
        return real_client.send(req)

    monkeypatch.setattr(httpx, "post", _fake_post)
    return generator._ai_complete("system prompt", "user content")


def test_ai_complete_success_first_try(monkeypatch) -> None:
    """A 200 with valid JSON returns the parsed dict and attempts=1."""
    body = {
        "choices": [{"message": {"content": json.dumps({"publish": True, "headline": "x"})}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return _make_response(200, body)

    transport = httpx.MockTransport(handler)
    out, meta = _run_with_transport(transport, monkeypatch)
    assert out is not None
    assert out["publish"] is True
    assert meta["attempts"] == 1
    assert meta["failure_class"] is None
    assert meta["tokens_in"] == 10


def test_ai_complete_429_retries_then_succeeds(monkeypatch) -> None:
    """A 429 on the first attempt is retried and succeeds on the second."""
    body = {"choices": [{"message": {"content": json.dumps({"publish": False})}}]}
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return _make_response(429, {"error": "rate limited"})
        return _make_response(200, body)

    transport = httpx.MockTransport(handler)
    out, meta = _run_with_transport(transport, monkeypatch)
    assert out is not None
    assert calls["n"] == 2
    assert meta["attempts"] == 2
    assert meta["failure_class"] is None  # success clears the class


def test_ai_complete_repeated_5xx_exhausts_retries(monkeypatch) -> None:
    """Repeated 5xx exhausts the retry budget and returns None (no infinite loop)."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return _make_response(503, {"error": "down"})

    transport = httpx.MockTransport(handler)
    out, meta = _run_with_transport(transport, monkeypatch)
    assert out is None
    assert calls["n"] == 2  # AI_RETRIES=2, not infinite
    assert meta["attempts"] == 2
    assert meta["failure_class"] == "server_error"
    assert "http_503" in _meta_reason(meta)


def test_ai_complete_4xx_is_terminal_no_retry(monkeypatch) -> None:
    """A 400 (non-429) is terminal — no retry, returns None immediately."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return _make_response(400, {"error": "bad request"})

    transport = httpx.MockTransport(handler)
    out, meta = _run_with_transport(transport, monkeypatch)
    assert out is None
    assert calls["n"] == 1
    assert meta["attempts"] == 1
    assert meta["failure_class"] == "client_error"


def test_ai_complete_timeout_retries_then_succeeds(monkeypatch) -> None:
    """A timeout on the first attempt is retried (network blip) and succeeds."""
    body = {"choices": [{"message": {"content": json.dumps({"publish": True})}}]}
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.TimeoutException("slow")
        return _make_response(200, body)

    transport = httpx.MockTransport(handler)
    out, meta = _run_with_transport(transport, monkeypatch)
    assert out is not None
    assert calls["n"] == 2
    assert meta["attempts"] == 2


def test_ai_complete_no_key_returns_none(monkeypatch) -> None:
    """Without an API key, _ai_complete returns None immediately (no network)."""
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    out, meta = generator._ai_complete("s", "u")
    assert out is None
    assert meta["reason"] == "no_api_key"
    assert meta["attempts"] == 0


def test_ai_complete_oversized_input_is_truncated(monkeypatch) -> None:
    """The request_user field in meta is capped at 8000 chars (telemetry bound)."""
    big = "x" * 100_000
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test-gateway.example/v1")
    # We don't need a real call — just check the meta truncation before the call.
    with patch("httpx.post", side_effect=httpx.ConnectError("no network")):
        out, meta = generator._ai_complete("s", big)
    assert out is None
    assert len(meta["request_user"]) == 8000
