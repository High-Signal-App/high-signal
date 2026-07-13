#!/usr/bin/env tsx
/**
 * Unit tests for plan 0011 OpenLens helpers.
 *
 * Run: `pnpm openlens-visibility:test`
 */

import {
  buildVisibilityMatrix,
  classifyOwnership,
  computeShareOfVoice,
  computeTrends,
  hostOf,
  sortAttributes,
  type MentionRow,
  type MatrixRow,
} from "@high-signal/shared";
import { readFileSync } from "node:fs";
import {
  verifyVisibilityReportToken,
  visibilityReportToken,
} from "../packages/shared/src/mentions/openlens-visibility";

let failures = 0;
let total = 0;
function checkEq<T>(label: string, actual: T, expected: T) {
  total++;
  if (actual === expected) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

console.log("hostOf");
checkEq("strips www", hostOf("https://www.example.com/x"), "example.com");
checkEq("lowercases", hostOf("https://EXAMPLE.com"), "example.com");
checkEq("null for garbage", hostOf("nope"), null);

console.log("\nclassifyOwnership");
{
  const brand = {
    brandUrl: "https://high-signal.app",
    competitorUrls: [{ id: "openlens", url: "https://openlens.com" }],
  };
  checkEq(
    "owned via brand host",
    classifyOwnership("https://high-signal.app/x", brand).ownership,
    "owned",
  );
  checkEq(
    "competitor via competitor host",
    classifyOwnership("https://openlens.com/foo", brand).ownership,
    "competitor",
  );
  checkEq(
    "competitor id captured",
    classifyOwnership("https://openlens.com/foo", brand).competitorId,
    "openlens",
  );
  checkEq(
    "third_party default",
    classifyOwnership("https://news.example/article", brand).ownership,
    "third_party",
  );
  checkEq(
    "unknown when URL malformed",
    classifyOwnership("garbage", brand).ownership,
    "unknown",
  );
}

console.log("\ncomputeShareOfVoice");
{
  const rows: MentionRow[] = [
    {
      brandMentioned: true,
      brandRecommended: true,
      competitorsMentioned: ["openlens"],
      citations: ["https://news.example/a", "https://high-signal.app/b"],
      brandCited: true,
      createdAt: "2026-06-10",
    },
    {
      brandMentioned: false,
      brandRecommended: false,
      competitorsMentioned: ["openlens", "competitorX"],
      citations: ["https://news.example/c"],
      createdAt: "2026-06-11",
    },
  ];
  const sov = computeShareOfVoice(rows, 30);
  checkEq("runs counted", sov.runs, 2);
  checkEq("brandMentionRate", sov.brandMentionRate, 0.5);
  checkEq("brandRecommendationRate", sov.brandRecommendationRate, 0.5);
  checkEq("openlens share", sov.competitorShare["openlens"], 1);
  checkEq(
    "competitorX share",
    sov.competitorShare["competitorX"],
    0.5,
  );
  checkEq("news.example share", sov.citationShare["news.example"], 2 / 3);
}

console.log("\nbuildVisibilityMatrix — collapses to latest per cell");
{
  const rows: MatrixRow[] = [
    {
      prompt: "best obs tool",
      promptKey: "obs",
      platform: "chatgpt",
      brandMentioned: false,
      brandRecommended: false,
      competitorsMentioned: ["a"],
      citations: [],
      runAt: "2026-06-10T10:00:00Z",
    },
    {
      prompt: "best obs tool",
      promptKey: "obs",
      platform: "chatgpt",
      brandMentioned: true,
      brandRecommended: true,
      competitorsMentioned: ["a", "b"],
      citations: ["https://x"],
      runAt: "2026-06-11T10:00:00Z",
    },
    {
      prompt: "best obs tool",
      promptKey: "obs",
      platform: "perplexity",
      brandMentioned: false,
      brandRecommended: false,
      competitorsMentioned: [],
      citations: [],
      runAt: "2026-06-11T09:00:00Z",
    },
  ];
  const cells = buildVisibilityMatrix(rows);
  checkEq("two cells (one per platform)", cells.length, 2);
  const chat = cells.find((c) => c.platform === "chatgpt")!;
  checkEq("chatgpt cell uses latest run", chat.brandMentioned, true);
  checkEq("chatgpt citations counted", chat.citationsCount, 1);
}

console.log("\ncomputeTrends — windowed bucketing");
{
  const NOW = Date.UTC(2026, 5, 12, 0, 0, 0);
  const day = (offset: number) => new Date(NOW - offset * 24 * 3600 * 1000).toISOString();
  const rows: MentionRow[] = [
    { brandMentioned: true, competitorsMentioned: [], citations: ["https://a.com/x"], createdAt: day(1) },
    { brandMentioned: false, competitorsMentioned: [], citations: ["https://b.com/y"], createdAt: day(1) },
    { brandMentioned: true, competitorsMentioned: [], citations: [], createdAt: day(2) },
    // 14 days ago — outside a 7-day window
    { brandMentioned: true, competitorsMentioned: [], citations: [], createdAt: day(14) },
  ];
  const points = computeTrends(rows, 7, NOW);
  checkEq("window drops 14d-old row", points.length, 2);
  const recent = points[points.length - 1]!;
  checkEq(
    "most recent day's mention rate is 0.5",
    recent.mentionRate,
    0.5,
  );
  checkEq("hosts counted distinct", recent.citedHosts, 2);
}

console.log("\nsortAttributes — canonical area order");
{
  const sorted = sortAttributes([
    { area: "policies", status: "weak", evidenceUrls: [], notes: "", taskCount: 1 },
    { area: "positioning", status: "clear", evidenceUrls: [], notes: "", taskCount: 0 },
    { area: "unknown_area", status: "missing", evidenceUrls: [], notes: "", taskCount: 0 },
  ]);
  checkEq("positioning first", sorted[0]!.area, "positioning");
  checkEq("unknown_area last", sorted[2]!.area, "unknown_area");
}

async function finish() {
  console.log("\nvisibilityReportToken — deterministic brand scoping");
  const token = await visibilityReportToken("server-secret", "brand-a");
  checkEq("token is stable", token, await visibilityReportToken("server-secret", "brand-a"));
  checkEq("token is 32 hex characters", /^[a-f0-9]{32}$/.test(token), true);
  checkEq(
    "valid token verifies",
    await verifyVisibilityReportToken("server-secret", "brand-a", token),
    true,
  );
  checkEq(
    "token cannot cross brands",
    await verifyVisibilityReportToken("server-secret", "brand-b", token),
    false,
  );
  checkEq(
    "token cannot cross secrets",
    await verifyVisibilityReportToken("different-secret", "brand-a", token),
    false,
  );

  console.log("\nOpenLens follow-up wiring");
  const mentionsPage = readFileSync(
    new URL("../apps/web/src/app/mentions/page.tsx", import.meta.url),
    "utf8",
  );
  const productsRoute = readFileSync(
    new URL("../workers/api/src/routes/products.ts", import.meta.url),
    "utf8",
  );
  checkEq("configuration copy labels category as Topic", mentionsPage.includes('label="Topic"'), true);
  checkEq("check progress uses prompts", mentionsPage.includes("totalQueries} prompts"), true);
  checkEq("post-check refreshes are independent", productsRoute.includes("Promise.allSettled(["), true);
  checkEq(
    "manual and automatic paths share cited-source helper",
    productsRoute.match(/refreshCitedSourcesForBrand\(/g)?.length,
    3,
  );
  checkEq(
    "report token route is owner-gated",
    productsRoute.includes('post("/mentions/:brandId/report/share-token"'),
    true,
  );

  if (failures > 0) {
    console.error(`\n${failures}/${total} failed`);
    process.exit(1);
  }
  console.log(`\nall ${total} ok`);
}

finish().catch((error) => {
  console.error(error);
  process.exit(1);
});
