from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from annotate import annotate_text


class AnnotationTests(unittest.TestCase):
    def test_detects_regional_pressure(self) -> None:
        out = annotate_text("Local permit delays and rent pressure are hurting small shops.")
        self.assertEqual(out.intent, "regional-pressure")
        self.assertEqual(out.sentiment, "negative")
        self.assertEqual(out.method, "semantic-rules-v2")
        self.assertEqual(out.model, "none")
        self.assertFalse(out.llm)
        self.assertGreater(out.intentScore, 0)
        self.assertEqual(out.signalLayer, "app-complaint")
        self.assertIn("regional", out.domains)
        self.assertGreater(out.painScore, 0)

    def test_detects_purchase_intent(self) -> None:
        out = annotate_text("Looking for an alternative vendor with clear pricing.")
        self.assertEqual(out.intent, "purchase-intent")
        self.assertEqual(out.sentiment, "neutral")
        self.assertGreater(out.buyerIntentScore, 0)
        self.assertTrue(out.productRequirement)

    def test_reports_scores_and_hits(self) -> None:
        out = annotate_text("GitHub CI deploy workflow is broken and blocked review.")
        self.assertEqual(out.intent, "developer-workflow")
        self.assertEqual(out.sentiment, "negative")
        self.assertEqual(out.urgency, "medium")
        self.assertLessEqual(out.intentScore, 1)
        self.assertIn("github", out.intentHits)
        self.assertIn("broken", out.negativeHits)
        self.assertIn("developer", out.domains)
        self.assertGreater(out.actionabilityScore, 0)

    def test_detects_market_watch_layer(self) -> None:
        out = annotate_text("Revenue guidance improved but margins remain a risk.")
        self.assertEqual(out.intent, "market-signal")
        self.assertEqual(out.signalLayer, "market-watch")
        self.assertIn("market", out.domains)


if __name__ == "__main__":
    unittest.main()
