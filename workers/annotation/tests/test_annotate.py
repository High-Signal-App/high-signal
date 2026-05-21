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
        self.assertEqual(out.method, "rules-v1")
        self.assertEqual(out.model, "none")
        self.assertFalse(out.llm)
        self.assertGreater(out.intentScore, 0)

    def test_detects_purchase_intent(self) -> None:
        out = annotate_text("Looking for an alternative vendor with clear pricing.")
        self.assertEqual(out.intent, "purchase-intent")
        self.assertEqual(out.sentiment, "neutral")

    def test_reports_scores_and_hits(self) -> None:
        out = annotate_text("GitHub CI deploy workflow is broken and blocked review.")
        self.assertEqual(out.intent, "developer-workflow")
        self.assertEqual(out.sentiment, "negative")
        self.assertEqual(out.urgency, "medium")
        self.assertLessEqual(out.intentScore, 1)
        self.assertIn("github", out.intentHits)
        self.assertIn("broken", out.negativeHits)


if __name__ == "__main__":
    unittest.main()
