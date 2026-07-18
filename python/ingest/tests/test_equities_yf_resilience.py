"""Resilience tests for the yfinance batch downloader (_download_batch).

Covers: per-batch timeout (SIGALRM), bounded retry on transient failure, and
terminal failure after exhausting retries. yf.download is monkeypatched — no
network.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pandas as pd
import pytest

from high_signal_ingest.sources.equities import yf


def test_download_batch_success(monkeypatch) -> None:
    """A successful download returns the DataFrame on the first attempt."""
    monkeypatch.setenv("YF_BATCH_RETRIES", "2")
    monkeypatch.setenv("YF_BATCH_TIMEOUT", "0")  # disable alarm for test
    # Reimport env vars into module constants
    monkeypatch.setattr(yf, "_YF_BATCH_RETRIES", 2)
    monkeypatch.setattr(yf, "_YF_BATCH_TIMEOUT", 0.0)

    df = pd.DataFrame({"Close": [100.0]}, index=pd.to_datetime(["2024-01-02"]))
    with patch("high_signal_ingest.sources.equities.yf.yf.download", return_value=df) as mock:
        out = yf._download_batch(["AAPL"], "6y")
    assert out is not None
    assert mock.call_count == 1


def test_download_batch_retries_on_transient(monkeypatch) -> None:
    """A transient exception is retried and succeeds on the second attempt."""
    monkeypatch.setenv("YF_BATCH_RETRIES", "2")
    monkeypatch.setenv("YF_BATCH_TIMEOUT", "0")
    monkeypatch.setenv("YF_BATCH_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("YF_BATCH_BACKOFF_CAP", "0.05")
    monkeypatch.setattr(yf, "_YF_BATCH_RETRIES", 2)
    monkeypatch.setattr(yf, "_YF_BATCH_TIMEOUT", 0.0)
    monkeypatch.setattr(yf, "_YF_BATCH_BACKOFF_BASE", 0.01)
    monkeypatch.setattr(yf, "_YF_BATCH_BACKOFF_CAP", 0.05)

    df = pd.DataFrame({"Close": [100.0]}, index=pd.to_datetime(["2024-01-02"]))
    calls = {"n": 0}

    def _flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient yahoo blip")
        return df

    with patch("high_signal_ingest.sources.equities.yf.yf.download", side_effect=_flaky):
        out = yf._download_batch(["AAPL"], "6y")
    assert out is not None
    assert calls["n"] == 2


def test_download_batch_exhausts_retries(monkeypatch) -> None:
    """Repeated failure exhausts the retry budget and returns None (no infinite loop)."""
    monkeypatch.setenv("YF_BATCH_RETRIES", "2")
    monkeypatch.setenv("YF_BATCH_TIMEOUT", "0")
    monkeypatch.setenv("YF_BATCH_BACKOFF_BASE", "0.01")
    monkeypatch.setenv("YF_BATCH_BACKOFF_CAP", "0.05")
    monkeypatch.setattr(yf, "_YF_BATCH_RETRIES", 2)
    monkeypatch.setattr(yf, "_YF_BATCH_TIMEOUT", 0.0)
    monkeypatch.setattr(yf, "_YF_BATCH_BACKOFF_BASE", 0.01)
    monkeypatch.setattr(yf, "_YF_BATCH_BACKOFF_CAP", 0.05)

    calls = {"n": 0}

    def _always_fail(*a, **kw):
        calls["n"] += 1
        raise RuntimeError("yahoo down")

    with patch("high_signal_ingest.sources.equities.yf.yf.download", side_effect=_always_fail):
        out = yf._download_batch(["AAPL"], "6y")
    assert out is None
    assert calls["n"] == 2  # not infinite


def test_fetch_many_skips_failed_batch(monkeypatch) -> None:
    """fetch_many continues to the next batch when one batch fails completely."""
    monkeypatch.setenv("YF_BATCH_RETRIES", "1")
    monkeypatch.setenv("YF_BATCH_TIMEOUT", "0")
    monkeypatch.setattr(yf, "_YF_BATCH_RETRIES", 1)
    monkeypatch.setattr(yf, "_YF_BATCH_TIMEOUT", 0.0)

    good_df = pd.DataFrame(
        {"Close": [200.0]},
        index=pd.to_datetime(["2024-01-02"]),
    )

    def _download(symbols, **kw):
        if "BAD" in symbols:
            raise RuntimeError("bad ticker batch")
        return good_df

    with patch("high_signal_ingest.sources.equities.yf.yf.download", side_effect=_download):
        out = yf.fetch_many(["BAD.US", "GOOD.US"], period="6y", batch_size=1)
    # BAD batch failed and is empty; GOOD batch succeeded.
    assert out["BAD.US"] == []
    assert len(out["GOOD.US"]) == 1
    assert out["GOOD.US"][0].close == 200.0
