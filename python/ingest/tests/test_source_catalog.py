from __future__ import annotations

import json
from pathlib import Path

from high_signal_ingest import pipeline, source_catalog

_WEB_JSON = Path(__file__).resolve().parents[3] / "apps/web/src/lib/source-catalog.json"


def test_catalog_covers_every_pipeline_source() -> None:
    pipeline_sources = {s for s in pipeline.Source.__args__ if s != "all"}
    catalog_sources = {e.id for e in source_catalog.CATALOG}
    missing = pipeline_sources - catalog_sources
    assert not missing, f"sources in pipeline but not catalogued: {sorted(missing)}"


def test_catalog_has_no_phantom_sources() -> None:
    pipeline_sources = {s for s in pipeline.Source.__args__ if s != "all"}
    catalog_sources = {e.id for e in source_catalog.CATALOG}
    phantom = catalog_sources - pipeline_sources
    assert not phantom, f"catalogued sources not in pipeline: {sorted(phantom)}"


def test_to_markdown_renders_table() -> None:
    md = source_catalog.to_markdown()
    assert "# Data-source catalog" in md
    assert "extract info and keep the link" in md
    for entry in source_catalog.CATALOG:
        assert f"`{entry.id}`" in md


def test_web_catalog_json_in_sync() -> None:
    """The static JSON the web /data page imports must match the live catalog,
    or /data silently shows a stale subset of sources (drift found 2026-06-27:
    37 in JSON vs 45 in CATALOG). Regenerate with:
    `python -m high_signal_ingest.source_catalog --json > apps/web/src/lib/source-catalog.json`."""
    committed = json.loads(_WEB_JSON.read_text())
    # round-trip through json so tuple→list normalisation matches the file
    expected = json.loads(
        json.dumps({"sources": source_catalog.to_dicts(), "count": len(source_catalog.CATALOG)})
    )
    assert committed == expected, (
        "apps/web/src/lib/source-catalog.json is stale — regenerate with "
        "`python -m high_signal_ingest.source_catalog --json > apps/web/src/lib/source-catalog.json`"
    )
