export type SignalContentCategory =
  | "ai-infra"
  | "market-pulse"
  | "product-opportunity"
  | "customer-complaint"
  | "startup-move"
  | "regional-issue"
  | "agent-evaluation"
  | "policy-regulatory"
  | "company-event";

export type SourceClass =
  | "official"
  | "news"
  | "community"
  | "market"
  | "developer"
  | "regional"
  | "review"
  | "other";

export type SignalQualityBand = "strong" | "usable" | "watch" | "draft";

export interface SignalLike {
  signalType: string;
  primaryEntityId?: string | null;
  confidence: "low" | "medium" | "high";
  evidenceUrls: string[];
  bodyMd: string;
}

export interface SignalQuality {
  score: number;
  band: SignalQualityBand;
  contentCategory: SignalContentCategory;
  evidenceCount: number;
  independentSourceCount: number;
  sourceClasses: SourceClass[];
  publishable: boolean;
  reasons: string[];
}

const AI_INFRA_TERMS = [
  "hbm",
  "gpu",
  "chip",
  "semiconductor",
  "foundry",
  "substrate",
  "litho",
  "euv",
  "packaging",
  "capex",
  "data_center",
  "datacenter",
  "neocloud",
  "memory",
  "asic",
];

const CATEGORY_RULES: Array<{ category: SignalContentCategory; terms: string[] }> = [
  {
    category: "market-pulse",
    terms: ["market", "prediction", "probability", "quote", "stock", "equity", "ipo", "analyst"],
  },
  {
    category: "customer-complaint",
    terms: ["complaint", "review", "churn", "support", "refund", "bug", "missing", "friction"],
  },
  {
    category: "product-opportunity",
    terms: ["product", "launch", "developer", "workflow", "requirement", "adoption", "integration"],
  },
  {
    category: "startup-move",
    terms: ["startup", "funding", "m_and_a", "acquisition", "partnership", "talent", "hiring"],
  },
  {
    category: "regional-issue",
    terms: ["regional", "india", "china", "taiwan", "korea", "eu", "local", "city"],
  },
  {
    category: "agent-evaluation",
    terms: ["agent", "llm", "ai_answer", "retrievability", "comparison", "evidence_layer"],
  },
  {
    category: "policy-regulatory",
    terms: ["regulatory", "policy", "export", "restriction", "antitrust", "lawsuit", "probe", "gov"],
  },
];

const OFFICIAL_DOMAINS = [
  "sec.gov",
  "investor.",
  "ir.",
  "newsroom.",
  "prnewswire.com",
  "businesswire.com",
  "gov",
  "europa.eu",
  "federalregister.gov",
  "hkexnews.hk",
];

const NEWS_DOMAINS = [
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "theinformation.com",
  "digitimes.com",
  "eetimes.com",
  "trendforce.com",
  "tomshardware.com",
  "nextplatform.com",
  "semianalysis.com",
  "servethehome.com",
];

const MARKET_DOMAINS = ["manifold.markets", "polymarket.com", "kalshi.com", "finance.yahoo.com"];
const COMMUNITY_DOMAINS = ["reddit.com", "news.ycombinator.com", "producthunt.com"];
const DEVELOPER_DOMAINS = ["github.com", "github.blog", "developers.google.com", "cloudflare.com", "stripe.com"];
const REVIEW_DOMAINS = ["g2.com", "capterra.com", "trustpilot.com", "apps.shopify.com"];
const REGIONAL_DOMAINS = ["timesofindia.indiatimes.com", "thehindu.com", "livemint.com", "indianexpress.com"];

function cleanText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function includesDomain(domain: string, needles: string[]) {
  return needles.some((needle) => domain === needle || domain.includes(needle));
}

