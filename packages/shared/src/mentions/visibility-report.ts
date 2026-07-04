// The packaged deliverable — an "AI Visibility Report" — that turns the raw
// OpenLens analytics into the same artifact a GEO service (Value AI Labs,
// Peekaboo) sells: a headline score, cross-model + per-persona breakdown,
// share-of-voice vs competitors, the sources AI trusts instead of you, and a
// prioritized action list. Pure + deterministic so it's unit-testable and can
// render identically on the server, in an email, or a PDF export.

import type {
  CitationGap,
  MatrixCell,
  PersonaVisibility,
  ShareOfVoice,
  TrendPoint,
  VisibilityScore,
} from "./openlens-visibility";

export interface VisibilityRecommendation {
  priority: "high" | "medium" | "low";
  area: "presence" | "endorsement" | "citations" | "consistency" | "persona";
  title: string;
  detail: string;
}

export interface AiVisibilityReport {
  brandName: string;
  windowDays: number;
  generatedForRuns: number;
  score: VisibilityScore;
  platforms: string[];
  shareOfVoice: ShareOfVoice;
  perPersona: PersonaVisibility[];
  citationGaps: CitationGap[];
  matrix: MatrixCell[];
  trend: { direction: "up" | "down" | "flat"; deltaMentionRate: number };
  recommendations: VisibilityRecommendation[];
}

export interface ComposeReportInput {
  brandName: string;
  windowDays: number;
  score: VisibilityScore;
  shareOfVoice: ShareOfVoice;
  perPersona: PersonaVisibility[];
  citationGaps: CitationGap[];
  matrix: MatrixCell[];
  trend: TrendPoint[];
  platforms: string[];
}

function trendDirection(points: TrendPoint[]): { direction: "up" | "down" | "flat"; deltaMentionRate: number } {
  if (points.length < 2) return { direction: "flat", deltaMentionRate: 0 };
  const delta = points[points.length - 1]!.mentionRate - points[0]!.mentionRate;
  const direction = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  return { direction, deltaMentionRate: delta };
}

export function buildVisibilityRecommendations(input: {
  score: VisibilityScore;
  shareOfVoice: ShareOfVoice;
  perPersona: PersonaVisibility[];
  citationGaps: CitationGap[];
}): VisibilityRecommendation[] {
  const recs: VisibilityRecommendation[] = [];
  const { components } = input.score;

  if (components.mention < 0.5) {
    recs.push({
      priority: "high",
      area: "presence",
      title: "AI rarely names you",
      detail: `Brand appears in only ${pct(components.mention)} of answers. Buyers researching your category mostly don't see you — the base GEO problem to fix first.`,
    });
  }
  if (components.recommendation < 0.3 && components.mention >= 0.5) {
    recs.push({
      priority: "high",
      area: "endorsement",
      title: "Mentioned but not recommended",
      detail: `You're named ${pct(components.mention)} of the time but actively recommended only ${pct(components.recommendation)}. AI lists you without endorsing — a positioning/proof gap.`,
    });
  }
  // Competitors out-sharing you.
  const topCompetitor = Object.entries(input.shareOfVoice.competitorShare).sort((a, b) => b[1] - a[1])[0];
  if (topCompetitor && topCompetitor[1] > input.shareOfVoice.brandMentionRate) {
    recs.push({
      priority: "high",
      area: "presence",
      title: `A competitor out-appears you`,
      detail: `"${topCompetitor[0]}" shows up in ${pct(topCompetitor[1])} of answers vs your ${pct(input.shareOfVoice.brandMentionRate)}. They're winning the AI narrative in your category.`,
    });
  }
  // Citation gaps.
  const topGaps = input.citationGaps.slice(0, 3).map((g) => g.host);
  if (topGaps.length) {
    recs.push({
      priority: components.citation < 0.2 ? "high" : "medium",
      area: "citations",
      title: "Get represented on the sources AI trusts",
      detail: `AI most often cites ${topGaps.join(", ")} — not your site. Earning presence on those sources is how you enter the answer, not just the index.`,
    });
  }
  // Cross-model consistency.
  if (input.score.platformsTotal > 1 && components.consistency < 1) {
    const missing = input.score.platformsTotal - input.score.platformsCovered;
    recs.push({
      priority: "medium",
      area: "consistency",
      title: "Invisible on some engines",
      detail: `You're absent from ${missing} of ${input.score.platformsTotal} AI engines checked. Coverage varies by model — fix the weakest engine's sources.`,
    });
  }
  // Weakest persona.
  const weak = input.perPersona.find((p) => p.persona !== "general" && p.mentionRate < 0.4);
  if (weak) {
    recs.push({
      priority: "medium",
      area: "persona",
      title: `Weak with the "${weak.persona}" persona`,
      detail: `For "${weak.persona}"-framed questions the brand surfaces only ${pct(weak.mentionRate)} of the time — content isn't reaching that buyer's queries.`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      priority: "low",
      area: "presence",
      title: "Strong AI visibility — hold the line",
      detail: "Presence, endorsement, and citation rates are healthy across engines. Keep source coverage fresh and re-check as models update.",
    });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}

export function composeVisibilityReport(input: ComposeReportInput): AiVisibilityReport {
  return {
    brandName: input.brandName,
    windowDays: input.windowDays,
    generatedForRuns: input.shareOfVoice.runs,
    score: input.score,
    platforms: input.platforms,
    shareOfVoice: input.shareOfVoice,
    perPersona: input.perPersona,
    citationGaps: input.citationGaps,
    matrix: input.matrix,
    trend: trendDirection(input.trend),
    recommendations: buildVisibilityRecommendations({
      score: input.score,
      shareOfVoice: input.shareOfVoice,
      perPersona: input.perPersona,
      citationGaps: input.citationGaps,
    }),
  };
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
