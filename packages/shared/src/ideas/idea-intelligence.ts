import type { CommunityDigestSnapshot } from "../core/product-contracts";

export type IdeaFlowSource = "market" | "community" | "mention" | "news" | "resource";
export type IdeaFlowPolarity = "supporting" | "contradicting" | "watching";
export type IdeaVerdict = "pursue" | "test" | "watch" | "avoid";
export type IdeaEvidenceGenericRisk = "low" | "medium" | "high";
export type ProductSignalLayer = "world-change" | "app-complaint" | "market-watch";

export interface IdeaEvidenceQuality {
  sourceCount: number;
  repeatedSignalCount: number;
  genericRisk: IdeaEvidenceGenericRisk;
  noiseFlags: string[];
}

export interface IdeaFlowEvidence {
  id: string;
  source: IdeaFlowSource;
  title: string;
  summary: string;
  href: string;
  canonicalHref?: string;
  duplicateCount?: number;
  observedAt: string;
  confidence: "low" | "medium" | "high";
  polarity?: IdeaFlowPolarity;
  quality?: IdeaEvidenceQuality;
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

export type ProductOpportunityHorizon = "now" | "next" | "watch";

export interface ProductOpportunity {
  id: string;
  title: string;
  signalLayer: ProductSignalLayer;
  worldChange: string;
  productToBuild: string;
  targetUser: string;
  whyNow: string;
  complaintPattern: string;
  confidence: "low" | "medium" | "high";
  horizon: ProductOpportunityHorizon;
  evidence: IdeaFlowEvidence[];
  sourceDiversity: number;
  nextStep: string;
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

const OPPORTUNITY_THEMES = [
  {
    id: "agent-evaluation",
    title: "Agent-readiness audit layer",
    signalLayer: "world-change" as const,
    terms: ["agent", "agents", "ai visibility", "citation", "recommend", "evidence", "provenance"],
    worldChange:
      "Buyers increasingly ask assistants and agents to compare products before they talk to a vendor.",
    productToBuild:
      "A product audit that shows whether a brand is agent-readable, recommendable, and backed by citeable evidence.",
    targetUser: "founders, marketers, and operators selling software or services",
    complaintPattern: "Teams do not know why AI answers omit them, misdescribe them, or recommend competitors.",
    nextStep: "Run audits for five owned products and turn every missing proof area into a concrete page/task.",
  },
  {
    id: "workflow-observability",
    title: "Workflow observability for AI apps",
    signalLayer: "app-complaint" as const,
    terms: ["workflow", "monitor", "observability", "provenance", "source", "routing", "cost", "repeatable"],
    worldChange:
      "AI usage is moving from experiments into repeatable workflows where failure, cost, and provenance matter.",
    productToBuild:
      "A lightweight monitoring layer for app teams to see inputs, outputs, costs, source links, and repeated failures.",
    targetUser: "builders shipping AI features inside real products",
    complaintPattern: "Common complaints cluster around opaque failures, runaway costs, brittle prompts, and no audit trail.",
    nextStep: "Collect app-builder complaints from communities and ship a manual weekly teardown before building tooling.",
  },
  {
    id: "complaint-to-spec",
    title: "Complaint-to-spec miner",
    signalLayer: "app-complaint" as const,
    terms: ["complaint", "pain", "need", "manual", "asking", "want", "bug", "missing", "friction"],
    worldChange:
      "Small app requirements are appearing first as repeated complaints in communities, reviews, and support threads.",
    productToBuild:
      "A requirements miner that clusters repeated complaints into build specs, edge cases, and validation tasks.",
    targetUser: "solo builders and product teams deciding what small tools or features to build next",
    complaintPattern: "Users repeatedly describe the same missing workflow in different words before a category is obvious.",
    nextStep: "Track two communities for one week and only promote clusters with repeated pain plus a clear buyer/user.",
  },
  {
    id: "local-control",
    title: "Local-first control surface",
    signalLayer: "world-change" as const,
    terms: ["local", "privacy", "self-hosted", "control", "open", "cost", "predictable", "offline"],
    worldChange:
      "Teams and technical users are pushing back against opaque cloud AI costs, privacy risk, and lock-in.",
    productToBuild:
      "A local-first app control surface for private workflows, predictable spend, and exportable state.",
    targetUser: "technical operators, self-hosters, and privacy-sensitive teams",
    complaintPattern: "Users want control, transparency, and predictable cost before adopting AI-heavy workflows.",
    nextStep: "Validate whether the control need is strong enough for paid usage or only a self-hosted feature.",
  },
  {
    id: "market-regime-watch",
    title: "Market-regime product radar",
    signalLayer: "market-watch" as const,
    terms: [
      "stock",
      "stocks",
      "market",
      "equities",
      "risk-on",
      "risk-off",
      "product timing",
      "market radar",
      "semiconductor",
      "ai infrastructure",
      "supply chain",
      "growth",
      "capex",
      "international",
    ],
    worldChange:
      "AI, semiconductor, and broad growth equities are becoming fast context for product timing, buyer appetite, and infrastructure narratives.",
    productToBuild:
      "A high-level market radar that translates national and international stock movement into product-context notes, not trading calls.",
    targetUser: "builders deciding which product bets deserve attention this week",
    complaintPattern:
      "Product decisions often ignore market regime shifts until buyer appetite, infrastructure budgets, or narrative timing already changed.",
    nextStep:
      "Track the watchlist weekly and only convert market movement into product action when it changes positioning, urgency, or evidence needs.",
  },
  {
    id: "developer-workflow-friction",
    title: "Developer workflow friction radar",
    signalLayer: "app-complaint" as const,
    terms: ["developer", "github", "issue", "debug", "review", "ci", "trace", "observability", "productivity"],
    worldChange:
      "AI-assisted development is increasing the volume of code, issues, and review work that teams need to trust.",
    productToBuild:
      "A developer workflow radar that turns issue threads, review complaints, and debugging friction into product specs.",
    targetUser: "builders, maintainers, and product teams shipping developer tools",
    complaintPattern:
      "Developers expose product requirements through repeated issues about debugging, review quality, flaky workflows, and missing traces.",
    nextStep:
      "Pull GitHub issue clusters weekly and promote only repeated workflow friction with a concrete maintainer or user pain.",
  },
  {
    id: "launch-distribution",
    title: "Launch and distribution friction map",
    signalLayer: "app-complaint" as const,
    terms: ["launch", "feedback", "users", "distribution", "growth", "pricing", "waitlist", "demo", "onboarding"],
    worldChange:
      "Small products are easier to build, so distribution, onboarding, and proof now decide which products deserve more time.",
    productToBuild:
      "A launch-friction map that separates real buyer pull from generic feedback, traffic, and launch vanity metrics.",
    targetUser: "solo builders and small teams launching products",
    complaintPattern:
      "Builders repeatedly ask how to get users, validate pricing, improve onboarding, and find a channel before overbuilding.",
    nextStep:
      "Track launch communities and HN for one week, then convert repeated distribution pain into one manual validation artifact.",
  },
  {
    id: "source-provenance",
    title: "Source provenance and citation layer",
    signalLayer: "world-change" as const,
    terms: ["citation", "source", "provenance", "hallucination", "rag", "retrieval", "evidence", "docs"],
    worldChange:
      "AI products are being judged by whether users can inspect sources, citations, and evidence behind generated output.",
    productToBuild:
      "A provenance layer that tracks sources, claims, citations, and confidence across generated reports and product recommendations.",
    targetUser: "operators using AI summaries, research tools, and agent-generated decisions",
    complaintPattern:
      "Users distrust outputs when citations are missing, sources are stale, retrieval is opaque, or claims cannot be checked.",
    nextStep:
      "Mine GitHub and community complaints about citations/provenance and turn the top repeated failure into a source-linked UI spec.",
  },
  {
    id: "small-business-ops",
    title: "Small-business operations pressure map",
    signalLayer: "app-complaint" as const,
    terms: [
      "small business",
      "customer",
      "customers",
      "cashflow",
      "inventory",
      "staff",
      "labor",
      "rent",
      "booking",
      "invoice",
      "payroll",
      "shopify",
      "etsy",
    ],
    worldChange:
      "Small businesses are facing uneven demand, higher operating costs, hiring friction, and fragmented software workflows.",
    productToBuild:
      "A small-business operations radar that turns owner complaints into practical workflow, automation, and cashflow requirements.",
    targetUser: "local service businesses, retailers, ecommerce sellers, restaurants, and solo operators",
    complaintPattern:
      "Owners repeatedly describe cashflow, staffing, lead generation, reviews, inventory, bookings, and back-office tasks as daily friction.",
    nextStep:
      "Track owner/operator communities and local business news for one week, then promote only repeated problems tied to revenue, time, or compliance.",
  },
  {
    id: "public-consumer-shift",
    title: "Public consumer behavior shift",
    signalLayer: "world-change" as const,
    terms: [
      "consumer",
      "budget",
      "price",
      "expensive",
      "saving",
      "subscription",
      "cancel",
      "jobs",
      "rent",
      "family",
      "debt",
      "bills",
      "insurance",
      "groceries",
      "hiring",
      "salary",
      "layoff",
      "recruiter",
      "afford",
    ],
    worldChange:
      "General consumers are changing what they buy, cancel, trust, and tolerate as budgets, work, local services, and online discovery shift.",
    productToBuild:
      "A public-behavior radar that identifies consumer complaints and budget shifts before they become product or positioning requirements.",
    targetUser: "builders choosing consumer, local, marketplace, media, or SMB-support product bets",
    complaintPattern:
      "People describe affordability, trust, cancellation, support, local availability, and discovery problems before businesses adapt.",
    nextStep:
      "Track consumer and personal-finance communities plus local news, then convert only repeated behavior shifts into watch/change actions.",
  },
  {
    id: "regional-constraint-watch",
    title: "Regional constraint watch",
    signalLayer: "world-change" as const,
    terms: [
      "regional",
      "city",
      "india",
      "permit",
      "regulation",
      "tax",
      "rent",
      "traffic",
      "infrastructure",
      "jobs",
      "housing",
    ],
    worldChange:
      "Local and regional constraints such as rent, regulation, infrastructure, hiring, payments, and policy shape which products are useful in practice.",
    productToBuild:
      "A regional constraint layer that maps local pain into market-entry, positioning, and product requirement notes.",
    targetUser: "builders deciding whether a product idea works in a specific city, country, or customer segment",
    complaintPattern:
      "Regional users surface constraints around payments, logistics, regulations, local trust, jobs, housing, traffic, and service availability.",
    nextStep:
      "Track a small set of city/country and local-business sources, then require cross-source evidence before creating a product action.",
  },
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

function countTermHits(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word)).length;
}

const NOISY_COMMUNITY_PATTERNS = [
  { pattern: /i\s+will\s+not\s+promote/i, flag: "promo-disclaimer" },
  { pattern: /i\s+promise\s+i\s+will\s+not\s+promote/i, flag: "promo-disclaimer" },
  { pattern: /\bjust observing\b/i, flag: "low-intent-title" },
  { pattern: /\bit'?s not much\b/i, flag: "low-intent-title" },
  { pattern: /\bvibe coded\b/i, flag: "vibe-post" },
  { pattern: /\bappreciation post\b/i, flag: "appreciation-post" },
  { pattern: /\bhype\b/i, flag: "hype-thread" },
  { pattern: /\breleased today\b/i, flag: "release-thread" },
];

const PRODUCT_INTENT_WORDS = [
  "problem",
  "pain",
  "customer",
  "pay",
  "pricing",
  "revenue",
  "workflow",
  "manual",
  "bug",
  "missing",
  "trust",
  "monitor",
  "cost",
  "privacy",
  "validation",
  "landing page",
  "agent",
  "ai search",
  "source",
  "provenance",
  "cashflow",
  "inventory",
  "staff",
  "labor",
  "rent",
  "booking",
  "invoice",
  "payroll",
  "pos",
  "lead",
  "sales",
  "support",
  "reviews",
  "regional",
  "permit",
  "regulation",
  "tax",
  "traffic",
  "infrastructure",
  "housing",
];

export function communityDigestEvidenceQuality(digest: CommunityDigestSnapshot): IdeaEvidenceQuality {
  const rawSummary = digest.summary as
    | (CommunityDigestSnapshot["summary"] & {
        key_trend?: CommunityDigestSnapshot["summary"] extends null ? never : NonNullable<CommunityDigestSnapshot["summary"]>["keyTrend"];
        notable_discussions?: CommunityDigestSnapshot["summary"] extends null
          ? never
          : NonNullable<CommunityDigestSnapshot["summary"]>["notableDiscussions"];
        key_action?: CommunityDigestSnapshot["summary"] extends null ? never : NonNullable<CommunityDigestSnapshot["summary"]>["keyAction"];
      })
    | null;
  const keyTrend = rawSummary?.keyTrend ?? rawSummary?.key_trend;
  const notableDiscussions = rawSummary?.notableDiscussions ?? rawSummary?.notable_discussions ?? [];
  const keyAction = rawSummary?.keyAction ?? rawSummary?.key_action;
  const items = [keyTrend, ...notableDiscussions, keyAction].filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );
  const text = `${digest.summaryText} ${items.map((item) => `${item.title} ${item.desc}`).join(" ")}`;
  const primaryTitle = `${keyTrend?.title ?? items[0]?.title ?? ""} ${items[0]?.title ?? ""}`;
  const repeatedSignalCount = items.filter((item) =>
    containsAny(`${item.title} ${item.desc}`, PRODUCT_INTENT_WORDS),
  ).length;
  const noiseFlags = NOISY_COMMUNITY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ flag }) => flag);
  if (digest.sourceCount < 3) noiseFlags.push("thin-source-count");
  if (repeatedSignalCount === 0) noiseFlags.push("no-product-intent-repeat");
  if (NOISY_COMMUNITY_PATTERNS.some(({ pattern }) => pattern.test(primaryTitle))) {
    noiseFlags.push("noisy-primary-thread");
  }

  const genericRisk: IdeaEvidenceGenericRisk =
    noiseFlags.includes("thin-source-count") || noiseFlags.includes("no-product-intent-repeat") || noiseFlags.length >= 3
      ? "high"
      : noiseFlags.length > 0 || repeatedSignalCount < 2
        ? "medium"
        : "low";

  return {
    sourceCount: digest.sourceCount,
    repeatedSignalCount,
    genericRisk,
    noiseFlags: Array.from(new Set(noiseFlags)),
  };
}

