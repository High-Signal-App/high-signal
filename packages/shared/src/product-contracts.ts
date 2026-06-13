export type AIPlatform = "openai" | "anthropic" | "google" | "perplexity" | "custom";
export type ProductSurface = "mentions" | "communities" | "markets" | "agent-eval";
export type WorkflowStatus = "draft" | "running" | "completed" | "failed";

export interface CompetitorProfile {
  name: string;
  url?: string;
}

export interface MentionBrandConfig {
  id: string;
  companyId: string;
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: CompetitorProfile[];
  platforms: AIPlatform[];
  aiEndpointUrl: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MentionPrompt {
  id: string;
  companyId: string;
  promptText: string;
  category: string | null;
  createdAt: string;
}

export interface MentionCheck {
  id: string;
  companyId: string;
  configId: string;
  status: Exclude<WorkflowStatus, "draft">;
  totalQueries: number;
  completedQueries: number;
  brandMentionRate: number | null;
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MentionDashboardSnapshot {
  configs: MentionBrandConfig[];
  prompts: MentionPrompt[];
  recentChecks: MentionCheck[];
}

export type RedditPeriod = "day" | "week" | "month";
export type CommunitySourceId = readonly [postId: string, commentId?: string];

export interface TrackedCommunity {
  id: string;
  ownerId: string;
  subreddit: string;
  prompt: string | null;
  period: RedditPeriod;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunitySummaryItem {
  title: string;
  desc: string;
  sourceId?: CommunitySourceId;
  link?: string;
}

export interface CommunitySummary {
  keyTrend?: CommunitySummaryItem;
  notableDiscussions: CommunitySummaryItem[];
  keyAction?: CommunitySummaryItem;
}

export interface CommunityDigestSnapshot {
  id: string;
  subreddit: string;
  period: RedditPeriod;
  snapshotDate: string;
  summaryText: string;
  summary: CommunitySummary | null;
  promptUsed: string;
  sourceCount: number;
  createdAt: string;
}

export interface ProductDashboardSnapshot {
  ownerId: string;
  mentions: MentionDashboardSnapshot;
  communities: {
    tracked: TrackedCommunity[];
    latestDigests: CommunityDigestSnapshot[];
  };
}

export function normalizeCommunitySourceId(value: unknown): CommunitySourceId | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const postId = `${value[0] ?? ""}`.trim();
  const commentId = `${value[1] ?? ""}`.trim();
  if (!postId) return undefined;
  return commentId ? [postId, commentId] : [postId];
}

export function redditSourceLink(
  subreddit: string,
  sourceId: CommunitySourceId | undefined,
): string | undefined {
  if (!sourceId) return undefined;
  const [postId, commentId] = sourceId;
  if (commentId) return `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}`;
  return `https://www.reddit.com/r/${subreddit}/comments/${postId}`;
}

function normalizeSummaryItem(value: unknown): CommunitySummaryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = `${raw["title"] ?? ""}`.trim();
  const desc = `${raw["desc"] ?? ""}`.trim();
  if (!title && !desc) return null;
  const sourceId = normalizeCommunitySourceId(raw["sourceId"]);
  const link = `${raw["link"] ?? ""}`.trim();
  return {
    title: title || "Untitled signal",
    desc,
    sourceId,
    link: /^https?:\/\//i.test(link) ? link : undefined,
  };
}

function deriveAction(item: CommunitySummaryItem | null): CommunitySummaryItem | undefined {
  if (!item) return undefined;
  const desc = (item.desc || item.title).trim();
  if (!desc) return undefined;
  return { title: "Key Action", desc, sourceId: item.sourceId, link: item.link };
}

export function normalizeCommunitySummary(value: unknown): CommunitySummary | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeSummaryItem(item))
      .filter((item): item is CommunitySummaryItem => Boolean(item));
    if (items.length === 0) return null;
    const keyTrend = items[0];
    const notableDiscussions = items.slice(1, Math.max(items.length - 1, 1));
    return {
      keyTrend,
      notableDiscussions,
      keyAction: deriveAction(items.at(-1) ?? keyTrend),
    };
  }

  if (typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keyTrend = normalizeSummaryItem(raw["key_trend"] ?? raw["overview"]);
  const keyAction =
    normalizeSummaryItem(raw["key_action"] ?? raw["actionable_takeaway"] ?? raw["action_item"]) ??
    deriveAction(keyTrend);
  const notableRaw = Array.isArray(raw["notable_discussions"])
    ? raw["notable_discussions"]
    : Array.isArray(raw["discussion_points"])
      ? raw["discussion_points"]
      : [];
  const notableDiscussions = notableRaw
    .map((item) => normalizeSummaryItem(item))
    .filter((item): item is CommunitySummaryItem => Boolean(item));

  if (!keyTrend && notableDiscussions.length === 0 && !keyAction) return null;
  return {
    keyTrend: keyTrend ?? undefined,
    notableDiscussions,
    keyAction: keyAction ?? undefined,
  };
}
