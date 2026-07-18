"""Resilience tests for the D2C agent-visibility overlay.

Covers: bounded concurrency (Semaphore), 429 retry, repeated 5xx (no infinite
loop), timeout, and oversized fan-out. All network is mocked — no real calls.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from high_signal_ingest import d2c_agent_visibility as av
from high_signal_ingest.d2c_opportunities import NICHES


def _make_response(status: int, body: dict | None = None) -> httpx.Response:
    content = json.dumps(body).encode() if body else b""
    return httpx.Response(status_code=status, content=content)


@pytest.mark.asyncio
async def test_complete_async_429_retries_then_succeeds(monkeypatch) -> None:
    """A 429 on the first attempt is retried and succeeds on the second."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("D2C_AV_RETRIES", "2")
    monkeypatch.setenv("D2C_AV_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("D2C_AV_BACKOFF_CAP", "0.05")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return _make_response(429, {"error": "rate limited"})
        return _make_response(200, {"choices": [{"message": {"content": "1. BrandA — good"}}]})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
        out = await av._complete_async("sys", "usr", client)
    assert out is not None
    assert "BrandA" in out
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_complete_async_repeated_5xx_exhausts_retries(monkeypatch) -> None:
    """Repeated 5xx exhausts the retry budget and returns None (no infinite loop)."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("D2C_AV_RETRIES", "2")
    monkeypatch.setenv("D2C_AV_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("D2C_AV_BACKOFF_CAP", "0.05")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return _make_response(503, {"error": "down"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
        out = await av._complete_async("sys", "usr", client)
    assert out is None
    assert calls["n"] == 2  # not infinite


@pytest.mark.asyncio
async def test_complete_async_4xx_is_terminal(monkeypatch) -> None:
    """A 400 (non-429) is terminal — no retry."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("D2C_AV_RETRIES", "2")
    monkeypatch.setenv("D2C_AV_BACKOFF_BASE", "0.01")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return _make_response(400, {"error": "bad"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
        out = await av._complete_async("sys", "usr", client)
    assert out is None
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_complete_async_timeout_retries(monkeypatch) -> None:
    """A timeout on the first attempt is retried (network blip)."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("D2C_AV_RETRIES", "2")
    monkeypatch.setenv("D2C_AV_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("D2C_AV_BACKOFF_CAP", "0.05")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.TimeoutException("slow")
        return _make_response(200, {"choices": [{"message": {"content": "ok"}}]})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
        out = await av._complete_async("sys", "usr", client)
    assert out is not None
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_run_uses_bounded_concurrency(monkeypatch, tmp_path) -> None:
    """run() caps concurrent gateway calls at D2C_AV_CONCURRENCY.

    We patch _complete_async to record the max in-flight count via a counter
    and assert it never exceeds the cap. This verifies the Semaphore works
    without making real network calls.
    """
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("D2C_AV_CONCURRENCY", "4")

    in_flight = {"current": 0, "max": 0}
    lock = asyncio.Lock()

    async def _fake_complete(system, user, client=None):
        async with lock:
            in_flight["current"] += 1
            in_flight["max"] = max(in_flight["max"], in_flight["current"])
        await asyncio.sleep(0.05)  # simulate work
        async with lock:
            in_flight["current"] -= 1
        return "1. BrandA — good"

    with patch.object(av, "_complete_async", _fake_complete):
        await av.run(limit=20, out_dir=tmp_path)

    assert in_flight["max"] <= 4, f"concurrency exceeded cap: max={in_flight['max']}"
    assert in_flight["max"] >= 2, "expected some parallelism"


@pytest.mark.asyncio
async def test_run_handles_all_failures_gracefully(monkeypatch, tmp_path) -> None:
    """When every niche call fails, run() still writes an artifact with gap=1 entries."""
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test.example/v1")

    async def _fake_complete(system, user, client=None):
        return None

    with patch.object(av, "_complete_async", _fake_complete):
        out_path = await av.run(limit=3, out_dir=tmp_path)

    artifact = json.loads(out_path.read_text())
    assert len(artifact["entries"]) == 3
    assert all(e["gapScore"] == 1.0 for e in artifact["entries"])
    assert all(e["recommendedBrands"] == [] for e in artifact["entries"])
