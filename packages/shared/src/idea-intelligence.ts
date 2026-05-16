export type IdeaFlowSource = "market" | "community" | "mention" | "news" | "resource";
export type IdeaFlowPolarity = "supporting" | "contradicting" | "watching";
export type IdeaVerdict = "pursue" | "test" | "watch" | "avoid";

export interface IdeaFlowEvidence {
  id: string;
  source: IdeaFlowSource;
  title: string;
  summary: string;
  href: string;
  observedAt: string;
  confidence: "low" | "medium" | "high";
  polarity?: IdeaFlowPolarity;
}

export interface IdeaAnalysis {
  idea: string;
  verdict: IdeaVerdict;
  fitScore: number;
  demandScore: number;
  timingScore: number;
  evidenceScore: number;
  riskScore: number;
  thesis: string;
  supporting: IdeaFlowEvidence[];
  contradicting: IdeaFlowEvidence[];
  watch: IdeaFlowEvidence[];
  nextActions: string[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "based",
  "be",
  "build",
  "by",
  "for",
  "from",
  "i",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "product",
  "that",
  "the",
  "this",
  "to",
  "tool",
  "with",
]);

const DEMAND_WORDS = [
  "pain",
  "need",
  "want",
  "asking",
  "demand",
  "workflow",
  "manual",
  "monitor",
  "source",
  "evidence",
  "visibility",
  "buyer",
];

const TIMING_WORDS = [
  "launch",
  "growth",
  "ramp",
  "shift",
  "new",
  "increase",
  "expands",
  "budget",
  "regulation",
  "deadline",
  "migration",
];

const RISK_WORDS = [
  "crowded",
  "generic",
  "incumbent",
  "decline",
  "delay",
  "cut",
  "restriction",
  "commoditized",
  "unclear",
];

function tokens(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
    ),
  );
}

function containsAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function overlapScore(ideaTokens: string[], evidence: IdeaFlowEvidence) {
  const haystack = `${evidence.title} ${evidence.summary}`.toLowerCase();
  const hits = ideaTokens.filter((token) => haystack.includes(token)).length;
  return hits / Math.max(ideaTokens.length, 1);
}

function classifyEvidence(ideaTokens: string[], evidence: IdeaFlowEvidence): IdeaFlowEvidence {
  if (evidence.polarity) return evidence;
  const text = `${evidence.title} ${evidence.summary}`;
  const overlap = overlapScore(ideaTokens, evidence);
  if (containsAny(text, RISK_WORDS) && overlap >= 0.08) {
    return { ...evidence, polarity: "contradicting" };
  }
  if ((containsAny(text, DEMAND_WORDS) || containsAny(text, TIMING_WORDS)) && overlap >= 0.08) {
    return { ...evidence, polarity: "supporting" };
  }
  return { ...evidence, polarity: overlap >= 0.08 ? "watching" : "watching" };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function verdict(fitScore: number, evidenceScore: number, riskScore: number): IdeaVerdict {
  if (riskScore >= 70 && evidenceScore < 45) return "avoid";
  if (fitScore >= 70 && evidenceScore >= 50) return "pursue";
  if (fitScore >= 45) return "test";
  return "watch";
}

export function analyzeIdeaAgainstFlow(
  idea: string,
  evidence: IdeaFlowEvidence[],
): IdeaAnalysis {
  const cleanIdea = idea.trim();
  const ideaTokens = tokens(cleanIdea);
  const classified = evidence
    .map((item) => classifyEvidence(ideaTokens, item))
    .map((item) => ({ item, overlap: overlapScore(ideaTokens, item) }))
    .filter(({ overlap }) => overlap >= 0.04)
    .sort((a, b) => b.overlap - a.overlap)
    .map(({ item }) => item);

  const supporting = classified.filter((item) => item.polarity === "supporting").slice(0, 5);
  const contradicting = classified.filter((item) => item.polarity === "contradicting").slice(0, 4);
  const watch = classified.filter((item) => item.polarity === "watching").slice(0, 5);
  const joinedSupport = supporting.map((item) => `${item.title} ${item.summary}`).join(" ");
  const joinedAll = classified.map((item) => `${item.title} ${item.summary}`).join(" ");
  const demandScore = clampScore(20 + supporting.length * 16 + (containsAny(joinedSupport, DEMAND_WORDS) ? 18 : 0));
  const timingScore = clampScore(20 + classified.length * 8 + (containsAny(joinedAll, TIMING_WORDS) ? 24 : 0));
  const evidenceScore = clampScore(classified.length * 14 + supporting.length * 10);
  const riskScore = clampScore(contradicting.length * 22 + (containsAny(joinedAll, RISK_WORDS) ? 22 : 0));
  const fitScore = clampScore(demandScore * 0.36 + timingScore * 0.28 + evidenceScore * 0.26 - riskScore * 0.18);
  const finalVerdict = verdict(fitScore, evidenceScore, riskScore);

  return {
    idea: cleanIdea,
    verdict: finalVerdict,
    fitScore,
    demandScore,
    timingScore,
    evidenceScore,
    riskScore,
    thesis:
      finalVerdict === "pursue"
        ? "External flow supports a focused build. Narrow the wedge and collect conversion evidence."
        : finalVerdict === "test"
          ? "There is enough signal to run a small validation loop, but not enough to scale the idea yet."
          : finalVerdict === "avoid"
            ? "The current flow is weak or risk-heavy. Reframe before investing serious build time."
            : "Keep watching. The idea needs clearer demand, timing, or source-backed urgency.",
    supporting,
    contradicting,
    watch,
    nextActions: [
      "Write the one-sentence buyer, painful workflow, and promised outcome.",
      "Collect five source links that show this pain or timing shift without relying on your own opinion.",
      "Define the smallest artifact that proves pull: waitlist, manual report, concierge workflow, or paid pilot.",
      "Add the idea to the watchlist only if future signals can change the decision.",
    ],
  };
}
