from high_signal_ingest.company_universe_entities import company_text, normalize_predictions


def test_normalize_predictions_deduplicates_and_bounds_facets() -> None:
    predictions = [
        {"text": " searchable memory ", "label": "Product Capability", "score": 0.72},
        {"text": "searchable memory", "label": "product capability", "score": 0.91},
        {"text": "AI agents", "label": "technology", "score": 0.84},
        {"text": "", "label": "product", "score": 0.99},
    ]

    assert normalize_predictions(predictions) == [
        {"text": "searchable memory", "label": "product capability", "score": 0.91},
        {"text": "AI agents", "label": "technology", "score": 0.84},
    ]


def test_company_text_includes_preserved_source_descriptions() -> None:
    text = company_text(
        {
            "name": "screenpipe",
            "description": "Record how you work",
            "sourceEvidence": [{"description": "Local-first searchable memory for agents"}],
        }
    )

    assert "screenpipe" in text
    assert "Local-first searchable memory" in text
