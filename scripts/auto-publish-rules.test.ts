#!/usr/bin/env tsx
/**
 * Unit tests for the auto-publish judge's deterministic rubric.
 *
 * Run: `pnpm signals:auto-publish:test`
 *
 * No vitest dependency — uses the in-tree tiny-runner pattern that the rest
 * of `scripts/*.test.ts` uses (sync-signals.test.ts, daily-range.test.ts).
 */

import {
  applyStructuredClaimEvidence,
  deterministicVerdict,
  evidenceCoverage,
  isPredictionMarketOnly,
  type JudgeableSignal,
  type Verdict,
} from "./auto-publish-rules";
import type { ClaimWithEvidence } from "@high-signal/shared";

let failures = 0;
let total = 0;

function check(label: string, signal: JudgeableSignal, expected: Verdict, reasonContains?: string) {
  total++;
  const result = deterministicVerdict(signal);
  if (result.verdict !== expected) {
    failures++;
    console.error(
      `  ✗ ${label}: expected ${expected}, got ${result.verdict} (${result.reason})`,
    );
    return;
  }
  if (reasonContains && !result.reason.includes(reasonContains)) {
    failures++;
    console.error(
      `  ✗ ${label}: verdict ${expected} ok but reason "${result.reason}" missing "${reasonContains}"`,
    );
    return;
  }
  console.log(`  ✓ ${label}`);
}

