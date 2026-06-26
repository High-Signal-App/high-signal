import type { MetadataRoute } from 'next';

import { api } from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // Static routes ordered roughly by importance. The brief (`/`) is the
  // product, hourly because it recomposes; the lenses change less often.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'hourly', priority: 1.0 },
    { url: `${SITE_URL}/brief`, lastModified: now, changeFrequency: 'hourly', priority: 0.95 },
    { url: `${SITE_URL}/track-record`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/signals`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    {
      url: `${SITE_URL}/signals/today`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.85,
    },
    { url: `${SITE_URL}/digest`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/markets`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/communities`, lastModified: now, changeFrequency: 'daily', priority: 0.75 },
    { url: `${SITE_URL}/mentions`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/agent-eval`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/lab`, lastModified: now, changeFrequency: 'daily', priority: 0.65 },
    { url: `${SITE_URL}/entities`, lastModified: now, changeFrequency: 'weekly', priority: 0.65 },
    { url: `${SITE_URL}/sectors`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${SITE_URL}/opportunities`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    { url: `${SITE_URL}/ideas`, lastModified: now, changeFrequency: 'weekly', priority: 0.55 },
    {
      url: `${SITE_URL}/methodology`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/signals/types`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.75,
    },
    {
      url: `${SITE_URL}/agent-eval/seo`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/digest/rss`, lastModified: now, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/digest/atom`, lastModified: now, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/signals/rss`, lastModified: now, changeFrequency: 'hourly', priority: 0.4 },
    {
      url: `${SITE_URL}/signals/atom`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.4,
    },
  ];

  let signalEntries: MetadataRoute.Sitemap = [];
  let entityEntries: MetadataRoute.Sitemap = [];
  let entityMonthEntries: MetadataRoute.Sitemap = [];
  let signalTypeEntries: MetadataRoute.Sitemap = [];

  let allSignals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  try {
    const data = await api.signals({ limit: 1000 });
    allSignals = data.signals;
    signalEntries = allSignals
      .filter((signal) => !isBackfillSignal(signal))
      .slice(0, 1000)
      .map((s) => ({
        url: `${SITE_URL}/signals/${s.slug}`,
        lastModified: new Date(s.publishedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }));
  } catch {
    /* API offline */
  }

  try {
    const { entities } = await api.entities();
    entityEntries = entities.slice(0, 500).map((e) => ({
      url: `${SITE_URL}/entities/${e.id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));
  } catch {
    /* API offline */
  }

  // Derive entity-month archive URLs from the signals we already pulled.
  // Programmatic *but* every URL has real content — this is the right kind
  // of scale for SEO, not the thin-page kind.
  const entityMonths = new Map<string, Date>();
  for (const s of allSignals) {
    if (isBackfillSignal(s)) continue;
    const d = new Date(s.publishedAt);
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${s.primaryEntityId}|${period}`;
    const prev = entityMonths.get(key);
    if (!prev || d > prev) entityMonths.set(key, d);
  }
  entityMonthEntries = Array.from(entityMonths.entries())
    .slice(0, 5000)
    .map(([key, lastSeen]) => {
      const [id, period] = key.split('|');
      return {
        url: `${SITE_URL}/entities/${id}/${period}`,
        lastModified: lastSeen,
        changeFrequency: 'weekly' as const,
        priority: 0.55,
      };
    });

  // Per-signal-type taxonomy pages.
  const signalTypes = Array.from(
    new Set(allSignals.filter((s) => !isBackfillSignal(s)).map((s) => s.signalType))
  );
  signalTypeEntries = signalTypes.map((t) => ({
    url: `${SITE_URL}/signals/types/${t}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [
    ...staticRoutes,
    ...signalEntries,
    ...entityEntries,
    ...entityMonthEntries,
    ...signalTypeEntries,
  ];
}
