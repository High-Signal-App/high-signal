from high_signal_ingest.analysis.lightweight_nlp import annotate


def test_detects_complaint_and_negative_sentiment() -> None:
    out = annotate("The checkout is broken and support delays refunds. This is a frustrating problem.")

    assert out.intent in {"complaint", "operational-risk"}
    assert out.sentiment == "negative"
    assert out.urgency in {"low", "medium"}


def test_detects_purchase_intent() -> None:
    out = annotate("Looking for a vendor alternative. Is this worth it at the current pricing?")

    assert out.intent == "purchase-intent"
    assert out.sentiment == "neutral"


def test_detects_mixed_market_signal() -> None:
    out = annotate("Revenue growth is strong, but demand risk and margin pressure are getting worse.")

    assert out.intent == "market-signal"
    assert out.sentiment == "mixed"
