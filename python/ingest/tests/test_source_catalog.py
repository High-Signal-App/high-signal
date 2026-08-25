from __future__ import annotations

import json
from pathlib import Path

from high_signal_ingest import pipeline, source_catalog

_REPO_ROOT = Path(__file__).resolve().parents[3]
_GENERATED_JSON = [
    _REPO_ROOT / "apps/web/src/lib/source-catalog.json",
    _REPO_ROOT / "workers/api/src/lib/source-catalog.json",
]
_DAILY_WORKFLOW = _REPO_ROOT / ".github/workflows/cron-ingest.yml"
_CADENCE_WORKFLOW = _REPO_ROOT / ".github/workflows/cron-source-cadences.yml"


def test_catalog_covers_every_pipeline_source() -> None:
    selectors = set(source_catalog.PIPELINE_SOURCE_GROUPS)
    pipeline_sources = {s for s in pipeline.Source.__args__ if s not in selectors}
    catalog_sources = {e.id for e in source_catalog.CATALOG}
    missing = pipeline_sources - catalog_sources
    assert not missing, f"sources in pipeline but not catalogued: {sorted(missing)}"


def test_catalog_has_no_phantom_sources() -> None:
    selectors = set(source_catalog.PIPELINE_SOURCE_GROUPS)
    pipeline_sources = {s for s in pipeline.Source.__args__ if s not in selectors}
    catalog_sources = {e.id for e in source_catalog.CATALOG}
    phantom = catalog_sources - pipeline_sources
    assert not phantom, f"catalogued sources not in pipeline: {sorted(phantom)}"


def test_to_markdown_renders_table() -> None:
    md = source_catalog.to_markdown()
    assert "# Data-source catalog" in md
    assert "Content depth varies by adapter" in md
    for entry in source_catalog.CATALOG:
        assert f"`{entry.id}`" in md


def test_generated_catalog_json_in_sync() -> None:
    """The static JSON imported by the web and API must match the live catalog,
    or /data silently shows a stale subset of sources (drift found 2026-06-27:
    37 in JSON vs 45 in CATALOG). Regenerate with:
    `python -m high_signal_ingest.source_catalog --json` for both generated files."""
    # round-trip through json so tuple→list normalisation matches the file
    expected = json.loads(
        json.dumps({"sources": source_catalog.to_dicts(), "count": len(source_catalog.CATALOG)})
    )
    for path in _GENERATED_JSON:
        committed = json.loads(path.read_text())
        assert committed == expected, f"{path.relative_to(_REPO_ROOT)} is stale"


def test_operational_metadata_is_complete_and_honest() -> None:
    rows = {row["id"]: row for row in source_catalog.to_dicts()}
    assert set(rows) == {entry.id for entry in source_catalog.CATALOG}
    assert {row["cadence"] for row in rows.values()} == {
        "daily",
        "context",
        "weekly",
        "monthly",
        "on_demand",
        "manual",
        "parked",
    }
    assert sum(row["cadence"] == "daily" for row in rows.values()) == 21
    assert sum(row["cadence"] == "context" for row in rows.values()) == 3
    assert sum(row["cadence"] == "weekly" for row in rows.values()) == 14
    assert sum(row["cadence"] == "monthly" for row in rows.values()) == 3
    assert sum(row["cadence"] == "on_demand" for row in rows.values()) == 5
    assert sum(row["cadence"] == "manual" for row in rows.values()) == 2
    assert sum(row["cadence"] == "parked" for row in rows.values()) == 7
    assert rows["wikidata"]["cadence"] == "manual"
    assert rows["companies-house"]["cadence"] == "manual"
    assert rows["patents"]["cadence"] == "parked"
    assert rows["vc-portfolios"]["cadence"] == "parked"
    assert rows["news"]["termsRisk"] == "restricted"
    assert rows["youtube"]["termsRisk"] == "unofficial-transcript"
    for row in rows.values():
        assert row["accessBasis"]
        assert row["contentDepth"]
        assert row["retention"]


def test_cadence_groups_partition_the_catalog() -> None:
    grouped = [set(source_ids) for source_ids in source_catalog.SOURCE_CADENCE_GROUPS.values()]
    assert set().union(*grouped) == {entry.id for entry in source_catalog.CATALOG}
    for index, source_ids in enumerate(grouped):
        for other in grouped[index + 1 :]:
            assert source_ids.isdisjoint(other)

    assert source_catalog.PIPELINE_SOURCE_GROUPS["all"] == source_catalog.DAILY_SOURCES
    assert source_catalog.PIPELINE_SOURCE_GROUPS["context"] == source_catalog.CONTEXT_SOURCES
    assert source_catalog.PIPELINE_SOURCE_GROUPS["weekly"] == source_catalog.WEEKLY_SOURCES
    assert source_catalog.PIPELINE_SOURCE_GROUPS["monthly"] == source_catalog.MONTHLY_SOURCES


def test_scheduled_workflows_cover_declared_groups() -> None:
    daily = _DAILY_WORKFLOW.read_text()
    cadence = _CADENCE_WORKFLOW.read_text()

    assert "--source \"${{ inputs.source || 'all' }}\"" in daily
    assert "--source macro-rates --days 30 --fetch-only" in cadence
    assert "--source crypto-onchain --days 1 --fetch-only" in cadence
    assert "--source weekly --days 14" in cadence
    assert "--source monthly --days 120" in cadence
    assert 'cron: "0 1 * * *"' in cadence
    assert 'cron: "0 0 * * 0"' in cadence
    assert 'cron: "30 0 1 * *"' in cadence
