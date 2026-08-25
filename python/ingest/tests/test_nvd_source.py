from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import nvd
from high_signal_ingest.sources.nvd import NvdKeyword


def test_events_from_response_maps_cve() -> None:
    payload = {
        "vulnerabilities": [
            {
                "cve": {
                    "id": "CVE-2026-12345",
                    "published": "2026-05-31T08:00:00.000Z",
                    "descriptions": [
                        {"lang": "en", "value": "A GitHub Enterprise Server vulnerability."}
                    ],
                    "references": [{"url": "https://example.com/advisory"}],
                    "metrics": {
                        "cvssMetricV31": [
                            {
                                "cvssData": {"baseScore": 8.8, "baseSeverity": "HIGH"},
                            }
                        ]
                    },
                }
            }
        ]
    }

    events = nvd.events_from_response(
        NvdKeyword("GitHub", "GITHUB"),
        payload,
        datetime(2026, 5, 31, tzinfo=timezone.utc),
    )

    assert len(events) == 1
    assert events[0].source == "nvd:github"
    assert events[0].source_url == "https://nvd.nist.gov/vuln/detail/CVE-2026-12345"
    assert events[0].primary_entity_id == "GITHUB"
    assert "CVSS" in (events[0].content or "")


def test_pipeline_fetch_includes_nvd(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.nvd, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("nvd", days=1) == []
    assert calls == [14]


def test_nvd_timestamp_uses_api_accepted_utc_format() -> None:
    value = datetime(2026, 8, 25, 12, 34, 56, tzinfo=timezone.utc)

    assert nvd._nvd_timestamp(value) == "2026-08-25T12:34:56.000Z"
