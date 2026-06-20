import { fetchChatCompletion, type AIConfig } from "./openai-chat";
import { normalizeCommunitySummary } from "@high-signal/shared";
import type { CommunitySummary } from "@high-signal/shared";
import type { DB } from "../db";
import { schema } from "../db";

type Env = {
  HIGH_SIGNAL_AI_ENDPOINT_URL?: string;
  HIGH_SIGNAL_AI_API_KEY?: string;
  HIGH_SIGNAL_AI_MODEL?: string;
  OPENAI_API_KEY?: string;
};

type TrackedCommunityRow = typeof schema.trackedCommunities.$inferSelect;

type RedditPost = {
  id: string;
  title: string;
  selftext: string;
  score: number;
  comments: Array<{ id: string; body: string; score: number }>;
};

const DEFAULT_PROMPTS: Record<string, string> = {
  localllama:
    "Show the highest-signal posts and comments about running strong local LLM stacks, and extract repeatable setups people confirm working in practice.",
  langchain:
    "Summarize production-ready patterns, common failure modes, and practical implementation tips for building LLM apps with LangChain.",
  ai_agents:
    "Summarize agent systems that are actually working end-to-end today, including architecture, tooling, and operational blockers.",
  startups:
    "Summarize proven founder tactics for validation, user acquisition, pricing, and early revenue generation.",
};

export async function generateCommunityDigest(input: {
  database: DB;
  env: Env;
  tracked: TrackedCommunityRow;
}) {
  const posts = await fetchTopPosts(input.tracked.subreddit, input.tracked.period);
  const prompt = input.tracked.prompt || defaultPrompt(input.tracked.subreddit);
  const summary = await summarizePosts({
    env: input.env,
    subreddit: input.tracked.subreddit,
    period: input.tracked.period,
    prompt,
    posts,
  });
  const [row] = await input.database
    .insert(schema.communityDigestSnapshots)
    .values({
      id: crypto.randomUUID(),
      trackedCommunityId: input.tracked.id,
      ownerId: input.tracked.ownerId,
      subreddit: input.tracked.subreddit,
      period: input.tracked.period,
      snapshotDate: new Date(),
      summaryText: summary.summaryText,
      summary: summary.summary,
      promptUsed: prompt,
      sourceCount: posts.length + posts.reduce((sum, post) => sum + post.comments.length, 0),
      createdAt: new Date(),
    })
    .returning();
  return row;
}

async function summarizePosts(input: {
  env: Env;
  subreddit: string;
  period: "day" | "week" | "month";
  prompt: string;
  posts: RedditPost[];
}): Promise<{ summaryText: string; summary: CommunitySummary | null }> {
  const aiConfig = resolveEndpointConfig(input.env);
  if (!aiConfig || input.posts.length === 0) return fallbackSummary(input);

  const payload = JSON.stringify({
    subreddit: input.subreddit,
    period: input.period,
    posts: input.posts.slice(0, 12).map((post) => ({
      id: post.id,
      title: post.title,
      selftext: post.selftext.slice(0, 900),
      score: post.score,
      comments: post.comments.slice(0, 6).map((comment) => ({
        id: comment.id,
        score: comment.score,
        body: comment.body.slice(0, 360),
      })),
    })),
  });

  const response = await fetchChatCompletion({
    config: aiConfig,
    stream: false,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          "Return compact JSON with key_trend, notable_discussions, and key_action. Each point needs title, desc, and sourceId as [postId] or [postId, commentId]. No markdown.",
      },
      { role: "user", content: `${input.prompt}\n\n${payload}` },
    ],
  });
  if (!response.ok) return fallbackSummary(input);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  const structured = parseSummary(text) ?? fallbackSummary(input).summary;
  const summary = normalizeCommunitySummary(structured);
  return {
    summaryText: summary?.keyTrend?.desc || text.slice(0, 500) || fallbackSummary(input).summaryText,
    summary,
  };
}

async function fetchTopPosts(subreddit: string, period: "day" | "week" | "month") {
  const response = await fetch(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?${new URLSearchParams({
      t: period,
      limit: "12",
    })}`,
    { headers: { "User-Agent": "HighSignal/1.0 (community research)" } },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  return Promise.all(
    (data.data?.children ?? []).map(async (child) => {
      const post = child.data ?? {};
      const id = `${post["id"] ?? ""}`;
      return {
        id,
        title: `${post["title"] ?? ""}`,
        selftext: `${post["selftext"] ?? ""}`,
        score: Number(post["score"] ?? 0),
        comments: id ? await fetchTopComments(subreddit, id) : [],
      };
    }),
  );
}

async function fetchTopComments(subreddit: string, postId: string) {
  try {
    const response = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${postId}.json?limit=8&sort=top`,
      { headers: { "User-Agent": "HighSignal/1.0 (community research)" } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    }>;
    return (data[1]?.data?.children ?? [])
      .map((child) => child.data ?? {})
      .filter((comment) => typeof comment["body"] === "string")
      .map((comment) => ({
        id: `${comment["id"] ?? ""}`,
        body: `${comment["body"] ?? ""}`,
        score: Number(comment["score"] ?? 0),
      }));
  } catch {
    return [];
  }
}

function fallbackSummary(input: {
  subreddit: string;
  period: "day" | "week" | "month";
  prompt: string;
  posts: RedditPost[];
}) {
  const topPost = input.posts[0];
  const title = topPost?.title || `r/${input.subreddit} ${input.period} signal`;
  const desc = topPost
    ? `Top discussion: ${topPost.title}`
    : `No Reddit posts were available for r/${input.subreddit} during the ${input.period} window.`;
  return {
    summaryText: desc,
    summary: normalizeCommunitySummary({
      key_trend: { title, desc, sourceId: topPost?.id ? [topPost.id] : undefined },
      notable_discussions: input.posts.slice(1, 4).map((post) => ({
        title: post.title,
        desc: post.selftext || `${post.score} points`,
        sourceId: [post.id],
      })),
      key_action: {
        title: "Review source threads",
        desc: input.prompt,
        sourceId: topPost?.id ? [topPost.id] : undefined,
      },
    }),
  };
}

function parseSummary(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function resolveEndpointConfig(env: Env): AIConfig | null {
  const apiKey = env.HIGH_SIGNAL_AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    endpointUrl: env.HIGH_SIGNAL_AI_ENDPOINT_URL || "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: env.HIGH_SIGNAL_AI_MODEL || "gpt-4o-mini",
  };
}

function defaultPrompt(subreddit: string) {
  return (
    DEFAULT_PROMPTS[subreddit.toLowerCase()] ||
    `Analyze top posts and comments for r/${subreddit}. Summarize key themes, actionable insights, and representative source-linked evidence.`
  );
}
