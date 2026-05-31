from __future__ import annotations

from datetime import datetime, timezone

from high_signal_ingest import pipeline
from high_signal_ingest.sources import cisa_kev


def test_event_from_vulnerability_maps_structured_fields() -> None:
    event = cisa_kev.event_from_vulnerability(
        {
            "cveID": "CVE-2026-48027",
            "vendorProject": "Nx",
            "product": "Nx Console",
            "vulnerabilityName": "Nx Console Embedded Malicious Code Vulnerability",
            "dateAdded": "2026-05-27",
            "shortDescription": "Nx Console contains embedded malicious code.",
            "requiredAction": "Apply mitigations per vendor instructions.",
            "dueDate": "2026-06-10",
            "knownRansomwareCampaignUse": "Known",
            "notes": (
                "https://github.com/nrwl/nx-console/security/advisories/GHSA-c9j4-9m59-847w ; "
                "https://nvd.nist.gov/vuln/detail/CVE-2026-48027"
            ),
            "cwes": ["CWE-506"],
        }
    )

    assert event is not None
    assert event.source == "cisa-kev"
    assert event.source_url.endswith("search_api_fulltext=CVE-2026-48027")
    assert event.published_at == datetime(2026, 5, 27, tzinfo=timezone.utc)
    assert event.title == (
        "CISA KEV: Nx / Nx Console / Nx Console Embedded Malicious Code Vulnerability"
    )
    assert "Known ransomware campaign use: Known" in (event.content or "")
    assert "CWE: CWE-506" in (event.content or "")
    assert "github.com/nrwl/nx-console" in (event.content or "")
    assert event.primary_entity_id == "NX"


def test_event_from_vulnerability_skips_missing_required_fields() -> None:
    assert cisa_kev.event_from_vulnerability({"cveID": "CVE-2026-1"}) is None
    assert cisa_kev.event_from_vulnerability({"dateAdded": "2026-05-27"}) is None


def test_pipeline_fetch_includes_cisa_kev(monkeypatch) -> None:
    calls: list[int] = []

    def fake_fetch_all(days: int):
        calls.append(days)
        return []

    monkeypatch.setattr(pipeline.cisa_kev, "fetch_all", fake_fetch_all)

    assert pipeline.fetch("cisa-kev", days=1) == []
    assert calls == [7]


def test_cisa_kev_uses_exact_entity_mapping_without_ticker_false_positive() -> None:
    microsoft = cisa_kev.event_from_vulnerability(
        {
            "cveID": "CVE-2026-41091",
            "vendorProject": "Microsoft",
            "product": "Defender",
            "dateAdded": "2026-05-20",
        }
    )
    daemon_lite = cisa_kev.event_from_vulnerability(
        {
            "cveID": "CVE-2026-8398",
            "vendorProject": "Daemon",
            "product": "Daemon Tools Lite",
            "dateAdded": "2026-05-27",
        }
    )

    assert microsoft is not None
    assert microsoft.primary_entity_id == "MSFT"
    assert daemon_lite is not None
    assert daemon_lite.primary_entity_id is None
    assert pipeline._event_entity(daemon_lite) is None
