import type { MetadataRoute } from 'next';
import { PUBLIC_STATIC_ROUTES } from '../../public-route-registry.mjs';

import {
  CASE_STUDIES,
  CASE_STUDIES_TOTAL_PAGES,
  COMPANY_UNIVERSE_LAST_UPDATED,
} from '@/app/case-studies/data';
import { api } from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  let signalEntries: MetadataRoute.Sitemap = [];
  let entityEntries: MetadataRoute.Sitemap = [];
  let entityMonthEntries: MetadataRoute.Sitemap = [];
  let signalTypeEntries: MetadataRoute.Sitemap = [];
  let briefArchiveEntries: MetadataRoute.Sitemap = [];

  let allSignals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  try {
    // Pull a large public signal window so the sitemap stays thick for crawlers.
    const data = await api.signals({ limit: 5000 });
    allSignals = data.signals;
    signalEntries = allSignals
      .filter((signal) => !isBackfillSignal(signal))
      .slice(0, 5000)
      .map((s) => ({
        url: `${SITE_URL}/signals/${s.slug}`,
        lastModified: new Date(s.publishedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }));
  } catch {
    /* API offline */
  }

  // Brief archive — permanent /brief/<date> URLs from precomputed snapshots.
  try {
    const { dates } = await api.briefDates();
    briefArchiveEntries = dates.map((d) => ({
      url: `${SITE_URL}/brief/${d.date}`,
      lastModified: new Date(d.computedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    }));
  } catch {
    /* API offline */
  }

  try {
    const { entities } = await api.entities();
    entityEntries = entities.slice(0, 5000).map((e) => ({
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
    .slice(0, 20_000)
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

  // Case-study / company universe pages — high-volume marketing surface.
  const caseStudyUpdated = COMPANY_UNIVERSE_LAST_UPDATED
    ? new Date(COMPANY_UNIVERSE_LAST_UPDATED)
    : now;
  const caseStudyEntries: MetadataRoute.Sitemap = CASE_STUDIES.map((c) => ({
    url: `${SITE_URL}/case-studies/${c.slug}`,
    lastModified: caseStudyUpdated,
    changeFrequency: 'weekly' as const,
    priority: 0.65,
  }));
  const caseStudyPageEntries: MetadataRoute.Sitemap = Array.from(
    { length: CASE_STUDIES_TOTAL_PAGES },
    (_, i) => ({
      url: `${SITE_URL}/case-studies/page/${i + 1}`,
      lastModified: caseStudyUpdated,
      changeFrequency: 'weekly' as const,
      priority: i === 0 ? 0.7 : 0.5,
    })
  );
  return [
    ...staticRoutes,
    ...briefArchiveEntries,
    ...signalEntries,
    ...entityEntries,
    ...entityMonthEntries,
    ...signalTypeEntries,
    ...caseStudyPageEntries,
    ...caseStudyEntries,
  ];
}