function qualityEligible(evidence: IdeaFlowEvidence) {
  return evidence.quality?.genericRisk !== "high";
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

function sourceIdentity(evidence: IdeaFlowEvidence) {
  if (evidence.href.startsWith("/communities/")) {
    const [, , community = "community"] = evidence.href.split("/");
    return `community:${community.toLowerCase()}`;
  }
  if (evidence.href.startsWith("/markets")) return `market:${evidence.href.split("#")[1] ?? "watchlist"}`;
  try {
    const url = new URL(evidence.href);
    return `${evidence.source}:${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return `${evidence.source}:${evidence.href.split("#")[0]}`;
  }
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

export function generateProductOpportunities(
  evidence: IdeaFlowEvidence[],
): ProductOpportunity[] {
  const usable = evidence
    .filter((item) => item.confidence !== "low" && qualityEligible(item))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));

  return OPPORTUNITY_THEMES.map((theme) => {
    const matched = usable
      .filter((item) => (theme.signalLayer === "market-watch" ? item.source === "market" : item.source !== "market"))
      .map((item) => ({
        item,
        score: countTermHits(`${item.title} ${item.summary}`, theme.terms),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ item }) => item);

    const strongMatched = matched.filter((item) => item.quality?.genericRisk !== "medium");
    const repeatedSignalCount = matched.reduce((sum, item) => sum + (item.quality?.repeatedSignalCount ?? 1), 0);
    const highConfidenceSourceCount = matched.filter((item) => !item.quality && item.confidence === "high").length;
    const sourceDiversity = new Set(matched.map(sourceIdentity)).size;
    const hasCrossSourceSupport = sourceDiversity >= 2;
    const confidence: "low" | "medium" | "high" =
      hasCrossSourceSupport &&
      strongMatched.length >= 3 &&
      (repeatedSignalCount >= 8 || highConfidenceSourceCount >= 3) &&
      matched.some((item) => item.confidence === "high")
        ? "high"
        : hasCrossSourceSupport && matched.length >= 2 && (repeatedSignalCount >= 4 || highConfidenceSourceCount >= 2)
          ? "medium"
          : "low";
    const horizon: ProductOpportunityHorizon =
      confidence === "high" ? "now" : confidence === "medium" ? "next" : "watch";

    return {
      id: theme.id,
      title: theme.title,
      signalLayer: theme.signalLayer,
      worldChange: theme.worldChange,
      productToBuild: theme.productToBuild,
      targetUser: theme.targetUser,
      whyNow:
        matched[0]?.summary ??
        "The pattern is plausible, but the current evidence set is still too thin to build immediately.",
      complaintPattern: theme.complaintPattern,
      confidence,
      horizon,
      evidence: matched,
      sourceDiversity,
      nextStep: theme.nextStep,
    };
  }).sort((a, b) => {
    const rank = { now: 0, next: 1, watch: 2 };
    return rank[a.horizon] - rank[b.horizon] || b.evidence.length - a.evidence.length;
  });
}
