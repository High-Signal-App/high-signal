import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildPersonalCommandBrief,
  communityDigestEvidenceQuality,
  evidenceFromMarketRefreshes,
  evidenceFromMarketWatchConfig,
  generateProductOpportunities,
  marketDirection,
  type CommunityDigestSnapshot,
  type IdeaFlowEvidence,
  type MarketQuote,
  type MarketRefreshRecord,
  type MarketWatchConfig,
  type MarketWatchGroup,
  type PersonalActionTask,
  type PersonalBriefSnapshot,
  type PersonalDecisionStatus,
  type PersonalProductProfile,
  type PersonalRecommendationDecision,
  type PersonalRecommendationFeedback,
  type PersonalTaskSyncRecord,
  type PersonalFeedbackLabel,
  type PersonalActionKind,
  snapshotFromPersonalBrief,
} from "@high-signal/shared";

type ProductGraph = {
  products: PersonalProductProfile[];
};

type ProductFlowSeed = {
  communities: Array<{
    subreddit: string;
    period: "day" | "week" | "month";
    prompt: string;
    digests: CommunityDigestSnapshot[];
  }>;
};

type SourcePeriod = "day" | "week" | "month";
type PersonalSourceType = "reddit" | "hacker-news" | "github-issues" | "rss";

type PersonalSourceRegistry = {
  sources: Array<{
    id: string;
    type: PersonalSourceType;
    label: string;
    target: string;
    period: SourcePeriod;
    limit?: number;
    query?: string;
    intent: string;
  }>;
};

type ProductFlowRefreshRecord = {
  source: PersonalSourceType;
  sourceId?: string;
  label?: string;
  target?: string;
  subreddit?: string;
  period: SourcePeriod;
  prompt: string;
  digest: CommunityDigestSnapshot;
  createdAt: string;
  refreshStatus?: "accepted" | "rejected";
  refreshReason?: string;
  refreshError?: string;
};

