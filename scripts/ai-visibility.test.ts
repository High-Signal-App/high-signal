#!/usr/bin/env tsx
/**
 * Unit tests for the AI Visibility (GEO) upgrade: multi-model resolution,
 * LLM-judge parsing, and the packaged visibility report analytics.
 *
 * Run: `pnpm ai-visibility:test`
 */

import {
  resolvePlatforms,
  resolvedPlatformLabels,
  buildMentionJudgePrompt,
  extractJsonObject,
  parseMentionVerdict,
  computeShareOfVoice,
  computeVisibilityScore,
  computePersonaVisibility,
  computeCitationGaps,
  perPlatformMentionRate,
  composeVisibilityReport,
  buildVisibilityRecommendations,
  computeTrends,
  type MentionRow,
} from "@high-signal/shared";

let failures = 0;
let total = 0;
function check(label: string, cond: boolean) {
  total++;
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

// ─── resolvePlatforms (multi-model fan-out) ─────────────────────────────────
console.log("resolvePlatforms");
{
  const multi = resolvePlatforms({
    OPENAI_API_KEY: "k1",
    PERPLEXITY_API_KEY: "k2",
    GEMINI_API_KEY: "k3",
    ANTHROPIC_API_KEY: "k4",
  });
  const labels = resolvedPlatformLabels(multi);
  check("all four provider keys → four platforms", multi.length === 4);
  check("labels include chatgpt/perplexity/gemini/claude", ["chatgpt", "perplexity", "gemini", "claude"].every((p) => labels.includes(p as never)));
  check("perplexity is marked grounded", multi.find((p) => p.platform === "perplexity")?.grounded === true);
  check("chatgpt is not grounded", multi.find((p) => p.platform === "chatgpt")?.grounded === false);

  const fallback = resolvePlatforms({ HIGH_SIGNAL_AI_API_KEY: "k" });
  check("no provider keys → single custom fallback", fallback.length === 1 && fallback[0]!.platform === "custom");

  const none = resolvePlatforms({});
  check("no keys at all → empty (fail closed)", none.length === 0);

  const withBrand = resolvePlatforms(
    { OPENAI_API_KEY: "k" },
    { aiEndpointUrl: "https://my.endpoint/v1", aiModel: "my-model" },
  );
  check("brand endpoint adds a custom column on top of providers", withBrand.some((p) => p.platform === "custom") && withBrand.some((p) => p.platform === "chatgpt"));
}

// ─── LLM-judge parsing ──────────────────────────────────────────────────────
console.log("\nmention-judge");
{
  const prompt = buildMentionJudgePrompt(
    { brandName: "Acme", brandAliases: ["AcmeAI"], brandUrl: "https://acme.com", competitors: [{ name: "Globex" }] },
    "Acme is the best choice; it beats Globex.",
  );
  check("judge prompt names the brand and competitor", prompt.includes("Acme") && prompt.includes("Globex"));
  check("judge prompt demands JSON-only", /Return ONLY a JSON object/i.test(prompt));

  check("extractJsonObject strips a code fence", extractJsonObject('```json\n{"a":1}\n```') === '{"a":1}');
  check("extractJsonObject finds a balanced object amid prose", extractJsonObject('Here you go: {"x": {"y": 2}} done') === '{"x": {"y": 2}}');
  check("extractJsonObject returns null when no object", extractJsonObject("no json here") === null);

  const verdict = parseMentionVerdict(
    JSON.stringify({
      brandMentioned: true,
      brandRecommended: true,
      brandSentiment: "positive",
      brandPosition: 1,
      competitorsMentioned: [{ name: "Globex", mentioned: true, position: 2 }],
      citations: ["https://acme.com/x", "https://acme.com/x"],
      brandCited: true,
      reasoning: "Acme is endorsed first.",
    }),
    [{ name: "Globex" }, { name: "Initech" }],
  );
  check("verdict parses core fields", verdict?.brandMentioned === true && verdict?.brandRecommended === true && verdict?.brandSentiment === "positive");
  check("verdict dedupes citations", verdict?.citations.length === 1);
  check("verdict backfills omitted competitor (Initech) as not-mentioned", verdict?.competitorsMentioned.some((c) => c.name === "Initech" && !c.mentioned) === true);
  check("malformed judge output → null (caller falls back)", parseMentionVerdict("totally not json", []) === null);
  check(
    "not-mentioned brand forces null sentiment",
    parseMentionVerdict(JSON.stringify({ brandMentioned: false, brandSentiment: "positive" }), [])?.brandSentiment === null,
  );
}

// ─── Visibility analytics ───────────────────────────────────────────────────
console.log("\nvisibility analytics");
{
  const rows: MentionRow[] = [
    { brandMentioned: true, brandRecommended: true, competitorsMentioned: ["Globex"], citations: ["https://g2.com/acme", "https://competitor.com/x"], brandCited: false, platform: "chatgpt", persona: "developer", createdAt: "2026-07-01T00:00:00Z" },
    { brandMentioned: true, brandRecommended: false, competitorsMentioned: ["Globex", "Globex"], citations: ["https://g2.com/acme"], brandCited: true, platform: "perplexity", persona: "developer", createdAt: "2026-07-02T00:00:00Z" },
    { brandMentioned: false, brandRecommended: false, competitorsMentioned: ["Globex"], citations: [], brandCited: false, platform: "gemini", persona: "procurement", createdAt: "2026-07-03T00:00:00Z" },
  ];
  const brand = { brandUrl: "https://acme.com", competitorUrls: [{ id: "Globex", url: "https://competitor.com" }] };

  const perPlatform = perPlatformMentionRate(rows);
  check("per-platform mention rate: gemini 0, chatgpt 1", perPlatform["gemini"] === 0 && perPlatform["chatgpt"] === 1);

  const sov = computeShareOfVoice(rows, 30);
  const score = computeVisibilityScore(sov, rows);
  check("visibility score in 0..100", score.score >= 0 && score.score <= 100);
  check("consistency = 2 of 3 platforms mention brand", Math.abs(score.components.consistency - 2 / 3) < 1e-9);
  check("grade assigned", ["A", "B", "C", "D", "F"].includes(score.grade));

  const personas = computePersonaVisibility(rows);
  check("persona breakdown covers developer + procurement", personas.length === 2);
  check("weakest persona (procurement, 0%) sorted first", personas[0]!.persona === "procurement");

  const gaps = computeCitationGaps(rows, brand);
  check("citation gaps rank g2.com top (cited twice)", gaps[0]?.host === "g2.com" && gaps[0]?.citations === 2);
  check("competitor host classified as competitor", gaps.some((g) => g.host === "competitor.com" && g.ownership === "competitor"));

  const trend = computeTrends(rows, 30, Date.parse("2026-07-04T00:00:00Z"));
  const report = composeVisibilityReport({
    brandName: "Acme",
    windowDays: 30,
    score,
    shareOfVoice: sov,
    perPersona: personas,
    citationGaps: gaps,
    matrix: [],
    trend,
    platforms: ["chatgpt", "perplexity", "gemini"],
  });
  check("report carries score + recommendations", report.score.score === score.score && report.recommendations.length > 0);
  check("report flags cross-engine gap (absent on gemini)", report.recommendations.some((r) => r.area === "consistency"));
}

// ─── Recommendations logic ──────────────────────────────────────────────────
console.log("\nrecommendations");
{
  const lowVis = buildVisibilityRecommendations({
    score: { score: 10, grade: "F", components: { mention: 0.1, recommendation: 0, citation: 0, consistency: 0.25 }, platformsCovered: 1, platformsTotal: 4 },
    shareOfVoice: { windowDays: 30, runs: 10, brandMentionRate: 0.1, brandRecommendationRate: 0, brandCitationRate: 0, competitorShare: { Globex: 0.8 }, citationShare: {} },
    perPersona: [],
    citationGaps: [{ host: "g2.com", ownership: "third_party", citations: 5 }],
  });
  check("low visibility → high-priority presence rec first", lowVis[0]!.priority === "high");
  check("competitor out-appearing flagged", lowVis.some((r) => r.title.includes("out-appears")));

  const strong = buildVisibilityRecommendations({
    score: { score: 90, grade: "A", components: { mention: 0.9, recommendation: 0.8, citation: 0.6, consistency: 1 }, platformsCovered: 4, platformsTotal: 4 },
    shareOfVoice: { windowDays: 30, runs: 10, brandMentionRate: 0.9, brandRecommendationRate: 0.8, brandCitationRate: 0.6, competitorShare: { Globex: 0.2 }, citationShare: {} },
    perPersona: [],
    citationGaps: [],
  });
  check("strong visibility → single hold-the-line rec", strong.length === 1 && strong[0]!.title.includes("hold the line"));
}

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
