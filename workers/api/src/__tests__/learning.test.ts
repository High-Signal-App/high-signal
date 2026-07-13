import { describe, expect, it } from "vitest";
import type { BriefSnapshot } from "@high-signal/shared";
import { buildLearningBriefFeed } from "../routes/learning";

const snapshot: BriefSnapshot = {
  generatedAt: "2026-07-13T10:00:00.000Z",
  region: "global",
  hasBrand: true,
  stocks: [{
    entityId: "entity-a", entityName: "Acme", ticker: "ACME", country: "US",
    signalType: "adoption", signalFamily: "ai-adoption", direction: "up", confidence: "high",
    predictedWindowDays: 30, headline: "Acme adoption is accelerating", signalSlug: "acme-adoption",
    publishedAt: "2026-07-13T08:00:00.000Z", evidenceUrls: [{ url: "https://example.com/evidence" }],
    hitRate: 0.8, hitRateSample: 10, hitRateBand: "direct",
  }],
  ideas: [{
    title: "Build a verification layer", description: "Teams need evidence they can inspect.", source: "community",
    region: "global", evidenceUrls: [{ url: "https://example.com/idea" }], subreddit: "SaaS",
    surfacedAt: "2026-07-13T07:00:00.000Z",
  }],
  trends: [{
    title: "Local-first workflows", description: "Operators are choosing local control.", subreddit: "selfhosted",
    region: "global", evidenceUrls: [{ url: "https://example.com/trend" }], surfacedAt: "2026-07-13T06:00:00.000Z",
  }],
  // These fields are intentionally populated to prove the compact feed never
  // leaks owner-specific brand sections.
  perception: [{ brandName: "Private Brand", mentionRate: 1, positiveShare: 1, competitorPresence: 0, latestCheckAt: null, configId: "secret-config" }],
  improvements: [{ brandName: "Private Brand", area: "private", task: "secret task", priority: "high", auditId: "secret-audit", surfacedAt: "2026-07-13T00:00:00.000Z" }],
};

describe("High Signal learning brief", () => {
  it("emits a compact source-backed feed without private brand content", () => {
    const feed = buildLearningBriefFeed(snapshot);
    expect(feed.schema).toBe("high-signal.learning-brief.v1");
    expect(feed.items.map((item) => item.id)).toEqual([
      "stock:acme-adoption",
      "idea:build-a-verification-layer:2026-07-13",
      "trend:local-first-workflows:2026-07-13",
    ]);
    expect(feed.items.every((item) => item.citations.length > 0)).toBe(true);
    expect(JSON.stringify(feed)).not.toContain("Private Brand");
    expect(JSON.stringify(feed)).not.toContain("secret-config");
  });

  it("preserves an empty but valid feed when no public brief items exist", () => {
    const feed = buildLearningBriefFeed({ ...snapshot, stocks: [], ideas: [], trends: [] });
    expect(feed.items).toEqual([]);
    expect(feed.generatedAt).toBe(snapshot.generatedAt);
  });
});
