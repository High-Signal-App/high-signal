import high_signal_ingest.analysis.semantic_nlp as semantic_nlp


def test_defaults_to_rules_without_hf() -> None:
    out = semantic_nlp.annotate(
        "The checkout is broken and support delays refunds.",
        use_hf=False,
    )

    assert out.method == "rules-v1"
    assert out.sentiment == "negative"
    assert out.intent in {"complaint", "operational-risk"}
    assert out.model_names == []


def test_hf_sentiment_can_enrich_without_requiring_intent_model(monkeypatch) -> None:
    monkeypatch.setattr(
        semantic_nlp,
        "_sentiment_pipeline",
        lambda: lambda _text: [{"label": "POSITIVE", "score": 0.98}],
    )
    monkeypatch.setattr(semantic_nlp, "_zero_shot_pipeline", lambda: None)

    out = semantic_nlp.annotate(
        "Users say the new onboarding is useful and works better.",
        use_hf=True,
    )

    assert out.method == "rules-v1+hf-sentiment"
    assert out.sentiment == "positive"
    assert out.hf_sentiment_score == 0.98


def test_hf_intent_uses_configured_zero_shot_model(monkeypatch) -> None:
    monkeypatch.setenv("HIGH_SIGNAL_HF_INTENT_MODEL", "test/zero-shot")
    monkeypatch.setattr(
        semantic_nlp,
        "_sentiment_pipeline",
        lambda: lambda _text: [{"label": "NEGATIVE", "score": 0.97}],
    )
    monkeypatch.setattr(
        semantic_nlp,
        "_zero_shot_pipeline",
        lambda: lambda _text, candidate_labels, multi_label: {
            "labels": ["request for a product feature or integration"],
            "scores": [0.91],
        },
    )

    out = semantic_nlp.annotate("Need support for QuickBooks integration.", use_hf=True)

    assert out.method == "rules-v1+hf-intent-sentiment"
    assert out.intent == "feature-request"
    assert out.sentiment == "negative"
    assert out.hf_intent_score == 0.91
    assert "test/zero-shot" in out.model_names
