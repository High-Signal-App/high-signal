import type { MetadataRoute } from "next";

import { api } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // Static routes ordered roughly by importance. The brief (`/`) is the
  // product, hourly because it recomposes; the lenses change less often.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE_URL}/brief`, lastModified: now, changeFrequency: "hourly", priority: 0.95 },
    { url: `${SITE_URL}/track-record`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/signals`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/signals/today`, lastModified: now, changeFrequency: "hourly", priority: 0.85 },
    { url: `${SITE_URL}/digest`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/markets`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/communities`, lastModified: now, changeFrequency: "daily", priority: 0.75 },
    { url: `${SITE_URL}/mentions`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/agent-eval`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/lab`, lastModified: now, changeFrequency: "daily", priority: 0.65 },
    { url: `${SITE_URL}/entities`, lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    { url: `${SITE_URL}/sectors`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/opportunities`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/ideas`, lastModified: now, changeFrequency: "weekly", priority: 0.55 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/digest/rss`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
    { url: `${SITE_URL}/digest/atom`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
    { url: `${SITE_URL}/signals/rss`, lastModified: now, changeFrequency: "hourly", priority: 0.4 },
    { url: `${SITE_URL}/signals/atom`, lastModified: now, changeFrequency: "hourly", priority: 0.4 },
  ];

  let signalEntries: MetadataRoute.Sitemap = [];
  let entityEntries: MetadataRoute.Sitemap = [];
  try {
    const { signals } = await api.signals();
    signalEntries = signals
      .filter((signal) => !isBackfillSignal(signal))
      .slice(0, 1000)
      .map((s) => ({
        url: `${SITE_URL}/signals/${s.slug}`,
        lastModified: new Date(s.publishedAt),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      }));
  } catch {
    /* API offline — return static-only sitemap. */
  }
  try {
    const { entities } = await api.entities();
    entityEntries = entities.slice(0, 500).map((e) => ({
      url: `${SITE_URL}/entities/${e.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  } catch {
    /* API offline */
  }

  return [...staticRoutes, ...signalEntries, ...entityEntries];
}
