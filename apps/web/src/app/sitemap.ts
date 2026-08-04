import type { MetadataRoute } from 'next';
import { PUBLIC_STATIC_ROUTES } from '../../public-route-registry.mjs';

import {
  CASE_STUDIES,
  CASE_STUDIES_TOTAL_PAGES,
  COMPANY_UNIVERSE_LAST_UPDATED,
} from '@/app/case-studies/data';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import { buildPublicCorpusCandidates } from '../../public-corpus-records.mjs';
import { shouldIncludeInDiscovery } from '../../public-corpus-policy.mjs';

export const dynamic = 'force-dynamic';

const discoveryPresentation = {
  brief: { changeFrequency: 'monthly', priority: 0.8 },
  signal: { changeFrequency: 'monthly', priority: 0.7 },
  entity: { changeFrequency: 'weekly', priority: 0.5 },
  'entity-period': { changeFrequency: 'weekly', priority: 0.55 },
  taxonomy: { changeFrequency: 'daily', priority: 0.7 },
  company: { changeFrequency: 'weekly', priority: 0.65 },
  'directory-page': { changeFrequency: 'weekly', priority: 0.5 },
} as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  let signals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  let entities: Awaited<ReturnType<typeof api.entities>>['entities'] = [];
  let briefDates: Awaited<ReturnType<typeof api.briefDates>>['dates'] = [];

  const [signalsResult, entitiesResult, briefDatesResult] = await Promise.allSettled([
    api.signals({ limit: 5000 }),
    api.entities(),
    api.briefDates(),
  ]);
  if (signalsResult.status === 'fulfilled') signals = signalsResult.value.signals;
  if (entitiesResult.status === 'fulfilled') entities = entitiesResult.value.entities;
  if (briefDatesResult.status === 'fulfilled') briefDates = briefDatesResult.value.dates;

  const candidates = buildPublicCorpusCandidates({
    companies: CASE_STUDIES,
    companyLastModified: COMPANY_UNIVERSE_LAST_UPDATED,
    signals,
    entities,
    briefDates,
    directoryPageCount: CASE_STUDIES_TOTAL_PAGES,
  });

  const dynamicRoutes: MetadataRoute.Sitemap = candidates
    .filter((candidate) => shouldIncludeInDiscovery(candidate.verdict))
    .map((candidate) => {
      const presentation =
        discoveryPresentation[candidate.family as keyof typeof discoveryPresentation];
      const observed = candidate.lastModified ? new Date(candidate.lastModified) : now;
      return {
        url: `${SITE_URL}${candidate.path}`,
        lastModified: Number.isFinite(observed.getTime()) ? observed : now,
        changeFrequency: presentation.changeFrequency,
        priority: presentation.priority,
      };
    });

  return [...staticRoutes, ...dynamicRoutes];
}
