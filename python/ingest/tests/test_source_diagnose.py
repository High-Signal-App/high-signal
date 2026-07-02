from __future__ import annotations

from high_signal_ingest import source_diagnose


def test_production_diagnostic_fails_without_persistence(monkeypatch) -> None:
    monkeypatch.delenv("API_BASE", raising=False)
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("SEC_USER_AGENT", "high-signal ops@example.com")

    assert source_diagnose.run(require_persistence=True, require_sec_identity=True) == 1


def test_production_diagnostic_accepts_persistence_pair(monkeypatch) -> None:
    monkeypatch.setenv("API_BASE", "https://example.invalid")
    monkeypatch.setenv("ADMIN_TOKEN", "test-token")
    monkeypatch.setenv("SEC_USER_AGENT", "high-signal ops@example.com")

    assert source_diagnose.run(require_persistence=True, require_sec_identity=True) == 0
