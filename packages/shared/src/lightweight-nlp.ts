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
export type LightweightNlpMethod = "rules-v1" | "semantic-rules-v2";
export type LightweightSignalLayer = "world-change" | "app-complaint" | "market-watch" | "general";
export type LightweightDomain =
  | "agent-evaluation"
  | "consumer"
  | "developer"
  | "market"
  | "operations"
  | "regional"
  | "small-business"
  | "startup";

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
  signalLayer: LightweightSignalLayer;
  domains: LightweightDomain[];
  productSignals: string[];
  painScore: number;
  buyerIntentScore: number;
  actionabilityScore: number;
  productRequirement: boolean;
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
  "delays",
  "hurting",
  "risk",
  "lawsuit",
  "outage",
  "expensive",
  "struggling",
  "stagnation",
  "friction",
];

const URGENCY_TERMS = ["urgent", "immediately", "now", "deadline", "blocked", "can't", "cannot", "critical", "risk", "outage", "lawsuit"];

const WORLD_CHANGE_TERMS = [
  "announced",
  "launch",
  "regulation",
  "policy",
  "law",
  "tariff",
  "funding",
  "acquisition",
  "shutdown",
  "layoffs",
  "migration",
  "mandate",
];

const PAIN_TERMS = [
  "problem",
  "broken",
  "frustrating",
  "annoying",
  "hate",
  "issue",
  "bug",
  "pain",
  "manual",
  "workaround",
  "expensive",
  "hurting",
  "blocked",
  "struggling",
];

const BUYER_INTENT_TERMS = [
  "buy",
  "pay",
  "pricing",
  "budget",
  "vendor",
  "alternative",
  "recommend",
  "looking for",
  "switch",
  "worth it",
  "trial",
  "subscription",
];

const ACTIONABILITY_TERMS = [
  "need",
  "missing",
  "should",
  "request",
  "support for",
  "integration",
  "automate",
  "dashboard",
  "template",
  "calculator",
  "api",
  "workflow",
  "checklist",
];

const DOMAIN_TERMS: Array<{ domain: LightweightDomain; terms: string[] }> = [
  {
    domain: "agent-evaluation",
    terms: ["agent", "llm", "ai search", "citation", "provenance", "retrieval", "mcp", "evaluation", "recommendation"],
  },
  {
    domain: "consumer",
    terms: ["consumer", "budget", "affordability", "jobs", "salary", "rent", "housing", "household"],
  },
  {
    domain: "developer",
    terms: ["github", "deploy", "debug", "ci", "code review", "developer", "api", "trace", "observability"],
  },
  {
    domain: "market",
    terms: ["stock", "market", "ipo", "guidance", "forecast", "capex", "margin", "revenue", "earnings"],
  },
  {
    domain: "operations",
    terms: ["cashflow", "payroll", "inventory", "fulfillment", "refund", "support", "chargeback", "outage"],
  },
  {
    domain: "regional",
    terms: ["traffic", "pollution", "housing", "rent", "permit", "regulation", "tax", "city", "local", "commute"],
  },
  {
    domain: "small-business",
    terms: ["shopify", "etsy", "small business", "merchant", "seller", "freelance", "invoice", "checkout"],
  },
  {
    domain: "startup",
    terms: ["startup", "validate", "launch", "waitlist", "distribution", "customer discovery", "mvp", "founder"],
  },
];

function normalized(text: string) {
  return text.toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text: string, term: string) {
  if (/\s|['-]/.test(term)) return text.includes(term);
  return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text);
}

function hits(text: string, terms: string[]) {
  return terms.filter((term) => hasTerm(text, term));
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function signalLayerFor(input: {
  intent: LightweightIntent;
  marketHits: string[];
  worldHits: string[];
  painHits: string[];
  actionabilityHits: string[];
}): LightweightSignalLayer {
  if (input.intent === "market-signal" || input.marketHits.length >= 2) return "market-watch";
  if (input.worldHits.length >= 2 && input.painHits.length === 0) return "world-change";
  if (input.intent !== "general" || input.painHits.length > 0 || input.actionabilityHits.length > 0) {
    return "app-complaint";
  }
  return "general";
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
  const worldHits = hits(lower, WORLD_CHANGE_TERMS);
  const painHits = hits(lower, PAIN_TERMS);
  const buyerIntentHits = hits(lower, BUYER_INTENT_TERMS);
  const actionabilityHits = hits(lower, ACTIONABILITY_TERMS);
  const marketHits = hits(lower, DOMAIN_TERMS.find((item) => item.domain === "market")?.terms ?? []);
  const domains = DOMAIN_TERMS.map((rule) => ({
    domain: rule.domain,
    hits: hits(lower, rule.terms),
  })).filter((rule) => rule.hits.length > 0);
  domains.sort((a, b) => b.hits.length - a.hits.length || a.domain.localeCompare(b.domain));
  const topIntentHits = intentScores[0]?.hits ?? [];
  const sentimentHits = positiveHits.length + negativeHits.length;
  const intent = intentScores[0]?.intent ?? "general";
  const painScore = boundedScore((painHits.length + negativeHits.length) / 6);
  const buyerIntentScore = boundedScore(buyerIntentHits.length / 4);
  const actionabilityScore = boundedScore((actionabilityHits.length + topIntentHits.length) / 6);
  const signalLayer = signalLayerFor({
    intent,
    marketHits,
    worldHits,
    painHits,
    actionabilityHits,
  });
  let sentiment: LightweightSentiment = "neutral";
  if (positiveHits.length > 0 && negativeHits.length > 0) sentiment = "mixed";
  else if (positiveHits.length > negativeHits.length) sentiment = "positive";
  else if (negativeHits.length > positiveHits.length) sentiment = "negative";

  return {
    intent,
    sentiment,
    urgency: urgentHits.length >= 2 ? "high" : urgentHits.length === 1 ? "medium" : "low",
    method: "semantic-rules-v2",
    model: "none",
    llm: false,
    intentScore: boundedScore(topIntentHits.length / 3),
    sentimentScore: boundedScore(Math.abs(positiveHits.length - negativeHits.length) / Math.max(1, sentimentHits)),
    positiveHits,
    negativeHits,
    intentHits: topIntentHits,
    signalLayer,
    domains: unique(domains.map((rule) => rule.domain)).slice(0, 4),
    productSignals: unique([
      ...topIntentHits,
      ...painHits,
      ...buyerIntentHits,
      ...actionabilityHits,
      ...worldHits,
    ]).slice(0, 10),
    painScore,
    buyerIntentScore,
    actionabilityScore,
    productRequirement: painScore >= 0.34 || buyerIntentScore >= 0.25 || actionabilityScore >= 0.34,
  };
}
