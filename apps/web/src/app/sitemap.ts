import type { MetadataRoute } from "next";

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

const siteUrl = "https://high-signal-web.sarthakagrawal927.workers.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/signals`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/digest`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/track-record`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/digest/rss`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${siteUrl}/signals/rss`, lastModified: now, changeFrequency: "hourly", priority: 0.5 },
  ];

  let signalEntries: MetadataRoute.Sitemap = [];
  try {
    const { signals } = await api.signals();
    signalEntries = signals.slice(0, 1000).map((s) => ({
      url: `${siteUrl}/signals/${s.slug}`,
      lastModified: new Date(s.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));
  } catch {
    /* API offline — return static-only sitemap. */
  }

  return [...staticRoutes, ...signalEntries];
}
