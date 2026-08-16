from __future__ import annotations

import logging

from high_signal_ingest.extract import relations


def test_extract_relations_is_parked_empty_result() -> None:
    result = relations.extract_relations("TSMC supplies NVIDIA H100s", ["TSM", "NVDA"])

    assert result.relations == []
    assert result.available is False
    assert result.reason == "glirel_parked"
    assert result.backend == "none"


def test_extract_relations_logs_parked_once(caplog) -> None:
    relations._PARKED_LOGGED = False
    with caplog.at_level(logging.INFO, logger=relations.LOGGER.name):
        relations.extract_relations("one", [])
        relations.extract_relations("two", ["NVDA"])

    messages = [record.getMessage() for record in caplog.records if "GLiREL" in record.getMessage()]
    assert len(messages) == 1
    assert "parked" in messages[0]
