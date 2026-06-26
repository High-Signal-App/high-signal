from __future__ import annotations

from high_signal_ingest import pipeline, source_catalog


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
