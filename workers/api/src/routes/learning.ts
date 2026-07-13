import type { BriefCitation, BriefSnapshot } from "@high-signal/shared";
import { Hono } from "hono";
import { briefRoute } from "./brief";

type Env = { DB: D1Database; BRIEF_CACHE?: KVNamespace };

export interface LearningBriefItem {
  id: string;
  title: string;
  summary: string;
  canonicalUrl: string;
  publishedAt: string;
  tracks: string[];
  citations: BriefCitation[];
}

export interface LearningBriefFeed {
  schema: "high-signal.learning-brief.v1";
  generatedAt: string;
  canonicalUrl: string;
  items: LearningBriefItem[];
}

export const learningRoute = new Hono<{ Bindings: Env }>();

learningRoute.get("/daily", async (c) => {
  // Reuse the canonical public brief composition in-process. This deliberately
  // excludes owner/product parameters so private brand sections cannot enter
  // the learning feed.
  const response = await briefRoute.request("/daily?region=global", undefined, c.env);
  if (!response.ok) return c.json({ error: "Daily brief unavailable" }, 502);
  const snapshot = (await response.json()) as BriefSnapshot;
  return c.json(buildLearningBriefFeed(snapshot), 200, {
    "cache-control": "public, max-age=300, stale-while-revalidate=3600",
  });
});

export function buildLearningBriefFeed(snapshot: BriefSnapshot): LearningBriefFeed {
  const stock = snapshot.stocks[0];
  const idea = snapshot.ideas[0];
  const trend = snapshot.trends[0];
  const items: LearningBriefItem[] = [];

  if (stock) {
    items.push({
      id: `stock:${stock.signalSlug}`,
      title: stock.headline,
      summary: `${stock.entityName}: ${stock.direction} signal with ${stock.confidence} confidence.`,
      canonicalUrl: `https://highsignal.app/signals/${encodeURIComponent(stock.signalSlug)}`,
      publishedAt: stock.publishedAt,
      tracks: ["technology", "markets", stock.signalFamily],
      citations: sanitizeCitations(stock.evidenceUrls),
    });
  }
  if (idea) {
    items.push({
      id: `idea:${stableSlug(idea.title)}:${day(idea.surfacedAt)}`,
      title: idea.title,
      summary: bounded(idea.opportunity?.problem ?? idea.description),
      canonicalUrl: "https://highsignal.app/brief#ideas",
      publishedAt: idea.surfacedAt,
      tracks: ["startups", "product", "opportunities"],
      citations: sanitizeCitations(idea.evidenceUrls),
    });
  }
  if (trend) {
    items.push({
      id: `trend:${stableSlug(trend.title)}:${day(trend.surfacedAt)}`,
      title: trend.title,
      summary: bounded(trend.description),
      canonicalUrl: "https://highsignal.app/brief#trends",
      publishedAt: trend.surfacedAt,
      tracks: ["technology", "startups", "trends"],
      citations: sanitizeCitations(trend.evidenceUrls),
    });
  }

  return {
    schema: "high-signal.learning-brief.v1",
    generatedAt: snapshot.generatedAt,
    canonicalUrl: "https://highsignal.app/brief",
    items,
  };
}

function sanitizeCitations(citations: BriefCitation[]): BriefCitation[] {
  return citations
    .filter((citation) => citation?.url?.startsWith("http://") || citation?.url?.startsWith("https://"))
    .slice(0, 6)
    .map((citation) => ({ url: citation.url, source: citation.source ?? null }));
}

function bounded(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 360);
}

function stableSlug(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function day(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : "unknown";
}
