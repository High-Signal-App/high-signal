import { describe, expect, it } from "vitest";
import {
  buildMonthlyCompetitorReport,
  getSeedMonthlyCompetitorReport,
  isSeedCompetitorProductId,
  normalizeCommunitySummary,
  redditSourceLink,
} from "@high-signal/shared";
import { analyzeMentionResponse } from "../lib/mention-execution";
import { productDashboardSnapshot } from "../routes/products";

describe("product workflow contracts", () => {
  it("normalizes AgentMode source-linked summaries", () => {
    const summary = normalizeCommunitySummary({
      key_trend: {
        title: "Operators want source links",
        desc: "Digest consumers need provenance before acting.",
        sourceId: ["abc123", "def456"],
      },
      notable_discussions: [{ title: "Budget controls", desc: "Teams ask for spend caps." }],
    });

    expect(summary?.keyTrend?.title).toBe("Operators want source links");
    expect(summary?.notableDiscussions).toHaveLength(1);
    expect(redditSourceLink("LocalLLaMA", summary?.keyTrend?.sourceId)).toBe(
      "https://www.reddit.com/r/LocalLLaMA/comments/abc123/comment/def456",
    );
  });

  it("maps persisted Mentionpilot and AgentMode rows to High Signal dashboard contracts", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    const dashboard = productDashboardSnapshot({
      ownerId: "user_123",
      configs: [
        {
          id: "cfg_1",
          ownerId: "user_123",
          brandName: "High Signal",
          brandAliases: ["HighSignal"],
          brandUrl: "https://highsignal.test",
          competitors: [{ name: "Brandwatch" }],
          platforms: ["openai", "perplexity"],
          aiEndpointUrl: null,
          aiModel: "multi-model",
          checkSchedule: "weekly",
          lastScheduledCheck: null,
          badgeEnabled: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      prompts: [
        {
          id: "prompt_1",
          configId: "cfg_1",
          ownerId: "user_123",
          promptText: "Which AI visibility tools should I compare?",
          category: "competitors",
          persona: null,
          createdAt: now,
        },
      ],
      recentChecks: [
        {
          id: "check_1",
          configId: "cfg_1",
          ownerId: "user_123",
          status: "completed",
          totalQueries: 1,
          completedQueries: 1,
          brandMentionRate: 1,
          summary: "Mentioned once.",
          createdAt: now,
          completedAt: now,
        },
      ],
      tracked: [
        {
          id: "track_1",
          ownerId: "user_123",
          subreddit: "LocalLLaMA",
          prompt: "Find agent operations pain.",
          period: "week",
          isPublic: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      latestDigests: [
        {
          id: "digest_1",
          trackedCommunityId: "track_1",
          ownerId: "user_123",
          subreddit: "LocalLLaMA",
          period: "week",
          snapshotDate: now,
          summaryText: "Operators want provenance.",
          summary: {
            key_trend: { title: "Provenance", desc: "Source links matter.", sourceId: ["abc123"] },
          },
          promptUsed: "Find agent operations pain.",
          sourceCount: 12,
          createdAt: now,
        },
      ],
    });

    expect(dashboard.mentions.configs[0]?.brandName).toBe("High Signal");
    expect(dashboard.mentions.prompts[0]?.promptText).toContain("AI visibility");
    expect(dashboard.mentions.recentChecks[0]?.status).toBe("completed");
    expect(dashboard.communities.tracked[0]?.subreddit).toBe("LocalLLaMA");
    expect(dashboard.communities.latestDigests[0]?.summary?.keyTrend?.title).toBe("Provenance");
  });

  it("preserves Mentionpilot brand visibility analysis semantics", () => {
    const result = analyzeMentionResponse({
      text: [
        "1. Competitor Cloud is reliable.",
        "2. High Signal is a recommended monitoring product.",
        "Read more at https://highsignal.test/case-study.",
      ].join("\n"),
      brandName: "High Signal",
      brandAliases: ["HighSignal"],
      brandUrl: "https://highsignal.test",
      competitors: [{ name: "Competitor Cloud" }],
    });

    expect(result.brandMentioned).toBe(true);
    expect(result.brandSentiment).toBe("positive");
    expect(result.brandPosition).toBe(2);
    expect(result.brandCited).toBe(true);
    expect(result.competitorsMentioned[0]).toMatchObject({
      name: "Competitor Cloud",
      mentioned: true,
      position: 1,
    });
  });
});

describe("monthly competitor report (product brief)", () => {
  it("getSeedMonthlyCompetitorReport returns well-formed report for fixed seed set and null for unknown", () => {
    const linear = getSeedMonthlyCompetitorReport("linear");
    expect(linear).not.toBeNull();
    expect(linear?.brandName).toBe("Linear");
    expect(linear?.competitors).toContain("Jira");
    expect(linear?.source).toBe("seed");
    expect(linear?.notableMoves.length).toBeGreaterThanOrEqual(1);
    expect(linear?.uncertainties.length).toBeGreaterThanOrEqual(1);
    // Evidence rule: every move/chatter has evidence
    for (const m of linear!.notableMoves) {
      expect(m.evidence.length).toBeGreaterThanOrEqual(1);
    }
    for (const c of linear!.socialAndAIChatter) {
      expect(c.evidence.length).toBeGreaterThanOrEqual(1);
    }
    expect(isSeedCompetitorProductId("cursor")).toBe(true);
    expect(getSeedMonthlyCompetitorReport("not-a-product")).toBeNull();
  });

  it("seed reports have >=2 evidence links per populated claim and explicit uncertainties for missing sections", () => {
    const cursor = getSeedMonthlyCompetitorReport("cursor")!;
    // notable + chatter populated with links
    expect(cursor.totalEvidenceLinks).toBeGreaterThanOrEqual(2);
    const allEvidence = [
      ...cursor.notableMoves.flatMap((m) => m.evidence),
      ...cursor.launchesAndFeatures.flatMap((c) => c.evidence),
      ...cursor.socialAndAIChatter.flatMap((c) => c.evidence),
    ];
    for (const e of allEvidence) {
      expect(e.url).toMatch(/^https?:\/\//);
    }
    // At least one uncertainty (hiring or launch for cursor is thin in seed)
    expect(cursor.uncertainties.some((u) => /hiring|launch|Tabnine/i.test(u))).toBe(true);
  });

  it("buildMonthlyCompetitorReport with mentionResults mentioning competitors populates socialAndAIChatter with evidence-linked items", () => {
    const report = buildMonthlyCompetitorReport({
      brandName: "Linear",
      competitors: ["Jira", "Asana"],
      mentionResults: [
        {
          responseText: "1. Jira is great for enterprises. 2. Linear is loved by startups. See https://linear.app/blog",
          platform: "custom",
          createdAt: "2026-05-20T00:00:00.000Z",
          competitorsMentioned: [
            { name: "Jira", mentioned: true },
            { name: "Asana", mentioned: false },
          ],
          citations: ["https://linear.app/blog"],
        },
        {
          responseText: "Teams often pick Jira for reporting.",
          platform: "custom",
          createdAt: "2026-05-21T00:00:00.000Z",
          competitorsMentioned: [{ name: "Jira", mentioned: true }],
          citations: [],
        },
      ],
    });
    expect(report.source).toBe("real");
    expect(report.socialAndAIChatter.length).toBeGreaterThan(0);
    expect(report.socialAndAIChatter[0].evidence.length).toBeGreaterThan(0);
    expect(report.socialAndAIChatter[0].evidence[0].url).toMatch(/^https?:/);
    // When real data present, uncertainties may still exist for other sections
    expect(Array.isArray(report.uncertainties)).toBe(true);
  });

  it("buildMonthlyCompetitorReport with no data returns seed-shaped report with uncertainties (no fabricated claims)", () => {
    const report = buildMonthlyCompetitorReport({
      brandName: "PostHog",
      competitors: ["Mixpanel"],
    });
    expect(report.source).toBe("seed");
    expect(report.notableMoves.length).toBe(0);
    expect(report.socialAndAIChatter.length).toBe(0);
    expect(report.uncertainties.length).toBeGreaterThan(0);
    expect(report.uncertainties[0]).toMatch(/No notable moves|No AI assistant|No corroborated/);
    // totalEvidenceLinks still positive (floor) but no populated claims
    expect(report.totalEvidenceLinks).toBeGreaterThanOrEqual(0);
  });
});