type SaaSMakerTaskCache = {
  tasks: Array<{
    id: string;
    project_slug?: string;
    title: string;
    status?: string;
  }>;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FEEDBACK_PATH = resolve(ROOT, "data/personal-feedback.jsonl");
const DECISIONS_PATH = resolve(ROOT, "data/personal-decisions.jsonl");
const TASK_SYNC_PATH = resolve(ROOT, "data/personal-task-sync.jsonl");
const SOURCE_REGISTRY_PATH = resolve(ROOT, "data/personal-source-registry.json");
const SOURCE_REFRESH_PATH = resolve(ROOT, "data/product-flow-refresh.jsonl");
const MARKET_REFRESH_PATH = resolve(ROOT, "data/personal-market-refresh.jsonl");
const BRIEF_SNAPSHOT_PATH = resolve(ROOT, "data/personal-brief-snapshots.jsonl");
const COMPLAINT_CLUSTER_LEDGER_PATH = resolve(ROOT, "data/personal-complaint-clusters.jsonl");
const REEL_BRIEF_LEDGER_PATH = resolve(ROOT, "data/personal-reel-briefs.jsonl");
const REPORT_INDEX_PATH = resolve(ROOT, "data/personal-report-index.json");
const REPORTS_DIR = resolve(ROOT, "reports/personal");
const SAAS_MAKER_TASK_CACHE = "/Users/sarthak/Desktop/fleet/saas-maker/.symphony/tasks.json";
const execFileAsync = promisify(execFile);
const PRODUCT_TIME_ZONE = process.env.HIGH_SIGNAL_TIME_ZONE ?? "Asia/Kolkata";

const fallbackFlows: IdeaFlowEvidence[] = [
  {
    id: "cli-agent-eval",
    source: "mention",
    title: "Agent evaluation is becoming part of product selection",
    summary:
      "Products that are not legible, cited, and evidence-backed will be filtered out by assistants and buyer agents.",
    href: "/agent-eval",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "cli-google-ai-mode-comparisons",
    source: "resource",
    title: "AI search features are built for complex comparisons",
    summary:
      "Google describes AI search features as useful for nuanced questions and comparison-style research, which raises the bar for product evidence and retrievability.",
    href: "https://developers.google.com/search/docs/appearance/ai-features",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "cli-agentic-commerce-infrastructure",
    source: "resource",
    title: "Agentic commerce requires agent-ready infrastructure",
    summary:
      "Agentic commerce shifts product selection toward agents that compare options, inspect trust signals, and need machine-readable product and policy data.",
    href: "https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "cli-fleet-ops",
    source: "resource",
    title: "Multi-product builders need ranked build/change/watch decisions",
    summary:
      "A fleet of small products needs ranked actions across product opportunities, complaints, and market changes.",
    href: "/personal",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function productDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function productSnapshotTimestamp(date = new Date()) {
  return `${productDateString(date)}T${date.toISOString().slice(11)}`;
}

async function readFeedback(): Promise<PersonalRecommendationFeedback[]> {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalRecommendationFeedback);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readDecisions(): Promise<PersonalRecommendationDecision[]> {
  try {
    const raw = await readFile(DECISIONS_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalRecommendationDecision);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readTaskSync(): Promise<PersonalTaskSyncRecord[]> {
  try {
    const raw = await readFile(TASK_SYNC_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalTaskSyncRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSourceRefreshes(): Promise<ProductFlowRefreshRecord[]> {
  try {
    const raw = await readFile(SOURCE_REFRESH_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProductFlowRefreshRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readMarketRefreshes(): Promise<MarketRefreshRecord[]> {
  try {
    const raw = await readFile(MARKET_REFRESH_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MarketRefreshRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readBriefSnapshots(): Promise<PersonalBriefSnapshot[]> {
  try {
    const raw = await readFile(BRIEF_SNAPSHOT_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PersonalBriefSnapshot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSaaSMakerTaskCache(): Promise<SaaSMakerTaskCache["tasks"]> {
  try {
    const cache = await readJson<SaaSMakerTaskCache>(SAAS_MAKER_TASK_CACHE);
    return Array.isArray(cache.tasks) ? cache.tasks : [];
  } catch {
    return [];
  }
}

function isFeedbackLabel(value: string): value is PersonalFeedbackLabel {
  return ["useful", "obvious", "wrong", "build", "ignore"].includes(value);
}

function isDecisionStatus(value: string): value is PersonalDecisionStatus {
  return ["accepted", "deferred", "rejected", "done"].includes(value);
}

function isAction(value: string): value is PersonalActionKind {
  return ["build", "change", "watch", "pause"].includes(value);
}

function evidenceFromSeed(seed: ProductFlowSeed): IdeaFlowEvidence[] {
  return seed.communities.flatMap((community) =>
    community.digests.map((digest) => ({
      id: `seed-${community.subreddit}-${digest.snapshotDate}`,
      source: "community" as const,
      title: digest.summary?.keyTrend?.title ?? `r/${community.subreddit} ${community.period} digest`,
      summary: digest.summary?.keyTrend?.desc ?? digest.summaryText,
      href: `/communities/${encodeURIComponent(community.subreddit)}/${community.period}`,
      observedAt: digest.snapshotDate,
      confidence: digest.sourceCount >= 8 ? "high" : digest.sourceCount >= 3 ? "medium" : "low",
      quality: communityDigestEvidenceQuality(digest),
    })),
  );
}

function evidenceFromRefreshes(records: ProductFlowRefreshRecord[]): IdeaFlowEvidence[] {
  return latestRefreshRecords(records)
    .filter((record) => record.digest.sourceCount >= 2)
    .filter((record) => sourceRefreshPassesGate(record))
    .filter((record) => {
      const quality = communityDigestEvidenceQuality(record.digest);
      return quality.genericRisk !== "high" && quality.repeatedSignalCount >= 2;
    })
    .map((record) => ({
      id: `refresh-${record.sourceId ?? record.subreddit ?? record.source}-${record.digest.snapshotDate}`,
      source: record.source === "rss" ? ("news" as const) : ("community" as const),
      title:
        record.digest.summary?.keyTrend?.title ??
        `${record.label ?? record.subreddit ?? record.target ?? record.source} ${record.period} refresh`,
      summary: record.digest.summary?.keyTrend?.desc ?? record.digest.summaryText,
      href: record.digest.summary?.keyTrend?.link ?? `/personal#${record.sourceId ?? record.subreddit ?? record.source}`,
      observedAt: record.digest.snapshotDate,
      confidence: record.digest.sourceCount >= 8 ? "high" : record.digest.sourceCount >= 3 ? "medium" : "low",
      quality: communityDigestEvidenceQuality(record.digest),
    }));
}

function latestRefreshRecords(records: ProductFlowRefreshRecord[]) {
  const latest = new Map<string, ProductFlowRefreshRecord>();
  for (const record of records) {
    const key = `${record.source}:${record.sourceId ?? record.subreddit ?? record.target ?? record.label}:${record.period}`.toLowerCase();
    const previous = latest.get(key);
    if (!previous || record.digest.snapshotDate > previous.digest.snapshotDate) latest.set(key, record);
  }
  return Array.from(latest.values()).sort((a, b) => b.digest.snapshotDate.localeCompare(a.digest.snapshotDate));
}

type RedditPost = {
  id: string;
  title: string;
  selftext: string;
  score: number;
  permalink: string;
};

type SourcePost = {
  id: string;
  title: string;
  body: string;
  score: number;
  url: string;
  sourceLabel: string;
};

const PRODUCT_SIGNAL_QUERIES: Record<string, string> = {
  localllama: "workflow OR eval OR observability OR cost OR routing OR source OR provenance OR agent",
  saas: "validate OR problem OR pricing OR distribution OR customer OR revenue OR launch",
  startups: "customer discovery OR validation OR revenue model OR wedge OR pricing OR problem",
  selfhosted: "monitoring OR privacy OR control OR dashboard OR alert OR cost OR open source",
};

function daysForPeriod(period: SourcePeriod) {
  if (period === "day") return 1;
  if (period === "month") return 30;
  return 7;
}

function sinceDateForPeriod(period: SourcePeriod) {
  return new Date(Date.now() - daysForPeriod(period) * 86_400_000);
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function stripTags(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function firstXmlValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1] ?? "") : "";
}

function firstXmlHref(block: string) {
  const linkText = firstXmlValue(block, "link");
  if (linkText) return linkText;
  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return hrefMatch?.[1] ? decodeXml(hrefMatch[1]) : "";
}

function xmlBlocks(xml: string) {
  const itemBlocks = Array.from(xml.matchAll(/<item[\s\S]*?<\/item>/gi)).map((match) => match[0]);
  if (itemBlocks.length) return itemBlocks;
  return Array.from(xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)).map((match) => match[0]);
}

function queryTerms(source: PersonalSourceRegistry["sources"][number]) {
  return `${source.target} ${source.query ?? ""} ${source.intent}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3 && !["https", "http", "www"].includes(term));
}

const LOW_INTENT_POST_PATTERNS = [
  /i\s+will\s+not\s+promote/i,
  /i\s+promise\s+i\s+will\s+not\s+promote/i,
  /\bappreciation post\b/i,
  /\bhype\b/i,
  /\breleased today\b/i,
  /\blfg\b/i,
  /\bshow hn\b/i,
  /\bjust launched\b/i,
  /\bfinally launched\b/i,
  /\bshop critique\b/i,
];

const THEME_TERMS = [
  {
    label: "workflow reliability",
    words: ["workflow", "eval", "observability", "trace", "failure", "routing", "cost", "prompt", "agent"],
    action: "Collect repeated workflow failures and turn them into one validation artifact before building tooling.",
  },
  {
    label: "complaint-to-spec demand",
    words: ["pain", "problem", "bug", "missing", "feature", "validate", "customer", "idea", "manual"],
    action: "Promote only repeated complaints with a clear user, current workaround, and smallest useful spec.",
  },
  {
    label: "local control",
    words: ["local", "self-host", "selfhost", "privacy", "open source", "cost", "offline", "control"],
    action: "Test whether control is a paid product pull or just an implementation preference.",
  },
  {
    label: "agent evaluation",
    words: ["agent", "ai search", "citation", "seo", "brand", "compare", "recommend", "visibility"],
    action: "Map missing proof and comparison content into an agent-readiness task.",
  },
  {
    label: "developer workflow friction",
    words: ["developer", "debug", "review", "issue", "github", "pull request", "ci", "trace", "productivity"],
    action: "Convert developer workflow friction into a bug-finding, review, or observability requirement.",
  },
  {
    label: "launch and distribution friction",
    words: ["launch", "distribution", "feedback", "users", "growth", "waitlist", "demo", "onboarding"],
    action: "Treat distribution friction as a product requirement only when it repeats with a clear user and channel.",
  },
  {
    label: "source provenance",
    words: ["citation", "source", "provenance", "hallucination", "rag", "retrieval", "evidence", "docs"],
    action: "Turn provenance complaints into evidence-layer tasks before shipping new generation surfaces.",
  },
  {
    label: "small-business operations pressure",
    words: [
      "small business",
      "cashflow",
      "customer",
      "customers",
      "inventory",
      "staff",
      "payroll",
      "invoice",
      "shipping",
      "orders",
      "shopify",
      "etsy",
      "fulfillment",
    ],
    action: "Promote only owner/operator problems tied to revenue, time, customer trust, compliance, or recurring workflow drag.",
  },
  {
    label: "public consumer behavior shift",
    words: ["consumer", "budget", "rent", "debt", "bills", "subscription", "expensive", "saving", "insurance", "jobs"],
    action: "Treat public behavior as a product signal only when it changes what people buy, cancel, trust, or tolerate.",
  },
  {
    label: "regional constraint watch",
    words: [
      "regional",
      "city",
      "traffic",
      "commute",
      "housing",
      "permit",
      "regulation",
      "tax",
      "pollution",
      "local business",
      "transit",
    ],
    action: "Map regional constraints into product-entry or positioning notes only when multiple concrete frictions repeat.",
  },
];

const BROAD_PUBLIC_SOURCE_IDS = new Set([
  "reddit-smallbusiness",
  "reddit-entrepreneur",
  "reddit-ecommerce",
  "reddit-shopify",
  "reddit-etsy-sellers",
  "reddit-freelance",
  "reddit-personalfinance",
  "reddit-povertyfinance",
  "reddit-jobs",
  "reddit-india",
  "reddit-bangalore",
  "reddit-mumbai",
  "reddit-delhi",
  "reddit-nyc",
  "reddit-bayarea",
  "hn-small-business",
  "hn-consumer-behavior",
  "rss-google-news-smb",
  "rss-google-news-india-startups",
  "rss-google-news-consumer-pressure",
  "rss-google-news-regional-india",
]);

const BROAD_PUBLIC_DOMAIN_TERMS = [
  "ads",
  "application",
  "bill",
  "bills",
  "booking",
  "budget",
  "cashflow",
  "checkout",
  "client",
  "clients",
  "commute",
  "consumer",
  "contract",
  "conversion",
  "customer",
  "customers",
  "debt",
  "delivery",
  "ecommerce",
  "etsy",
  "expensive",
  "fees",
  "fulfillment",
  "groceries",
  "hiring",
  "housing",
  "insurance",
  "interview",
  "inventory",
  "invoice",
  "job",
  "jobs",
  "lead",
  "leads",
  "local business",
  "order",
  "orders",
  "pay",
  "payment",
  "payments",
  "payroll",
  "permit",
  "pollution",
  "pricing",
  "recruiter",
  "regulation",
  "rent",
  "resume",
  "returns",
  "review",
  "reviews",
  "salary",
  "sales",
  "saving",
  "service",
  "shipping",
  "shopify",
  "small business",
  "staff",
  "subscription",
  "support",
  "tax",
  "traffic",
  "transit",
];

const BROAD_PUBLIC_ACTION_TERMS = [
  "advice",
  "broken",
  "cancel",
  "cannot",
  "complaint",
  "cost",
  "expensive",
  "friction",
  "help",
  "how do",
  "issue",
  "missing",
  "need",
  "pain",
  "problem",
  "stuck",
  "struggling",
  "why is",
];

async function fetchRedditTopPosts(subreddit: string, period: "day" | "week" | "month"): Promise<RedditPost[]> {
  const response = await fetch(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?${new URLSearchParams({
      t: period,
      limit: "10",
    })}`,
    { headers: { "User-Agent": "HighSignalPersonal/1.0 (source refresh)" } },
  );
  if (!response.ok) throw new Error(`reddit_${response.status}`);
  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  return (data.data?.children ?? [])
    .map((child) => child.data ?? {})
    .map((post) => ({
      id: `${post["id"] ?? ""}`,
      title: `${post["title"] ?? ""}`.trim(),
      selftext: `${post["selftext"] ?? ""}`.trim(),
      score: Number(post["score"] ?? 0),
      permalink: `https://www.reddit.com${post["permalink"] ?? ""}`,
    }))
    .filter((post) => post.id && post.title);
}

async function fetchRedditSearchPosts(subreddit: string, period: SourcePeriod, queryOverride?: string): Promise<RedditPost[]> {
  const query =
    queryOverride ??
    PRODUCT_SIGNAL_QUERIES[subreddit.toLowerCase()] ??
    "workflow OR problem OR validate OR cost OR privacy OR agent OR monitoring";
  const response = await fetch(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?${new URLSearchParams({
      q: query,
      restrict_sr: "1",
      sort: "new",
      t: period,
      limit: "12",
    })}`,
    { headers: { "User-Agent": "HighSignalPersonal/1.0 (source refresh)" } },
  );
  if (!response.ok) throw new Error(`reddit_search_${response.status}`);
  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  return (data.data?.children ?? [])
    .map((child) => child.data ?? {})
    .map((post) => ({
      id: `${post["id"] ?? ""}`,
      title: `${post["title"] ?? ""}`.trim(),
      selftext: `${post["selftext"] ?? ""}`.trim(),
      score: Number(post["score"] ?? 0),
      permalink: `https://www.reddit.com${post["permalink"] ?? ""}`,
    }))
    .filter((post) => post.id && post.title);
}

function mergePosts(primary: RedditPost[], fallback: RedditPost[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

function redditPostToSource(post: RedditPost, subreddit: string): SourcePost {
  return {
    id: `reddit-${subreddit}-${post.id}`,
    title: post.title,
    body: post.selftext,
    score: post.score,
    url: post.permalink,
    sourceLabel: `r/${subreddit}`,
  };
}

function postHasLowIntentPattern(post: SourcePost) {
  const text = `${post.title} ${post.body}`;
  return LOW_INTENT_POST_PATTERNS.some((pattern) => pattern.test(text));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text: string, term: string) {
  const normalizedTerm = term.toLowerCase().trim();
  if (!normalizedTerm) return false;
  if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(text);
}

function hasAnyTerm(text: string, words: string[]) {
  return words.some((word) => hasTerm(text, word));
}

function isBroadPublicSource(sourceId?: string) {
  return sourceId ? BROAD_PUBLIC_SOURCE_IDS.has(sourceId) : false;
}

function passesBroadPublicGate(text: string, sourceType?: PersonalSourceType) {
  const hasDomainTerm = hasAnyTerm(text, BROAD_PUBLIC_DOMAIN_TERMS);
  const hasActionTerm = hasAnyTerm(text, BROAD_PUBLIC_ACTION_TERMS);
  if (!hasDomainTerm) return false;
  if (sourceType === "rss" || sourceType === "hacker-news") return true;
  return hasActionTerm;
}

function relevantPostForSource(post: SourcePost, source: PersonalSourceRegistry["sources"][number]) {
  const text = `${post.title} ${post.body}`.toLowerCase();
  if (postHasLowIntentPattern(post)) return false;
  const sourceTerms = queryTerms(source);
  const hasSourceTerm = sourceTerms.some((term) => hasTerm(text, term));
  const hasThemeTerm = THEME_TERMS.some((theme) => theme.words.some((word) => hasTerm(text, word)));
  if (isBroadPublicSource(source.id) && !passesBroadPublicGate(text, source.type)) return false;
  if (source.type === "reddit") return hasThemeTerm && hasSourceTerm;
  return hasSourceTerm && hasThemeTerm;
}

function digestText(digest: CommunityDigestSnapshot) {
  const summary = digest.summary;
  const notable = summary?.notableDiscussions ?? [];
  return [
    digest.summaryText,
    summary?.keyTrend?.title,
    summary?.keyTrend?.desc,
    ...notable.flatMap((item) => [item.title, item.desc]),
    summary?.keyAction?.title,
    summary?.keyAction?.desc,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceRefreshPassesGate(record: ProductFlowRefreshRecord) {
  if (record.refreshStatus === "rejected") return false;
  if (!isBroadPublicSource(record.sourceId)) return true;
  return passesBroadPublicGate(digestText(record.digest), record.source);
}

async function fetchHackerNewsPosts(source: PersonalSourceRegistry["sources"][number]): Promise<SourcePost[]> {
  const since = Math.floor(sinceDateForPeriod(source.period).getTime() / 1000);
  const params = new URLSearchParams({
    query: source.target,
    tags: "story",
    hitsPerPage: String(source.limit ?? 8),
    numericFilters: `created_at_i>${since}`,
  });
  const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`, {
    headers: { "User-Agent": "HighSignalPersonal/1.0 (source refresh)" },
  });
  if (!response.ok) throw new Error(`hn_${response.status}`);
  const data = (await response.json()) as {
    hits?: Array<{
      objectID?: string;
      title?: string;
      story_title?: string;
      url?: string;
      story_url?: string;
      points?: number;
      num_comments?: number;
    }>;
  };
  return (data.hits ?? [])
    .map((hit) => {
      const id = `${hit.objectID ?? ""}`;
      const title = `${hit.title ?? hit.story_title ?? ""}`.trim();
      const url = `${hit.url ?? hit.story_url ?? (id ? `https://news.ycombinator.com/item?id=${id}` : "")}`.trim();
      return {
        id: `hn-${id}`,
        title,
        body: `${hit.num_comments ?? 0} comments on Hacker News.`,
        score: Number(hit.points ?? 0),
        url,
        sourceLabel: source.label,
      };
    })
    .filter((post) => post.id && post.title && post.url);
}

async function fetchGitHubIssuePosts(source: PersonalSourceRegistry["sources"][number]): Promise<SourcePost[]> {
  const since = sinceDateForPeriod(source.period).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: `${source.target} is:issue updated:>=${since}`,
    sort: "updated",
    order: "desc",
    per_page: String(source.limit ?? 8),
  });
  const response = await fetch(`https://api.github.com/search/issues?${params}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "HighSignalPersonal/1.0 (source refresh)",
    },
  });
  if (!response.ok) throw new Error(`github_${response.status}`);
  const data = (await response.json()) as {
    items?: Array<{
      id?: number;
      title?: string;
      body?: string | null;
      html_url?: string;
      comments?: number;
      repository_url?: string;
    }>;
  };
  return (data.items ?? [])
    .map((item) => ({
      id: `github-${item.id ?? item.html_url ?? item.title}`,
      title: `${item.title ?? ""}`.trim(),
      body: `${item.body ?? ""}`.trim().slice(0, 500),
      score: Number(item.comments ?? 0),
      url: `${item.html_url ?? ""}`.trim(),
      sourceLabel: source.label,
    }))
    .filter((post) => post.id && post.title && post.url);
}

async function fetchRssPosts(source: PersonalSourceRegistry["sources"][number]): Promise<SourcePost[]> {
  const response = await fetch(source.target, {
    headers: { "User-Agent": "HighSignalPersonal/1.0 (source refresh)" },
  });
  if (!response.ok) throw new Error(`rss_${response.status}`);
  const xml = await response.text();
  const since = sinceDateForPeriod(source.period).getTime();
  return xmlBlocks(xml)
    .map((block, index) => {
      const title = firstXmlValue(block, "title");
      const body =
        firstXmlValue(block, "description") ||
        firstXmlValue(block, "summary") ||
        firstXmlValue(block, "content:encoded") ||
        firstXmlValue(block, "content");
      const url = firstXmlHref(block);
      const rawDate = firstXmlValue(block, "pubDate") || firstXmlValue(block, "updated") || firstXmlValue(block, "published");
      const time = rawDate ? Date.parse(rawDate) : Date.now();
      return {
        id: `rss-${source.id}-${index}-${time}`,
        title,
        body,
        score: Number.isFinite(time) ? Math.max(0, Math.round((time - since) / 86_400_000)) : 0,
        url,
        sourceLabel: source.label,
        time,
      };
    })
    .filter((post) => post.title && post.url)
    .filter((post) => Number.isNaN(post.time) || post.time >= since)
    .slice(0, source.limit ?? 8)
    .map(({ time: _time, ...post }) => post);
}

async function fetchRegistrySource(source: PersonalSourceRegistry["sources"][number]): Promise<SourcePost[]> {
  if (source.type === "reddit") {
    const [searchPosts, topPosts] = await Promise.all([
      fetchRedditSearchPosts(source.target, source.period, source.query).catch(() => []),
      fetchRedditTopPosts(source.target, source.period),
    ]);
    return mergePosts(searchPosts, topPosts)
      .map((post) => redditPostToSource(post, source.target))
      .filter((post) => relevantPostForSource(post, source))
      .slice(0, source.limit ?? 10);
  }
  if (source.type === "hacker-news") {
    return (await fetchHackerNewsPosts(source)).filter((post) => relevantPostForSource(post, source));
  }
  if (source.type === "github-issues") {
    return (await fetchGitHubIssuePosts(source)).filter((post) => relevantPostForSource(post, source));
  }
  if (source.type === "rss") {
    return (await fetchRssPosts(source)).filter((post) => relevantPostForSource(post, source));
  }
  return [];
}

function themeScore(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word)).length;
}

function summarizeRefresh(input: {
  subreddit: string;
  period: SourcePeriod;
  prompt: string;
  posts: RedditPost[];
}): CommunityDigestSnapshot {
  const joined = input.posts.map((post) => `${post.title} ${post.selftext}`).join(" ");
  const theme =
    THEME_TERMS.map((item) => ({ item, score: themeScore(joined, item.words) })).sort((a, b) => b.score - a.score)[0]
      ?.item ?? THEME_TERMS[0].item;
  const top = input.posts[0];
  const snapshotDate = productSnapshotTimestamp();
  const notable = input.posts.slice(0, 3).map((post) => ({
    title: post.title,
    desc: post.selftext.slice(0, 260) || `${post.score} points in r/${input.subreddit}.`,
    link: post.permalink,
  }));
  const summaryText = top
    ? `Fresh r/${input.subreddit} discussions point toward ${theme.label}. Top thread: ${top.title}`
    : `No fresh r/${input.subreddit} posts were available for ${input.period}.`;
  return {
    id: `refresh-${input.subreddit.toLowerCase()}-${input.period}-${snapshotDate.slice(0, 10)}`,
    subreddit: input.subreddit,
    period: input.period,
    snapshotDate,
    summaryText,
    summary: {
      keyTrend: {
        title: `Fresh r/${input.subreddit}: ${theme.label}`,
        desc: summaryText,
        link: top?.permalink,
      },
      notableDiscussions: notable,
      keyAction: {
        title: "Personal build implication",
        desc: theme.action,
        link: top?.permalink,
      },
    },
    promptUsed: input.prompt,
    sourceCount: input.posts.length,
    createdAt: snapshotDate,
  };
}

function summarizeSourceRefresh(input: {
  source: PersonalSourceRegistry["sources"][number];
  posts: SourcePost[];
}): CommunityDigestSnapshot {
  const joined = input.posts.map((post) => `${post.title} ${post.body}`).join(" ");
  const theme =
    THEME_TERMS.map((item) => ({ item, score: themeScore(joined, item.words) })).sort((a, b) => b.score - a.score)[0]
      ?.item ?? THEME_TERMS[0].item;
  const top = input.posts[0];
  const snapshotDate = productSnapshotTimestamp();
  const notable = input.posts.slice(0, 4).map((post) => ({
    title: post.title,
    desc: post.body.slice(0, 260) || `${post.score} activity score from ${post.sourceLabel}.`,
    link: post.url,
  }));
  const summaryText = top
    ? `${input.source.label} points toward ${theme.label}. Top item: ${top.title}`
    : `${input.source.label} had no fresh usable items for ${input.source.period}.`;
  return {
    id: `refresh-${input.source.id}-${snapshotDate.slice(0, 10)}`,
    subreddit: input.source.label,
    period: input.source.period,
    snapshotDate,
    summaryText,
    summary: {
      keyTrend: {
        title: `${input.source.label}: ${theme.label}`,
        desc: summaryText,
        link: top?.url,
      },
      notableDiscussions: notable,
      keyAction: {
        title: "Personal build implication",
        desc: theme.action,
        link: top?.url,
      },
    },
    promptUsed: input.source.intent,
    sourceCount: input.posts.length,
    createdAt: snapshotDate,
  };
}

function summarizeRejectedSourceRefresh(input: {
  source: PersonalSourceRegistry["sources"][number];
  reason: string;
  detail: string;
  posts?: SourcePost[];
}): CommunityDigestSnapshot {
  const snapshotDate = productSnapshotTimestamp();
  const posts = input.posts ?? [];
  const top = posts[0];
  return {
    id: `refresh-${input.source.id}-${snapshotDate.slice(0, 10)}-${input.reason}`,
    subreddit: input.source.label,
    period: input.source.period,
    snapshotDate,
    summaryText: `${input.source.label} rejected: ${input.detail}`,
    summary: {
      keyTrend: {
        title: `${input.source.label}: ${input.reason.replaceAll("-", " ")}`,
        desc: input.detail,
        link: top?.url,
      },
      notableDiscussions: posts.slice(0, 4).map((post) => ({
        title: post.title,
        desc: post.body.slice(0, 260) || `${post.score} activity score from ${post.sourceLabel}.`,
        link: post.url,
      })),
      keyAction: {
        title: "Source remediation",
        desc: input.detail,
        link: top?.url,
      },
    },
    promptUsed: input.source.intent,
    sourceCount: posts.length,
    createdAt: snapshotDate,
  };
}

function sourceRefreshRecord(input: {
  source: PersonalSourceRegistry["sources"][number];
  digest: CommunityDigestSnapshot;
  status: "accepted" | "rejected";
  reason?: string;
  error?: string;
}): ProductFlowRefreshRecord {
  return {
    source: input.source.type,
    sourceId: input.source.id,
    label: input.source.label,
    target: input.source.target,
    subreddit: input.source.type === "reddit" ? input.source.target : undefined,
    period: input.source.period,
    prompt: input.source.intent,
    digest: input.digest,
    createdAt: new Date().toISOString(),
    refreshStatus: input.status,
    refreshReason: input.reason,
    refreshError: input.error,
  };
}

async function appendRejectedSourceRefresh(input: {
  source: PersonalSourceRegistry["sources"][number];
  reason: string;
  detail: string;
  posts?: SourcePost[];
  error?: string;
}) {
  const digest = summarizeRejectedSourceRefresh(input);
  const record = sourceRefreshRecord({
    source: input.source,
    digest,
    status: "rejected",
    reason: input.reason,
    error: input.error,
  });
  await appendFile(SOURCE_REFRESH_PATH, `${JSON.stringify(record)}\n`);
  return record;
}

async function refreshSources(seed: ProductFlowSeed, registry?: PersonalSourceRegistry) {
  const acceptedRecords: ProductFlowRefreshRecord[] = [];
  const rejectedRecords: ProductFlowRefreshRecord[] = [];
  const sources =
    registry?.sources ??
    seed.communities.map((community) => ({
      id: `reddit-${community.subreddit.toLowerCase()}`,
      type: "reddit" as const,
      label: `r/${community.subreddit}`,
      target: community.subreddit,
      period: community.period,
      limit: 10,
      query: PRODUCT_SIGNAL_QUERIES[community.subreddit.toLowerCase()],
      intent: community.prompt,
    }));
  for (const source of sources) {
    try {
      const posts = await fetchRegistrySource(source);
      if (posts.length === 0) {
        const record = await appendRejectedSourceRefresh({
          source,
          reason: "no-fresh-usable-items",
          detail: `No fresh usable items matched ${source.label} for the ${source.period} window.`,
        });
        rejectedRecords.push(record);
        console.log(`- skipped ${source.label}: no fresh usable items`);
        continue;
      }
      const digest = summarizeSourceRefresh({ source, posts });
      const quality = communityDigestEvidenceQuality(digest);
      const gateRecord = sourceRefreshRecord({
        source,
        digest,
        status: "accepted",
      });
      if (!sourceRefreshPassesGate(gateRecord)) {
        const record = await appendRejectedSourceRefresh({
          source,
          reason: "weak-broad-source-match",
          detail: `${source.label} returned ${posts.length} item(s), but they did not pass the broad public/startup/small-business relevance gate.`,
          posts,
        });
        rejectedRecords.push(record);
        console.log(`- skipped ${source.label}: weak broad-source match`);
        continue;
      }
      if (quality.genericRisk === "high" || quality.repeatedSignalCount < 2) {
        const detail = quality.noiseFlags.join(", ") || "low repeat count";
        const record = await appendRejectedSourceRefresh({
          source,
          reason: "weak-signal",
          detail: `${source.label} passed source relevance but failed quality gate: ${detail}.`,
          posts,
        });
        rejectedRecords.push(record);
        console.log(`- skipped ${source.label}: weak signal (${detail})`);
        continue;
      }
      const record = gateRecord;
      acceptedRecords.push(record);
      await appendFile(SOURCE_REFRESH_PATH, `${JSON.stringify(record)}\n`);
      console.log(`- refreshed ${source.label}: ${digest.summary?.keyTrend?.title ?? digest.summaryText}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record = await appendRejectedSourceRefresh({
        source,
        reason: "fetch-error",
        detail: `${source.label} could not be fetched: ${message}.`,
        error: message,
      });
      rejectedRecords.push(record);
      console.log(`- failed ${source.label}: ${message}`);
    }
  }
  console.log(
    `Wrote ${acceptedRecords.length} accepted and ${rejectedRecords.length} rejected refresh record(s) to ${SOURCE_REFRESH_PATH}`,
  );
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchStooqQuote(ticker: MarketWatchGroup["tickers"][number]): Promise<MarketQuote | null> {
  const response = await fetch(
    `https://stooq.com/q/l/?${new URLSearchParams({
      s: ticker.stooqSymbol,
      f: "sd2t2ohlcv",
      h: "",
      e: "csv",
    })}`,
    { headers: { "User-Agent": "HighSignalPersonal/1.0 (market refresh)" } },
  );
  if (!response.ok) throw new Error(`stooq_${response.status}`);
  const [, row = ""] = (await response.text()).trim().split("\n");
  const [symbol = "", date = "", time = "", openRaw = "", , , closeRaw = "", volumeRaw = ""] = row
    .split(",")
    .map((value) => value.trim());
  const open = parseNumber(openRaw);
  const close = parseNumber(closeRaw);
  const volume = parseNumber(volumeRaw);
  if (!symbol || !date || !time || open === null || close === null) return null;
  return {
    symbol: ticker.symbol,
    name: ticker.name,
    role: ticker.role,
    stooqSymbol: ticker.stooqSymbol,
    date,
    time,
    open,
    close,
    changePct: ((close - open) / open) * 100,
    volume: volume ?? 0,
  };
}

async function refreshMarkets(config: MarketWatchConfig) {
  const groups = [];
  for (const group of config.groups) {
    const quotes = (
      await Promise.all(
        group.tickers.map((ticker) =>
          fetchStooqQuote(ticker).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`- failed ${ticker.symbol}: ${message}`);
            return null;
          }),
        ),
      )
    ).filter((quote): quote is MarketQuote => Boolean(quote));
    const averageChangePct =
      quotes.length > 0 ? quotes.reduce((sum, quote) => sum + quote.changePct, 0) / quotes.length : 0;
    groups.push({
      id: group.id,
      title: group.title,
      region: group.region,
      thesis: group.thesis,
      productImplication: group.productImplication,
      direction: marketDirection(averageChangePct),
      averageChangePct,
      quotes,
    });
    const movers = quotes
      .slice()
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 3)
      .map((quote) => `${quote.symbol} ${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`)
      .join(", ");
    console.log(`- refreshed ${group.title}: ${marketDirection(averageChangePct)} ${movers || "no usable quotes"}`);
  }
  const record: MarketRefreshRecord = {
    source: "stooq",
    createdAt: new Date().toISOString(),
    groups,
  };
  await appendFile(MARKET_REFRESH_PATH, `${JSON.stringify(record)}\n`);
  console.log(`Wrote market refresh to ${MARKET_REFRESH_PATH}`);
}

function printBrief(brief: ReturnType<typeof buildPersonalCommandBrief>) {
  console.log("# Personal Command Brief");
  console.log(`Generated: ${brief.generatedAt}`);
  console.log(`Products tracked: ${brief.productsTracked}`);
  console.log(
    `Evidence: world ${brief.evidenceBreakdown.worldChange}, app complaints ${brief.evidenceBreakdown.appComplaint}, markets ${brief.evidenceBreakdown.marketWatch}`,
  );
  console.log(`Usefulness: ${brief.usefulnessAudit.score}/100 (${brief.usefulnessAudit.readiness})`);
  console.log(`Feedback items: ${brief.feedbackCount}`);
  console.log(`Decision items: ${brief.decisionCount}`);
  console.log(`Latest evidence: ${brief.freshness.latestEvidenceAt ?? "none"}`);
  console.log(`Quality flags: noisy ${brief.freshness.noisyEvidenceCount}, thin ${brief.freshness.thinEvidenceCount}`);
  if (brief.freshness.warnings.length) {
    console.log(`Freshness warnings: ${brief.freshness.warnings.join(" | ")}`);
  }
  console.log("");

  console.log("## Usefulness Audit");
  for (const strength of brief.usefulnessAudit.strengths.slice(0, 8)) {
    console.log(`- strength: ${strength}`);
  }
  for (const gap of brief.usefulnessAudit.gaps.slice(0, 8)) {
    console.log(`- gap: ${gap}`);
  }
  console.log("");

  console.log("## Changed Since Last Brief");
  console.log(`Previous: ${brief.changeSummary.previousGeneratedAt ?? "none"}`);
  for (const item of brief.changeSummary.newRecommendations.slice(0, 6)) {
    console.log(`- new ${item.priority} / ${item.action} / score ${item.score}: ${item.id}`);
  }
  for (const item of brief.changeSummary.actionChanged.slice(0, 6)) {
    console.log(`- action changed ${item.id}: ${item.before} -> ${item.after}`);
  }
  for (const item of brief.changeSummary.scoreMoved.slice(0, 6)) {
    console.log(`- score moved ${item.id}: ${item.before} -> ${item.after}`);
  }
  if (
    !brief.changeSummary.newRecommendations.length &&
    !brief.changeSummary.actionChanged.length &&
    !brief.changeSummary.scoreMoved.length
  ) {
    console.log("- No material recommendation changes.");
  }
  console.log("");

  console.log("## Repeated Complaint Clusters");
  for (const cluster of brief.complaintClusters.slice(0, 5)) {
    console.log(`- [${cluster.confidence}] ${cluster.title} (${cluster.repeatedSignalCount} repeats, ${cluster.sourceCount} sources)`);
    console.log(`  - ${cluster.productImplication}`);
  }
  if (!brief.complaintClusters.length) console.log("- No repeated complaint clusters yet.");
  console.log("");

  console.log("## Evidence-Backed Reel Briefs");
  for (const reel of brief.reelBriefs.slice(0, 5)) {
    console.log(`- ${reel.title}`);
    console.log(`  - Hook: ${reel.hook}`);
    console.log(`  - Proof: ${reel.proofBeat}`);
    console.log(`  - CTA: ${reel.cta}`);
  }
  if (!brief.reelBriefs.length) console.log("- No evidence-backed reel briefs yet.");
  console.log("");

  console.log("## Top Build / Change Actions");
  for (const item of brief.topBuilds.slice(0, 8)) {
    const feedbackSuffix = item.feedbackAdjustment ? ` / feedback ${item.feedbackAdjustment > 0 ? "+" : ""}${item.feedbackAdjustment}` : "";
    const decisionSuffix = item.decisionStatus ? ` / ${item.decisionStatus}` : "";
    console.log(`- [${item.priority}] ${item.action.toUpperCase()} ${item.productName}: ${item.opportunityTitle}${feedbackSuffix}${decisionSuffix}`);
    console.log(`  - ID: ${item.id}`);
    console.log(`  - Why now: ${item.whyNow}`);
    console.log(`  - Suggested change: ${item.suggestedChange}`);
    console.log(`  - Next: ${item.nextStep}`);
  }
  console.log("");

  console.log("## Market Context");
  for (const item of brief.recommendations.filter((entry) => entry.signalLayer === "market-watch").slice(0, 4)) {
    console.log(`- [${item.priority}] ${item.action.toUpperCase()} ${item.productName}: ${item.opportunityTitle}`);
    console.log(`  - ID: ${item.id}`);
    console.log(`  - Why now: ${item.whyNow}`);
  }
  console.log("");

  console.log("## Accepted Action Queue");
  for (const task of brief.actionTasks.filter((item) => item.status === "todo").slice(0, 8)) {
    console.log(`- [${task.priority}] ${task.title}`);
    console.log(`  - ID: ${task.id}`);
    console.log(`  - Next: ${task.nextStep}`);
  }
  if (!brief.actionTasks.some((item) => item.status === "todo")) {
    console.log("- No accepted actions yet. Use `pnpm personal:brief decide <id> accepted <action>`.");
  }
  console.log("");

  console.log("## Watch Items");
  for (const item of brief.watchItems.slice(0, 8)) {
    console.log(`- [${item.priority}] WATCH ${item.productName}: ${item.opportunityTitle}`);
    console.log(`  - ID: ${item.id}`);
    console.log(`  - ${item.suggestedChange}`);
  }
  console.log("");

  console.log("## Weekly Review Questions");
  for (const question of brief.operatingQuestions) {
    console.log(`- ${question}`);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function taskDescription(task: PersonalActionTask) {
  const acceptance = task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  const evidence = task.evidenceUrls.map((url) => `- ${url}`).join("\n");
  return [
    task.rationale,
    "",
    `Next step: ${task.nextStep}`,
    "",
    "Acceptance:",
    acceptance,
    evidence ? "" : null,
    evidence ? "Evidence:" : null,
    evidence || null,
    "",
    `Generated from High Signal personal recommendation: ${task.recommendationId}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function symphonyCommandFor(task: PersonalActionTask) {
  const priority = task.priority === "critical" ? "high" : task.priority;
  return [
    "pnpm --dir /Users/sarthak/Desktop/fleet/saas-maker symphony create",
    shellQuote(task.title),
    "--project",
    shellQuote(task.saasMakerProjectSlug),
    "--priority",
    shellQuote(priority),
    "--description",
    shellQuote(taskDescription(task)),
  ].join(" ");
}

function symphonyArgsFor(task: PersonalActionTask) {
  const priority = task.priority === "critical" ? "high" : task.priority;
  return [
    "--silent",
    "--dir",
    "/Users/sarthak/Desktop/fleet/saas-maker",
    "symphony",
    "create",
    task.title,
    "--project",
    task.saasMakerProjectSlug,
    "--priority",
    priority,
    "--description",
    taskDescription(task),
    "--json",
  ];
}

function parseCreateOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as { id?: string; title?: string };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as { id?: string; title?: string };
    }
    throw new Error(`Could not parse SaaS Maker task create output: ${trimmed.slice(0, 160)}`);
  }
}

function printTaskExport(tasks: PersonalActionTask[]) {
  console.log("# SaaS Maker Task Drafts");
  if (tasks.length === 0) {
    console.log("No accepted personal action tasks yet.");
    return;
  }
  for (const task of tasks.filter((item) => item.status === "todo")) {
    console.log("");
    console.log(`## ${task.title}`);
    console.log(`Project: ${task.saasMakerProjectSlug}`);
    console.log(`Priority: ${task.priority === "critical" ? "high" : task.priority}`);
    console.log(`Type: feature`);
    console.log(`Sync: ${task.syncStatus}${task.syncedTaskId ? ` (${task.syncedTaskId})` : ""}`);
    console.log("");
    console.log(task.rationale);
    console.log("");
    console.log(`Next step: ${task.nextStep}`);
    console.log("");
    console.log("Acceptance:");
    for (const criterion of task.acceptanceCriteria) {
      console.log(`- ${criterion}`);
    }
    if (task.evidenceUrls.length) {
      console.log("");
      console.log("Evidence:");
      for (const url of task.evidenceUrls) {
        console.log(`- ${url}`);
      }
    }
    console.log("");
    console.log("Command:");
    console.log(symphonyCommandFor(task));
  }
}

function syncPlan(tasks: PersonalActionTask[]) {
  return tasks.filter((task) => task.status === "todo").map((task) => ({
    task,
    alreadySynced: task.syncStatus === "created" && Boolean(task.syncedTaskId),
  }));
}

async function syncAcceptedTasks(tasks: PersonalActionTask[], apply: boolean) {
  const plan = syncPlan(tasks);
  const existingTasks = apply ? await readSaaSMakerTaskCache() : [];
  console.log(apply ? "# Syncing Accepted Tasks" : "# Accepted Task Sync Plan");
  if (plan.length === 0) {
    console.log("No accepted todo tasks to sync.");
    return;
  }
  for (const item of plan) {
    if (item.alreadySynced) {
      console.log(`- skipped ${item.task.id}: already created as ${item.task.syncedTaskId}`);
      continue;
    }
    if (!apply) {
      console.log(`- would create ${item.task.id}: ${item.task.title}`);
      console.log(`  ${symphonyCommandFor(item.task)}`);
      continue;
    }
    const existing = existingTasks.find(
      (task) =>
        task.project_slug === item.task.saasMakerProjectSlug &&
        task.title === item.task.title &&
        task.status !== "done",
    );
    if (existing) {
      const record: PersonalTaskSyncRecord = {
        recommendationId: item.task.recommendationId,
        taskId: item.task.id,
        status: "created",
        externalTaskId: existing.id,
        externalTaskTitle: existing.title,
        createdAt: new Date().toISOString(),
      };
      await appendFile(TASK_SYNC_PATH, `${JSON.stringify(record)}\n`);
      console.log(`- recovered ${item.task.id}: already exists as ${existing.id}`);
      continue;
    }
    try {
      const result = await execFileAsync("pnpm", symphonyArgsFor(item.task), {
        maxBuffer: 1024 * 1024 * 4,
      });
      const parsed = parseCreateOutput(result.stdout);
      const record: PersonalTaskSyncRecord = {
        recommendationId: item.task.recommendationId,
        taskId: item.task.id,
        status: "created",
        externalTaskId: parsed.id,
        externalTaskTitle: parsed.title,
        createdAt: new Date().toISOString(),
      };
      await appendFile(TASK_SYNC_PATH, `${JSON.stringify(record)}\n`);
      console.log(`- created ${item.task.id}: ${parsed.id ?? parsed.title ?? "SaaS Maker task"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record: PersonalTaskSyncRecord = {
        recommendationId: item.task.recommendationId,
        taskId: item.task.id,
        status: "failed",
        error: message,
        createdAt: new Date().toISOString(),
      };
      await appendFile(TASK_SYNC_PATH, `${JSON.stringify(record)}\n`);
      console.log(`- failed ${item.task.id}: ${message}`);
    }
  }
}

function markdownTaskExport(task: PersonalActionTask) {
  return [
    `### ${task.title}`,
    "",
    `- Project: ${task.saasMakerProjectSlug}`,
    `- Priority: ${task.priority === "critical" ? "high" : task.priority}`,
    `- Status: ${task.status}`,
    `- Next: ${task.nextStep}`,
    "",
    "Acceptance:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    task.evidenceUrls.length ? "" : null,
    task.evidenceUrls.length ? "Evidence:" : null,
    ...task.evidenceUrls.map((url) => `- ${url}`),
    "",
    "Command:",
    "```bash",
    symphonyCommandFor(task),
    "```",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function recommendationLine(item: ReturnType<typeof buildPersonalCommandBrief>["recommendations"][number]) {
  const feedback = item.feedbackAdjustment ? `, feedback ${item.feedbackAdjustment > 0 ? "+" : ""}${item.feedbackAdjustment}` : "";
  const decision = item.decisionStatus ? `, decision ${item.decisionStatus}` : ", decision open";
  return `- ${item.priority} / ${item.action} / score ${item.score}, sources ${item.sourceDiversity}${feedback}${decision}: ${item.title}`;
}

function compactReportText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function sourceClass(source: PersonalSourceRegistry["sources"][number]) {
  const id = source.id.toLowerCase();
  const text = `${source.label} ${source.target} ${source.intent}`.toLowerCase();
  if (/india|bangalore|mumbai|delhi|nyc|bayarea|regional/.test(id) || /regional|city|local constraints/.test(text)) {
    return "regional";
  }
  if (
    /smallbusiness|small-business|ecommerce|shopify|etsy|freelance|seller|merchant/.test(id) ||
    /small business|ecommerce|shopify|etsy|freelance|seller|merchant/.test(text)
  ) {
    return "small-business";
  }
  if (/personalfinance|povertyfinance|jobs|consumer/.test(id) || /consumer|budget|affordability|labor market|jobs/.test(text)) {
    return "public-consumer";
  }
  if (/saas|startup|sideproject|entrepreneur|product-validation/.test(id) || /startup|validation|launch|distribution/.test(text)) {
    return "startup-builder";
  }
  if (/market|stripe|payments|commerce|cloudflare|github|google|openai|anthropic|rss-/.test(id)) {
    return "platform-primary";
  }
  return "ai-dev";
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<T, number>>(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    },
    {} as Record<T, number>,
  );
}

function acceptedRefreshRecords(records: ProductFlowRefreshRecord[]) {
  return latestRefreshRecords(records)
    .filter((record) => record.digest.sourceCount >= 2)
    .filter((record) => sourceRefreshPassesGate(record))
    .filter((record) => {
      const quality = communityDigestEvidenceQuality(record.digest);
      return quality.genericRisk !== "high" && quality.repeatedSignalCount >= 2;
    });
}

function sourceRecordKey(record: ProductFlowRefreshRecord) {
  return `${record.sourceId ?? record.label ?? record.target ?? record.source}:${record.period}`;
}

function sourceCoverageLines(input: {
  sourceRegistry: PersonalSourceRegistry;
  refreshes: ProductFlowRefreshRecord[];
}) {
  const accepted = acceptedRefreshRecords(input.refreshes);
  const registryById = new Map(input.sourceRegistry.sources.map((source) => [source.id, source]));
  const configuredByType = countBy(input.sourceRegistry.sources.map((source) => source.type));
  const configuredByClass = countBy(input.sourceRegistry.sources.map(sourceClass));
  const acceptedByType = countBy(accepted.map((record) => record.source));
  const acceptedByClass = countBy(
    accepted.map((record) => {
      const source = record.sourceId ? registryById.get(record.sourceId) : undefined;
      return source ? sourceClass(source) : "unknown";
    }),
  );
  const underlyingItems = accepted.reduce((sum, record) => sum + record.digest.sourceCount, 0);
  const latestAt = accepted.slice().sort((a, b) => b.digest.snapshotDate.localeCompare(a.digest.snapshotDate))[0]?.digest
    .snapshotDate;
  const skippedConfigured = input.sourceRegistry.sources.length - new Set(accepted.map(sourceRecordKey)).size;

  const formatCounts = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");

  return [
    `- Configured sources: ${input.sourceRegistry.sources.length}`,
    `- Accepted latest source snapshots: ${accepted.length}`,
    `- Underlying accepted items: ${underlyingItems}`,
    `- Latest accepted snapshot: ${latestAt ?? "none"}`,
    `- Configured by type: ${formatCounts(configuredByType)}`,
    `- Accepted by type: ${formatCounts(acceptedByType)}`,
    `- Configured by class: ${formatCounts(configuredByClass)}`,
    `- Accepted by class: ${formatCounts(acceptedByClass)}`,
    `- Configured sources without an accepted latest snapshot: ${skippedConfigured}`,
  ];
}

function sourceSnapshotSampleLines(input: {
  sourceRegistry: PersonalSourceRegistry;
  refreshes: ProductFlowRefreshRecord[];
}) {
  const registryById = new Map(input.sourceRegistry.sources.map((source) => [source.id, source]));
  const accepted = acceptedRefreshRecords(input.refreshes)
    .slice()
    .sort((a, b) => b.digest.snapshotDate.localeCompare(a.digest.snapshotDate));
  const classes = ["small-business", "public-consumer", "regional", "startup-builder", "platform-primary", "ai-dev"];
  return classes.flatMap((className) => {
    const records = accepted
      .filter((record) => {
        const source = record.sourceId ? registryById.get(record.sourceId) : undefined;
        return source ? sourceClass(source) === className : false;
      })
      .slice(0, 3);
    if (!records.length) return [`### ${className}`, "", "- No accepted snapshots.", ""];
    return [
      `### ${className}`,
      "",
      ...records.flatMap((record) => {
        const quality = communityDigestEvidenceQuality(record.digest);
        const notable = record.digest.summary?.notableDiscussions?.slice(0, 3) ?? [];
        return [
          `- ${record.label ?? record.sourceId ?? record.source}: ${record.digest.summary?.keyTrend?.title ?? record.digest.summaryText}`,
          `  - ${quality.genericRisk} risk, ${quality.repeatedSignalCount} repeats, ${record.digest.sourceCount} items`,
          ...(notable.length
            ? notable.map((item) => `  - ${compactReportText(item.title, 140)}${item.link ? ` (${item.link})` : ""}`)
            : []),
        ];
      }),
      "",
    ];
  });
}

function refreshRecordForEvidence(evidence: IdeaFlowEvidence, refreshes: ProductFlowRefreshRecord[]) {
  if (evidence.href.startsWith("/communities/")) {
    const [, , community = ""] = evidence.href.split("/");
    const normalizedCommunity = decodeURIComponent(community).toLowerCase();
    return acceptedRefreshRecords(refreshes).find((record) => {
      return (
        record.target?.toLowerCase() === normalizedCommunity ||
        record.subreddit?.toLowerCase() === normalizedCommunity ||
        record.label?.toLowerCase() === `r/${normalizedCommunity}`
      );
    });
  }
  if (evidence.href.startsWith("/")) return undefined;
  return acceptedRefreshRecords(refreshes).find((record) => {
    const sourceId = record.sourceId ?? record.label ?? record.target ?? "";
    const keyTrend = record.digest.summary?.keyTrend;
    return (
      (Boolean(sourceId) && evidence.id.includes(sourceId)) ||
      keyTrend?.link === evidence.href ||
      keyTrend?.desc === evidence.summary ||
      record.digest.summaryText === evidence.summary
    );
  });
}

function evidenceQualityLabel(evidence: IdeaFlowEvidence) {
  if (!evidence.quality) return `confidence ${evidence.confidence}`;
  return `confidence ${evidence.confidence}, risk ${evidence.quality.genericRisk}, repeats ${evidence.quality.repeatedSignalCount}, sources ${evidence.quality.sourceCount}`;
}

function recommendationEvidenceLines(input: {
  item: ReturnType<typeof buildPersonalCommandBrief>["recommendations"][number];
  refreshes: ProductFlowRefreshRecord[];
}) {
  if (!input.item.evidence.length) return ["- No evidence attached."];
  return input.item.evidence.slice(0, 5).flatMap((evidence, index) => {
    const record = refreshRecordForEvidence(evidence, input.refreshes);
    const notable = record?.digest.summary?.notableDiscussions?.slice(0, 3) ?? [];
    return [
      `- Evidence ${index + 1}: ${evidence.title}`,
      `  - ${evidenceQualityLabel(evidence)}`,
      `  - Summary: ${compactReportText(evidence.summary, 260)}`,
      `  - Link: ${evidence.href}`,
      ...(notable.length
        ? [
            "  - Underlying items:",
            ...notable.map((item) => `    - ${compactReportText(item.title, 140)}${item.link ? ` (${item.link})` : ""}`),
          ]
        : []),
    ];
  });
}

function evidenceAppendixLines(input: {
  brief: ReturnType<typeof buildPersonalCommandBrief>;
  refreshes: ProductFlowRefreshRecord[];
}) {
  const items = input.brief.recommendations
    .filter((item) => item.productSlug === "high-signal")
    .filter((item) => item.action === "build" || item.action === "change")
    .slice(0, 10);
  if (!items.length) return ["- No High Signal build/change recommendations."];
  return items.flatMap((item) => [
    `### ${item.title}`,
    "",
    `- ID: ${item.id}`,
    `- Layer: ${item.signalLayer}`,
    `- Score: ${item.score}`,
    `- Source diversity: ${item.sourceDiversity}`,
    ...recommendationEvidenceLines({ item, refreshes: input.refreshes }),
    "",
  ]);
}

function changeLine(item: ReturnType<typeof buildPersonalCommandBrief>["changeSummary"]["newRecommendations"][number]) {
  return `- new ${item.priority} / ${item.action} / score ${item.score}${item.decisionStatus ? `, decision ${item.decisionStatus}` : ""}: ${item.id}`;
}

function clusterLines(brief: ReturnType<typeof buildPersonalCommandBrief>) {
  if (!brief.complaintClusters.length) return ["- None"];
  return brief.complaintClusters.flatMap((cluster) => [
    `- ${cluster.confidence} / repeats ${cluster.repeatedSignalCount} / sources ${cluster.sourceCount}: ${cluster.title}`,
    `  - ${cluster.productImplication}`,
    ...(cluster.sampleTitles.length ? [`  - Samples: ${cluster.sampleTitles.join(" | ")}`] : []),
  ]);
}

function reelLines(brief: ReturnType<typeof buildPersonalCommandBrief>) {
  if (!brief.reelBriefs.length) return ["- None"];
  return brief.reelBriefs.flatMap((reel) => [
    `### ${reel.title}`,
    "",
    `- Recommendation: ${reel.recommendationId}`,
    `- Hook: ${reel.hook}`,
    `- Human tension: ${reel.humanTension}`,
    `- Proof beat: ${reel.proofBeat}`,
    `- Caption: ${reel.caption}`,
    `- CTA: ${reel.cta}`,
    `- Claim boundary: ${reel.claimBoundary}`,
    "",
    "Visual beats:",
    ...reel.visualBeats.map((beat) => `- ${beat}`),
    "",
    "Evidence:",
    ...reel.evidenceUrls.map((url) => `- ${url}`),
    "",
  ]);
}

function renderReport(input: {
  brief: ReturnType<typeof buildPersonalCommandBrief>;
  sourceRegistry: PersonalSourceRegistry;
  refreshes: ProductFlowRefreshRecord[];
}) {
  const { brief } = input;
  const reportDate = productDateString(new Date(brief.generatedAt));
  const todoTasks = brief.actionTasks.filter((item) => item.status === "todo");
  const worldChangeItems = brief.recommendations.filter((item) => item.signalLayer === "world-change").slice(0, 6);
  const appComplaintItems = brief.recommendations.filter((item) => item.signalLayer === "app-complaint").slice(0, 6);
  const marketItems = brief.recommendations.filter((item) => item.signalLayer === "market-watch").slice(0, 6);
  return [
    `# Personal Command Brief - ${reportDate}`,
    "",
    "## Snapshot",
    `- Generated: ${brief.generatedAt}`,
    `- Products tracked: ${brief.productsTracked}`,
    `- Recommendations: ${brief.recommendations.length}`,
    `- Accepted action tasks: ${todoTasks.length}`,
    `- Personal usefulness: ${brief.usefulnessAudit.score}/100 (${brief.usefulnessAudit.readiness})`,
    `- World-change evidence items: ${brief.evidenceBreakdown.worldChange}`,
    `- App-complaint evidence items: ${brief.evidenceBreakdown.appComplaint}`,
    `- Market-watch evidence items: ${brief.evidenceBreakdown.marketWatch}`,
    `- Feedback items: ${brief.feedbackCount}`,
    `- Decision items: ${brief.decisionCount}`,
    `- Latest evidence: ${brief.freshness.latestEvidenceAt ?? "none"}`,
    `- Evidence age days: ${brief.freshness.evidenceAgeDays ?? "unknown"}`,
    `- Noisy evidence items: ${brief.freshness.noisyEvidenceCount}`,
    `- Thin evidence items: ${brief.freshness.thinEvidenceCount}`,
    "",
    "## Data Coverage",
    ...sourceCoverageLines({ sourceRegistry: input.sourceRegistry, refreshes: input.refreshes }),
    "",
    "## Source Snapshot Samples",
    ...sourceSnapshotSampleLines({ sourceRegistry: input.sourceRegistry, refreshes: input.refreshes }),
    "",
    "## Freshness",
    ...(brief.freshness.warnings.length ? brief.freshness.warnings.map((warning) => `- ${warning}`) : ["- Fresh enough for a personal review pass."]),
    "",
    "## Usefulness Audit",
    ...(brief.usefulnessAudit.strengths.length
      ? brief.usefulnessAudit.strengths.map((strength) => `- Strength: ${strength}`)
      : ["- No strengths detected yet."]),
    ...(brief.usefulnessAudit.gaps.length
      ? brief.usefulnessAudit.gaps.map((gap) => `- Gap: ${gap}`)
      : ["- No gaps detected by the current audit."]),
    "",
    "## Changed Since Last Brief",
    `- Previous: ${brief.changeSummary.previousGeneratedAt ?? "none"}`,
    ...(brief.changeSummary.newRecommendations.length
      ? brief.changeSummary.newRecommendations.slice(0, 8).map(changeLine)
      : ["- No new recommendations."]),
    ...brief.changeSummary.actionChanged
      .slice(0, 8)
      .map((item) => `- action changed ${item.id}: ${item.before} -> ${item.after}`),
    ...brief.changeSummary.priorityChanged
      .slice(0, 8)
      .map((item) => `- priority changed ${item.id}: ${item.before} -> ${item.after}`),
    ...brief.changeSummary.scoreMoved
      .slice(0, 8)
      .map((item) => `- score moved ${item.id}: ${item.before} -> ${item.after}`),
    "",
    "## Repeated Complaint Clusters",
    ...clusterLines(brief),
    "",
    "## Evidence-Backed Reel Briefs",
    ...reelLines(brief),
    "",
    "## Top Recommendations",
    ...brief.topBuilds.map(recommendationLine),
    "",
    "## World-Level Changes",
    ...(worldChangeItems.length ? worldChangeItems.map(recommendationLine) : ["- None"]),
    "",
    "## Smaller App Complaint Trends",
    ...(appComplaintItems.length ? appComplaintItems.map(recommendationLine) : ["- None"]),
    "",
    "## Market Context",
    ...(marketItems.length ? marketItems.map(recommendationLine) : ["- None"]),
    "",
    "## Recommendation Evidence Appendix",
    ...evidenceAppendixLines({ brief, refreshes: input.refreshes }),
    "",
    "## Accepted Action Queue",
    ...(todoTasks.length ? todoTasks.flatMap((task) => [markdownTaskExport(task), ""]) : ["No accepted actions yet.", ""]),
    "## Task Sync",
    ...(todoTasks.length
      ? todoTasks.map((task) => `- ${task.syncStatus}${task.syncedTaskId ? ` / ${task.syncedTaskId}` : ""}: ${task.title}`)
      : ["- No accepted actions to sync."]),
    "",
    "## Watch Items",
    ...(brief.watchItems.length ? brief.watchItems.map(recommendationLine) : ["- None"]),
    "",
    "## Weekly Review Questions",
    ...brief.operatingQuestions.map((question) => `- ${question}`),
    "",
  ].join("\n");
}

async function writeReport(input: {
  brief: ReturnType<typeof buildPersonalCommandBrief>;
  sourceRegistry: PersonalSourceRegistry;
  refreshes: ProductFlowRefreshRecord[];
  appendLedgers?: boolean;
}) {
  await mkdir(REPORTS_DIR, { recursive: true });
  const path = resolve(REPORTS_DIR, `${productDateString(new Date(input.brief.generatedAt))}.md`);
  await writeFile(path, renderReport(input));
  await writePersonalReportIndex();
  if (input.appendLedgers === false) return path;
  await appendFile(BRIEF_SNAPSHOT_PATH, `${JSON.stringify(snapshotFromPersonalBrief(input.brief))}\n`);
  await appendFile(
    COMPLAINT_CLUSTER_LEDGER_PATH,
    `${JSON.stringify({ generatedAt: input.brief.generatedAt, clusters: input.brief.complaintClusters })}\n`,
  );
  await appendFile(
    REEL_BRIEF_LEDGER_PATH,
    `${JSON.stringify({ generatedAt: input.brief.generatedAt, reelBriefs: input.brief.reelBriefs })}\n`,
  );
  return path;
}

async function writePersonalReportIndex() {
  const files = (await readdir(REPORTS_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file)).sort();
  const reports = await Promise.all(
    files.map(async (file) => {
      const markdown = await readFile(resolve(REPORTS_DIR, file), "utf8");
      const date = file.replace(/\.md$/, "");
      const generatedAt = markdown.match(/^- Generated: (.+)$/m)?.[1] ?? null;
      const usefulness = markdown.match(/^- Personal usefulness: (.+)$/m)?.[1] ?? null;
      const recommendations = markdown.match(/^- Recommendations: (.+)$/m)?.[1] ?? null;
      const latestEvidence = markdown.match(/^- Latest evidence: (.+)$/m)?.[1] ?? null;
      return {
        date,
        generatedAt,
        usefulness,
        recommendations,
        latestEvidence,
        markdown,
      };
    }),
  );
  await writeFile(
    REPORT_INDEX_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), reports }, null, 2)}\n`,
  );
}

function latestBriefSnapshotBefore(snapshots: PersonalBriefSnapshot[], now: Date) {
  const nowIso = now.toISOString();
  return (
    snapshots
      .filter((snapshot) => snapshot.generatedAt < nowIso)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null
  );
}

function parseDateArg(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }
  return date;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer "${value}".`);
  }
  return parsed;
}

function daysBeforeToday(days: number) {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - 1 - index));
    return date;
  });
}

async function buildBrief(options: { now?: Date; previousSnapshot?: PersonalBriefSnapshot | null } = {}) {
  const [graph, seed, marketWatch, sourceRegistry] = await Promise.all([
    readJson<ProductGraph>(resolve(ROOT, "data/personal-product-graph.json")),
    readJson<ProductFlowSeed>(resolve(ROOT, "data/product-flow-seed.json")),
    readJson<MarketWatchConfig>(resolve(ROOT, "data/personal-market-watch.json")),
    readJson<PersonalSourceRegistry>(SOURCE_REGISTRY_PATH),
  ]);
  const now = options.now ?? new Date();
  const [feedback, decisions, taskSync, refreshes, marketRefreshes, snapshots] = await Promise.all([
    readFeedback(),
    readDecisions(),
    readTaskSync(),
    readSourceRefreshes(),
    readMarketRefreshes(),
    readBriefSnapshots(),
  ]);
  const evidence = [
    ...evidenceFromMarketRefreshes(marketRefreshes),
    ...evidenceFromMarketWatchConfig(marketWatch),
    ...evidenceFromRefreshes(refreshes),
    ...evidenceFromSeed(seed),
    ...fallbackFlows,
  ];
  const opportunities = generateProductOpportunities(evidence);
  const brief = buildPersonalCommandBrief({
    products: graph.products,
    opportunities,
    evidence,
    feedback,
    decisions,
    taskSync,
    previousSnapshot:
      "previousSnapshot" in options ? options.previousSnapshot : latestBriefSnapshotBefore(snapshots, now),
    now,
  });
  return { graph, seed, marketWatch, sourceRegistry, refreshes, opportunities, brief };
}

function parseProductAndOpportunity(input: {
  recommendationId: string;
  products: PersonalProductProfile[];
}) {
  const product = input.products
    .slice()
    .sort((a, b) => b.slug.length - a.slug.length)
    .find((item) => input.recommendationId.startsWith(`${item.slug}-`));
  const opportunityId = product ? input.recommendationId.slice(product.slug.length + 1) : "";
  return { product, opportunityId };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "feedback") {
    const [recommendationId = "", label = "", action = "watch", note = ""] = args;
    if (!recommendationId || !isFeedbackLabel(label) || !isAction(action)) {
      console.error(
        "Usage: pnpm personal:brief feedback <recommendationId> <useful|obvious|wrong|build|ignore> <build|change|watch|pause> [note]",
      );
      process.exit(1);
    }
    const graph = await readJson<ProductGraph>(resolve(ROOT, "data/personal-product-graph.json"));
    const { product, opportunityId } = parseProductAndOpportunity({
      recommendationId,
      products: graph.products,
    });
    if (!product || !opportunityId) {
      console.error("recommendationId must match a known product slug, e.g. high-signal-agent-evaluation");
      process.exit(1);
    }
    const entry: PersonalRecommendationFeedback = {
      recommendationId,
      productSlug: product.slug,
      opportunityId,
      action,
      label,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    await appendFile(FEEDBACK_PATH, `${JSON.stringify(entry)}\n`);
    console.log(`Recorded feedback: ${recommendationId} -> ${label}`);
    return;
  }

  if (command === "decide") {
    const [recommendationId = "", status = "", action = "watch", note = ""] = args;
    if (!recommendationId || !isDecisionStatus(status) || !isAction(action)) {
      console.error(
        "Usage: pnpm personal:brief decide <recommendationId> <accepted|deferred|rejected|done> <build|change|watch|pause> [note]",
      );
      process.exit(1);
    }
    const { graph, opportunities } = await buildBrief();
    const { product, opportunityId } = parseProductAndOpportunity({
      recommendationId,
      products: graph.products,
    });
    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!product || !opportunity) {
      console.error("recommendationId must match a known product/opportunity pair in the current brief.");
      process.exit(1);
    }
    const entry: PersonalRecommendationDecision = {
      recommendationId,
      productSlug: product.slug,
      opportunityId,
      action,
      status,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    await appendFile(DECISIONS_PATH, `${JSON.stringify(entry)}\n`);
    console.log(`Recorded decision: ${recommendationId} -> ${status}`);
    return;
  }

  const { brief, seed, marketWatch, sourceRegistry, refreshes } = await buildBrief();
  if (command === "refresh-sources") {
    await refreshSources(seed, sourceRegistry);
    return;
  }
  if (command === "refresh-markets") {
    await refreshMarkets(marketWatch);
    return;
  }
  if (command === "tasks") {
    printTaskExport(brief.actionTasks);
    return;
  }
  if (command === "sync-tasks") {
    await syncAcceptedTasks(brief.actionTasks, args.includes("--apply"));
    return;
  }
  if (command === "report") {
    const dateArgIndex = args.indexOf("--date");
    const dateArg = dateArgIndex >= 0 ? args[dateArgIndex + 1] : undefined;
    if (dateArgIndex >= 0 && !dateArg) {
      console.error("Usage: pnpm personal:brief report [--date YYYY-MM-DD]");
      process.exit(1);
    }
    const datedBrief = dateArg ? (await buildBrief({ now: parseDateArg(dateArg) })).brief : brief;
    const path = await writeReport({ brief: datedBrief, sourceRegistry, refreshes });
    console.log(`Wrote ${path}`);
    return;
  }
  if (command === "backfill-reports") {
    const daysArgIndex = args.indexOf("--days");
    const days = parsePositiveInt(daysArgIndex >= 0 ? args[daysArgIndex + 1] : undefined, 30);
    let previousSnapshot: PersonalBriefSnapshot | null = null;
    const paths: string[] = [];
    for (const now of daysBeforeToday(days)) {
      const result = await buildBrief({ now, previousSnapshot });
      const path = await writeReport({
        brief: result.brief,
        sourceRegistry: result.sourceRegistry,
        refreshes: result.refreshes,
        appendLedgers: false,
      });
      previousSnapshot = snapshotFromPersonalBrief(result.brief);
      paths.push(path);
    }
    await writePersonalReportIndex();
    console.log(`Backfilled ${paths.length} personal reports.`);
    console.log(paths.join("\n"));
    return;
  }
  printBrief(brief);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
