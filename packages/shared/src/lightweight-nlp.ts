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
export type LightweightAudience =
  | "agent-operators"
  | "consumers"
  | "developers"
  | "general"
  | "market-operators"
  | "regional-public"
  | "small-business-owners"
  | "startup-builders";
export type LightweightRequirementType =
  | "add-integration"
  | "automate-workflow"
  | "fix-bug"
  | "improve-pricing"
  | "local-ops"
  | "monitor-market"
  | "research-only"
  | "validate-demand";
export type LightweightDecisionStage =
  | "buyer-evaluation"
  | "general-awareness"
  | "market-monitoring"
  | "pain-discovery"
  | "solution-request"
  | "world-change-watch";
export type LightweightQualityGateStatus = "strong" | "review" | "weak";
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
  audience: LightweightAudience;
  requirementType: LightweightRequirementType;
  decisionStage: LightweightDecisionStage;
  opportunityScore: number;
  qualityGate: {
    status: LightweightQualityGateStatus;
    score: number;
    reasons: string[];
  };
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

const INTEGRATION_TERMS = ["integration", "support for", "quickbooks", "shopify", "stripe", "api", "webhook"];
const AUTOMATION_TERMS = ["automate", "workflow", "dashboard", "template", "calculator", "checklist", "report"];
const PRICING_TERMS = ["pricing", "budget", "pay", "expensive", "worth it", "subscription", "trial"];
const BUG_TERMS = ["broken", "bug", "doesn't work", "not working", "outage", "blocked", "issue"];

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

function audienceFor(domains: LightweightDomain[]): LightweightAudience {
  if (domains.includes("agent-evaluation")) return "agent-operators";
  if (domains.includes("developer")) return "developers";
  if (domains.includes("small-business") || domains.includes("operations")) return "small-business-owners";
  if (domains.includes("startup")) return "startup-builders";
  if (domains.includes("regional")) return "regional-public";
  if (domains.includes("market")) return "market-operators";
  if (domains.includes("consumer")) return "consumers";
  return "general";
}

function requirementTypeFor(input: {
  intent: LightweightIntent;
  domains: LightweightDomain[];
  integrationHits: string[];
  automationHits: string[];
  pricingHits: string[];
  bugHits: string[];
}): LightweightRequirementType {
  if (input.intent === "market-signal" || input.domains.includes("market")) return "monitor-market";
  if (input.intent === "regional-pressure" || input.domains.includes("regional")) return "local-ops";
  if (input.intent === "startup-validation" || input.domains.includes("startup")) return "validate-demand";
  if (input.integrationHits.length > 0) return "add-integration";
  if (input.bugHits.length > 0) return "fix-bug";
  if (input.automationHits.length > 0) return "automate-workflow";
  if (input.intent === "purchase-intent" || input.pricingHits.length > 0) return "improve-pricing";
  return "research-only";
}

function decisionStageFor(input: {
  intent: LightweightIntent;
  signalLayer: LightweightSignalLayer;
  painScore: number;
}): LightweightDecisionStage {
  if (input.intent === "purchase-intent") return "buyer-evaluation";
  if (input.intent === "feature-request") return "solution-request";
  if (input.signalLayer === "market-watch") return "market-monitoring";
  if (input.signalLayer === "world-change") return "world-change-watch";
  if (input.painScore > 0 || input.intent === "complaint" || input.intent === "operational-risk") {
    return "pain-discovery";
  }
  return "general-awareness";
}

function qualityGateFor(input: {
  painScore: number;
  buyerIntentScore: number;
  actionabilityScore: number;
  urgency: "low" | "medium" | "high";
  domains: LightweightDomain[];
  productRequirement: boolean;
}) {
  const domainBonus = input.domains.length > 0 ? 0.08 : 0;
  const urgencyBonus = input.urgency === "high" ? 0.12 : input.urgency === "medium" ? 0.06 : 0;
  const opportunityScore = boundedScore(
    input.painScore * 0.3 + input.buyerIntentScore * 0.25 + input.actionabilityScore * 0.3 + domainBonus + urgencyBonus,
  );
  const reasons: string[] = [];
  if (input.productRequirement) reasons.push("product-requirement");
  if (input.painScore >= 0.34) reasons.push("pain");
  if (input.buyerIntentScore >= 0.25) reasons.push("buyer-intent");
  if (input.actionabilityScore >= 0.34) reasons.push("actionable");
  if (input.domains.length > 0) reasons.push("domain-tagged");
  if (input.urgency !== "low") reasons.push(`${input.urgency}-urgency`);
  if (!reasons.length) reasons.push("weak-explicit-signal");
  return {
    opportunityScore,
    qualityGate: {
      status:
        opportunityScore >= 0.7 && input.productRequirement
          ? "strong"
          : opportunityScore >= 0.38 || input.productRequirement
            ? "review"
            : "weak",
      score: Math.round(opportunityScore * 100),
      reasons,
    },
  } as const;
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
  const integrationHits = hits(lower, INTEGRATION_TERMS);
  const automationHits = hits(lower, AUTOMATION_TERMS);
  const pricingHits = hits(lower, PRICING_TERMS);
  const bugHits = hits(lower, BUG_TERMS);
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
  const domainValues = unique(domains.map((rule) => rule.domain)).slice(0, 4);
  const urgency = urgentHits.length >= 2 ? "high" : urgentHits.length === 1 ? "medium" : "low";
  const productRequirement = painScore >= 0.34 || buyerIntentScore >= 0.25 || actionabilityScore >= 0.34;
  const { opportunityScore, qualityGate } = qualityGateFor({
    painScore,
    buyerIntentScore,
    actionabilityScore,
    urgency,
    domains: domainValues,
    productRequirement,
  });
  const requirementType = requirementTypeFor({
    intent,
    domains: domainValues,
    integrationHits,
    automationHits,
    pricingHits,
    bugHits,
  });
  let sentiment: LightweightSentiment = "neutral";
  if (positiveHits.length > 0 && negativeHits.length > 0) sentiment = "mixed";
  else if (positiveHits.length > negativeHits.length) sentiment = "positive";
  else if (negativeHits.length > positiveHits.length) sentiment = "negative";

  return {
    intent,
    sentiment,
    urgency,
    method: "semantic-rules-v2",
    model: "none",
    llm: false,
    intentScore: boundedScore(topIntentHits.length / 3),
    sentimentScore: boundedScore(Math.abs(positiveHits.length - negativeHits.length) / Math.max(1, sentimentHits)),
    positiveHits,
    negativeHits,
    intentHits: topIntentHits,
    signalLayer,
    domains: domainValues,
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
    productRequirement,
    audience: audienceFor(domainValues),
    requirementType,
    decisionStage: decisionStageFor({ intent, signalLayer, painScore }),
    opportunityScore,
    qualityGate,
  };
}