export function classifySource(url: string): SourceClass {
  const domain = sourceDomain(url);
  if (includesDomain(domain, OFFICIAL_DOMAINS)) return "official";
  if (includesDomain(domain, MARKET_DOMAINS)) return "market";
  if (includesDomain(domain, COMMUNITY_DOMAINS)) return "community";
  if (includesDomain(domain, DEVELOPER_DOMAINS)) return "developer";
  if (includesDomain(domain, REVIEW_DOMAINS)) return "review";
  if (includesDomain(domain, REGIONAL_DOMAINS)) return "regional";
  if (includesDomain(domain, NEWS_DOMAINS)) return "news";
  return "other";
}

export function classifySignalCategory(signal: Pick<SignalLike, "signalType" | "bodyMd">): SignalContentCategory {
  const text = `${cleanText(signal.signalType)} ${cleanText(signal.bodyMd.slice(0, 1200))}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some((term) => text.includes(cleanText(term)))) return rule.category;
  }
  if (AI_INFRA_TERMS.some((term) => text.includes(cleanText(term)))) return "ai-infra";
  return "company-event";
}

function isFallbackOrBackfill(bodyMd: string) {
  const body = bodyMd.trimStart().toLowerCase();
  return body.includes("fallback draft generated") || body.startsWith("> _backfill_");
}

function isExplicitMarketProbability(signal: SignalLike, sourceClasses: SourceClass[]) {
  const text = cleanText(`${signal.signalType} ${signal.bodyMd.slice(0, 800)}`);
  return (
    sourceClasses.length > 0 &&
    sourceClasses.every((sourceClass) => sourceClass === "market") &&
    (text.includes("prediction") || text.includes("probability") || text.includes("market"))
  );
}

export function assessSignalQuality(signal: SignalLike): SignalQuality {
  const evidenceUrls = Array.from(new Set(signal.evidenceUrls.filter(Boolean)));
  const domains = new Set(evidenceUrls.map(sourceDomain));
  const sourceClasses = Array.from(new Set(evidenceUrls.map(classifySource)));
  const category = classifySignalCategory(signal);
  const reasons: string[] = [];
  const official = sourceClasses.includes("official");
  const marketOnly = sourceClasses.length === 1 && sourceClasses[0] === "market";
  const fallback = isFallbackOrBackfill(signal.bodyMd);
  const explicitMarketProbability = isExplicitMarketProbability(signal, sourceClasses);

  let score = 0;
  score += Math.min(evidenceUrls.length, 3) * 18;
  score += Math.min(domains.size, 3) * 16;
  if (official) score += 20;
  if (sourceClasses.length >= 2) score += 12;
  if (signal.bodyMd.trim().length >= 280) score += 8;
  if (signal.confidence === "high") score += 14;
  if (signal.confidence === "medium") score += 10;
  if (signal.confidence === "low") score += 5;
  if (explicitMarketProbability) score += 8;

  if (fallback) {
    score -= 50;
    reasons.push("fallback_or_backfill");
  }
  if (evidenceUrls.length === 0) {
    score -= 50;
    reasons.push("missing_evidence");
  }
  if (evidenceUrls.length === 1 && !official && !explicitMarketProbability) {
    score -= 25;
    reasons.push("single_non_official_source");
  }
  if (marketOnly && !explicitMarketProbability) {
    score -= 35;
    reasons.push("market_only_without_probability_frame");
  }
  if (signal.confidence !== "low" && domains.size < 2 && !official) {
    score -= 25;
    reasons.push("medium_high_without_independent_sources");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const publishable = !fallback && (score >= 65 || (explicitMarketProbability && score >= 45));
  let band: SignalQualityBand = "draft";
  if (score >= 85) band = "strong";
  else if (publishable) band = "usable";
  else if (score >= 45) band = "watch";

  if (publishable) reasons.push("passes_publish_gate");

  return {
    score,
    band,
    contentCategory: category,
    evidenceCount: evidenceUrls.length,
    independentSourceCount: domains.size,
    sourceClasses,
    publishable,
    reasons,
  };
}
