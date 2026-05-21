export type LightweightIntent =
  | "complaint"
  | "purchase-intent"
  | "feature-request"
  | "operational-risk"
  | "market-signal"
  | "regional-pressure"
  | "startup-validation"
  | "developer-workflow"
  | "general";

export type LightweightSentiment = "positive" | "negative" | "neutral" | "mixed";
export type LightweightNlpMethod = "rules-v1";

export interface LightweightNlpAnnotation {
  intent: LightweightIntent;
  sentiment: LightweightSentiment;
  urgency: "low" | "medium" | "high";
  method: LightweightNlpMethod;
  model: "none";
  llm: false;
  intentScore: number;
  sentimentScore: number;
  positiveHits: string[];
  negativeHits: string[];
  intentHits: string[];
}

const INTENT_TERMS: Array<{ intent: LightweightIntent; terms: string[] }> = [
  {
    intent: "complaint",
    terms: ["complaint", "problem", "broken", "frustrating", "annoying", "hate", "issue", "bug", "pain", "doesn't work", "not working"],
  },
  {
    intent: "purchase-intent",
    terms: ["buy", "pay", "pricing", "budget", "vendor", "alternative", "recommend", "looking for", "switch", "worth it"],
  },
  {
    intent: "feature-request",
    terms: ["feature", "need", "wish", "missing", "request", "support for", "integration", "would like", "should add"],
  },
  {
    intent: "operational-risk",
    terms: ["cashflow", "payroll", "rent", "inventory", "fulfillment", "refund", "support", "chargeback", "outage", "delay"],
  },
  {
    intent: "market-signal",
    terms: ["stock", "market", "equity", "ipo", "guidance", "forecast", "demand", "capex", "margin", "revenue"],
  },
  {
    intent: "regional-pressure",
    terms: ["traffic", "pollution", "housing", "rent", "permit", "regulation", "tax", "city", "local", "commute"],
  },
  {
    intent: "startup-validation",
    terms: ["startup", "validate", "launch", "users", "waitlist", "distribution", "customer discovery", "mvp", "revenue"],
  },
  {
    intent: "developer-workflow",
    terms: ["github", "deploy", "debug", "ci", "workflow", "observability", "trace", "code review", "developer", "api"],
  },
];

const POSITIVE_TERMS = [
  "good",
  "great",
  "better",
  "love",
  "works",
  "useful",
  "growth",
  "improve",
  "improved",
  "win",
  "wins",
  "surge",
  "strong",
  "profitable",
  "adoption",
];

const NEGATIVE_TERMS = [
  "bad",
  "worse",
  "hate",
  "broken",
  "issue",
  "problem",
  "complaint",
  "decline",
  "delay",
  "risk",
  "lawsuit",
  "outage",
  "expensive",
  "struggling",
  "stagnation",
  "friction",
];

const URGENCY_TERMS = ["urgent", "immediately", "now", "deadline", "blocked", "can't", "cannot", "critical", "risk", "outage", "lawsuit"];

function normalized(text: string) {
  return text.toLowerCase();
}

function hits(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term));
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function annotateLightweightNlp(text: string): LightweightNlpAnnotation {
  const lower = normalized(text);
  const intentScores = INTENT_TERMS.map((rule) => ({
    intent: rule.intent,
    hits: hits(lower, rule.terms),
  })).filter((rule) => rule.hits.length > 0);
  intentScores.sort((a, b) => b.hits.length - a.hits.length);
  const positiveHits = hits(lower, POSITIVE_TERMS);
  const negativeHits = hits(lower, NEGATIVE_TERMS);
  const urgentHits = hits(lower, URGENCY_TERMS);
  const topIntentHits = intentScores[0]?.hits ?? [];
  const sentimentHits = positiveHits.length + negativeHits.length;
  let sentiment: LightweightSentiment = "neutral";
  if (positiveHits.length > 0 && negativeHits.length > 0) sentiment = "mixed";
  else if (positiveHits.length > negativeHits.length) sentiment = "positive";
  else if (negativeHits.length > positiveHits.length) sentiment = "negative";

  return {
    intent: intentScores[0]?.intent ?? "general",
    sentiment,
    urgency: urgentHits.length >= 2 ? "high" : urgentHits.length === 1 ? "medium" : "low",
    method: "rules-v1",
    model: "none",
    llm: false,
    intentScore: boundedScore(topIntentHits.length / 3),
    sentimentScore: boundedScore(Math.abs(positiveHits.length - negativeHits.length) / Math.max(1, sentimentHits)),
    positiveHits,
    negativeHits,
    intentHits: topIntentHits,
  };
}