function checkBool(label: string, actual: boolean, expected: boolean) {
  total++;
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual}`);
  }
}

function claimWithEvidence(
  urls: string[],
  role: "primary" | "corroboration" | "contradiction" = "primary",
): ClaimWithEvidence {
  return {
    id: "claim-1",
    signalId: "signal-1",
    briefItemId: null,
    agentEvalResponseId: null,
    surface: "signal",
    assertion: "A structured assertion",
    confidenceBand: "high",
    reviewStatus: "draft",
    publishReason: null,
    parentClaimId: null,
    version: 1,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    correctedAt: null,
    evidence: urls.map((url, index) => ({
      id: `link-${index}`,
      claimId: "claim-1",
      evidenceUrl: url,
      sourceDocumentId: null,
      role,
      weight: 1,
      notes: null,
      addedAt: new Date().toISOString(),
      addedBy: null,
    })),
  };
}

console.log("structured claim evidence enrichment");
{
  const enriched = applyStructuredClaimEvidence(
    {
      evidenceUrls: ["https://legacy.example/only"],
      publishable: true,
      independentSourceCount: 1,
      sourceClasses: ["market"],
    },
    [claimWithEvidence(["https://reuters.com/a", "https://example.org/b"])],
  );
  checkBool("structured claims replace legacy urls", enriched.evidenceUrls.length === 2, true);
  checkBool("structured hosts replace legacy count", enriched.independentSourceCount === 2, true);
  checkBool("structured source is reported", enriched.provenanceSource === "structured_claims", true);
}
{
  const legacy = applyStructuredClaimEvidence(
    { evidenceUrls: ["https://legacy.example/only"] },
    [],
  );
  checkBool("no claims keeps legacy evidence", legacy.evidenceUrls.length === 1, true);
  checkBool("legacy source is reported", legacy.provenanceSource === "legacy_signal", true);
}
{
  const contradicted = applyStructuredClaimEvidence(
    { evidenceUrls: [], publishable: true },
    [claimWithEvidence(["https://a.example/x", "https://b.example/y"], "contradiction")],
  );
  check("structured contradiction kills", contradicted, "kill", "contradictory");
}

console.log("auto-publish rubric — cite-or-kill floor");
check(
  "kill when zero evidence urls",
  { evidenceUrls: [], publishable: true, independentSourceCount: 5 },
  "kill",
  "cite-or-kill",
);
check(
  "kill when one evidence url",
  { evidenceUrls: ["https://example.com/a"], publishable: true, independentSourceCount: 5 },
  "kill",
  "cite-or-kill",
);

console.log("\nauto-publish rubric — prediction-market-only");
check(
  "kill when all urls are manifold",
  {
    evidenceUrls: [
      "https://manifold.markets/foo/will-x-happen",
      "https://manifold.markets/bar/will-y-happen",
    ],
    publishable: true,
    independentSourceCount: 1,
    sourceClasses: ["market"],
  },
  "kill",
  "prediction-market-only",
);
check(
  "kill when sourceClasses is only ['market']",
  {
    evidenceUrls: ["https://x.com/a", "https://y.com/b"],
    publishable: true,
    independentSourceCount: 1,
    sourceClasses: ["market"],
  },
  "kill",
  "prediction-market-only",
);
check(
  "kill mixed prediction-market domains",
  {
    evidenceUrls: [
      "https://manifold.markets/a",
      "https://polymarket.com/event/b",
      "https://kalshi.com/markets/c",
    ],
    publishable: true,
    independentSourceCount: 1,
  },
  "kill",
  "prediction-market-only",
);
check(
  "publish when one prediction market + one real news source",
  {
    evidenceUrls: ["https://manifold.markets/a", "https://reuters.com/foo"],
    publishable: true,
    independentSourceCount: 2,
    sourceClasses: ["market", "news"],
  },
  "publish",
);

console.log("\nauto-publish rubric — strongest case (both signals agree)");
check(
  "publish when publishable=true AND >=2 independent classes",
  {
    evidenceUrls: ["https://ir.foo.com", "https://reuters.com", "https://bloomberg.com"],
    publishable: true,
    independentSourceCount: 3,
    sourceClasses: ["ir", "news"],
  },
  "publish",
  "independent source classes",
);

console.log("\nauto-publish rubric — fallback drafts");
check(
  "kill fallback even with multiple urls",
  {
    evidenceUrls: ["https://a.com", "https://b.com", "https://c.com"],
    publishable: false,
    independentSourceCount: 1,
    qualityReasons: ["fallback_or_backfill"],
    sourceClasses: ["news"],
  },
  "kill",
  "fallback / backfill",
);

console.log("\nauto-publish rubric — escalation cases");
check(
  "hold when pipeline says ship but corroboration thin",
  {
    evidenceUrls: ["https://reuters.com/a", "https://bloomberg.com/b"],
    publishable: true,
    independentSourceCount: 1,
    sourceClasses: ["news"],
  },
  "hold",
  "escalate to AI",
);
check(
  "hold when corroborated but pipeline held back",
  {
    evidenceUrls: ["https://reuters.com/a", "https://ir.foo.com/b"],
    publishable: false,
    independentSourceCount: 2,
    sourceClasses: ["news", "ir"],
  },
  "hold",
  "pipeline held back",
);

console.log("\nauto-publish rubric — default kill");
check(
  "kill when neither pipeline blessed nor corroborated",
  {
    evidenceUrls: ["https://a.com", "https://b.com"],
    publishable: false,
    independentSourceCount: 1,
    sourceClasses: ["news"],
  },
  "kill",
  "neither pipeline blessing nor",
);

console.log("\nauto-publish rubric — evidence-relevance (the Gemini Omni bug)");
// Body cites The Verge only; the other 4 URLs are adjacent-news-stuffing.
const GEMINI_OMNI_BODY = `Google has released Gemini Omni, a new family of generative AI models that can turn any input type into video ([The Verge](https://www.theverge.com/tech/936507/gemini-omni-hands-on-deepfake-ai-video)). The Omni Flash model, available in Google's Flow platform, improves upon the previous Veo model by allowing video inputs and better character consistency. However, a hands-on review highlights persistent artifacts like inconsistent objects and sudden orientation changes, indicating the technology is still maturing. The launch reinforces Google's commitment to AI despite competition from Microsoft, Meta, and Amazon, and could drive demand for compute infrastructure from NVIDIA. The mixed reception suggests no immediate competitive advantage, leading to a neutral directional outlook.`;
check(
  "kill on evidence-stuffing (Gemini Omni real bug)",
  {
    evidenceUrls: [
      "https://www.tomshardware.com/tech-industry/samsungs-bonus-dispute-spreads-to-chip-packaging-divisions-threatening-hbm-delivery-schedules",
      "https://www.tomshardware.com/tech-industry/micron-begins-producing-americas-most-advanced-dram-at-its-virginia-fab",
      "https://www.tomshardware.com/pc-components/ssds/huawei-introduces-122tb-ssd-without-using-sanctioned-3d-nand-chips",
      "https://www.cnbc.com/2026/05/23/microsofts-new-responsible-tech-lead-on-high-speed-ai-development.html",
      "https://www.theverge.com/tech/936507/gemini-omni-hands-on-deepfake-ai-video",
    ],
    bodyMd: GEMINI_OMNI_BODY,
    publishable: true,
    independentSourceCount: 3,
    sourceClasses: ["news", "other"],
  },
  "kill",
  "evidence-stuffing",
);
check(
  "publish when body actually references each evidence URL",
  {
    evidenceUrls: [
      "https://www.theverge.com/tech/936507/gemini-omni-hands-on-deepfake-ai-video",
      "https://blog.google/products/gemini/omni-launch-2026/",
    ],
    bodyMd:
      "Google launched Gemini Omni ([The Verge](https://www.theverge.com/tech/936507/gemini-omni-hands-on-deepfake-ai-video)) " +
      "with an official rollout post ([Google blog](https://blog.google/products/gemini/omni-launch-2026/)). " +
      "Body discusses launch implications, competition with Microsoft, and demand for NVIDIA compute — clear directional claim about Google's AI position." +
      "More body. More body. More body. More body. More body. More body. More body. More body.",
    publishable: true,
    independentSourceCount: 2,
    sourceClasses: ["news", "blog"],
  },
  "publish",
  "independent source classes",
);
check(
  "skip relevance check when body is too short to evaluate",
  {
    evidenceUrls: ["https://a.com/foo", "https://b.com/bar"],
    bodyMd: "Short body.", // < EVIDENCE_RELEVANCE_MIN_BODY_CHARS
    publishable: true,
    independentSourceCount: 2,
    sourceClasses: ["news", "ir"],
  },
  "publish",
  "independent source classes",
);

console.log("\nevidenceCoverage helper");
checkBool(
  "1.0 when body references every URL",
  evidenceCoverage({
    evidenceUrls: ["https://reuters.com/x", "https://bloomberg.com/y"],
    bodyMd: "Source: https://reuters.com/x and https://bloomberg.com/y",
  }) === 1,
  true,
);
checkBool(
  "fractional when only some URLs are referenced",
  Math.abs(
    evidenceCoverage({
      evidenceUrls: [
        "https://a.com/uniquefirsttopic-launches-today",
        "https://b.com/anothercompletelyseparatetopic-deepdive",
      ],
      bodyMd: "We cite the uniquefirsttopic launch in detail here.", // matches only URL1's slug
    }) - 0.5,
  ) < 0.01,
  true,
);
checkBool(
  "1.0 when evidenceUrls is empty (cite-or-kill handles separately)",
  evidenceCoverage({ evidenceUrls: [], bodyMd: "x" }) === 1,
  true,
);

console.log("\nisPredictionMarketOnly");
checkBool("true for all manifold", isPredictionMarketOnly({
  evidenceUrls: ["https://manifold.markets/a", "https://manifold.markets/b"],
}), true);
checkBool("true for mixed prediction markets", isPredictionMarketOnly({
  evidenceUrls: ["https://manifold.markets/a", "https://www.polymarket.com/b"],
}), true);
checkBool("false when any non-market url present", isPredictionMarketOnly({
  evidenceUrls: ["https://manifold.markets/a", "https://reuters.com/b"],
}), false);
checkBool("false for empty urls", isPredictionMarketOnly({ evidenceUrls: [] }), false);
checkBool("false for malformed url", isPredictionMarketOnly({
  evidenceUrls: ["not a url"],
}), false);

console.log(`\nauto-publish-rules.test.ts: ${total - failures}/${total} passed`);
if (failures > 0) {
  console.error(`auto-publish-rules.test.ts: FAILED (${failures} failure${failures === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("auto-publish-rules.test.ts: ok");
