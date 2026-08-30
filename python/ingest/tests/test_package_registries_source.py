from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import package_registries
from high_signal_ingest.sources.package_registries import PackageTarget


def test_npm_events_from_metadata() -> None:
    payload = {
        "description": "Smart monorepo tooling",
        "homepage": "https://nx.dev",
        "time": {
            "created": "2025-01-01T00:00:00.000Z",
            "modified": "2026-05-31T00:00:00.000Z",
            "21.0.0": "2026-05-31T05:00:00.000Z",
        },
        "versions": {"21.0.0": {"description": "Nx release"}},
    }

    events = package_registries.npm_events_from_metadata(
        PackageTarget("npm", "nx", "NX"),
        payload,
        datetime(2026, 5, 31, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "package:npm:nx"
    assert events[0].primary_entity_id == "NX"
    # Per-release permalink, not the shared package homepage — the homepage is
    # identical for every version and collapsed release histories in
    # `dedupe_exact` (see tests/test_source_url_distinctness.py).
    assert events[0].source_url == "https://www.npmjs.com/package/nx/v/21.0.0"
    assert events[0].source_document is not None
    assert events[0].source_document.parsed_fields["homepage"] == "https://nx.dev"


def test_pypi_events_from_metadata() -> None:
    payload = {
        "info": {"summary": "LLM gateway", "home_page": "https://www.litellm.ai"},
        "releases": {
            "1.0.0": [
                {
                    "upload_time_iso_8601": "2026-05-31T05:30:00.000Z",
                }
            ]
        },
    }

    events = package_registries.pypi_events_from_metadata(
        PackageTarget("PyPI", "litellm", "LITELLM"),
        payload,
        datetime(2026, 5, 31, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "package:pypi:litellm"
    assert events[0].primary_entity_id == "LITELLM"


def test_osv_events_from_response() -> None:
    payload = {
        "vulns": [
            {
                "id": "GHSA-1234",
                "published": "2026-05-31T06:00:00Z",
                "modified": "2026-05-31T07:00:00Z",
                "aliases": ["CVE-2026-0001"],
                "summary": "Supply-chain issue",
            }
        ]
    }

    events = package_registries.osv_events_from_response(
        PackageTarget("npm", "@tanstack/react-query", "TANSTACK"),
        payload,
        datetime(2026, 5, 31, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "osv:npm:@tanstack/react-query"
    assert events[0].source_url == "https://osv.dev/vulnerability/GHSA-1234"


def test_pipeline_fetch_includes_packages(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.package_registries, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("packages", days=1) == []
    assert calls == [7]
