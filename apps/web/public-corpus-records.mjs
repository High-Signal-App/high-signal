import {
  evaluateCollection,
  evaluateCompany,
  evaluateDirectoryPage,
  evaluateEntity,
  evaluateSignal,
} from './public-corpus-policy.mjs';

function candidate(family, path, verdict, lastModified, sourceId) {
  return Object.freeze({ family, path, verdict, lastModified, sourceId });
}

/**
 * @param {{
 *   companies?: any[],
 *   companyLastModified?: string | number | Date | null,
 *   signals?: any[],
 *   entities?: any[],
 *   briefDates?: any[],
 *   directoryPageCount?: number
 * }} input
 */
export function buildPublicCorpusCandidates({
  companies = [],
  companyLastModified = null,
  signals = [],
  entities = [],
  briefDates = [],
  directoryPageCount = 0,
} = {}) {
  const signalCandidates = signals.map((signal) =>
    candidate(
      'signal',
      `/signals/${signal.slug}`,
      evaluateSignal(signal),
      signal.publishedAt,
      signal.slug
    )
  );
  const eligibleSignals = signals.filter((_, index) => signalCandidates[index].verdict.eligible);

  const signalCounts = new Map();
  for (const signal of eligibleSignals) {
    signalCounts.set(signal.primaryEntityId, (signalCounts.get(signal.primaryEntityId) ?? 0) + 1);
  }
  const entityCandidates = entities.map((entity) =>
    candidate(
      'entity',
      `/entities/${entity.id}`,
      evaluateEntity({ signalCount: signalCounts.get(entity.id) ?? 0 }),
      null,
      entity.id
    )
  );

  const entityPeriods = new Map();
  for (const signal of eligibleSignals) {
    const observed = new Date(signal.publishedAt);
    if (!Number.isFinite(observed.getTime())) continue;
    const period = `${observed.getUTCFullYear()}-${String(observed.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${signal.primaryEntityId}|${period}`;
    const previous = entityPeriods.get(key);
    entityPeriods.set(key, {
      entityId: signal.primaryEntityId,
      period,
      childCount: (previous?.childCount ?? 0) + 1,
      lastModified:
        !previous || observed > previous.lastModified ? observed : previous.lastModified,
    });
  }
  const entityPeriodCandidates = Array.from(entityPeriods.values()).map((entry) =>
    candidate(
      'entity-period',
      `/entities/${entry.entityId}/${entry.period}`,
      evaluateCollection('entity-period', { childCount: entry.childCount }, 2),
      entry.lastModified,
      `${entry.entityId}|${entry.period}`
    )
  );

  const signalTypes = new Map();
  for (const signal of eligibleSignals) {
    signalTypes.set(signal.signalType, (signalTypes.get(signal.signalType) ?? 0) + 1);
  }
  const taxonomyCandidates = Array.from(signalTypes.entries()).map(([type, childCount]) =>
    candidate(
      'taxonomy',
      `/signals/types/${type}`,
      evaluateCollection('taxonomy', { childCount }, 3),
      null,
      type
    )
  );

  const briefCandidates = briefDates.map((brief) =>
    candidate(
      'brief',
      `/brief/${brief.date}`,
      evaluateCollection('brief', { childCount: brief.regionCount }, 1),
      brief.computedAt,
      brief.date
    )
  );

  const companyCandidates = companies.map((company) =>
    candidate(
      'company',
      `/case-studies/${company.slug}`,
      evaluateCompany(company),
      companyLastModified,
      company.slug
    )
  );

  const directoryCandidates = Array.from(
    { length: Math.max(0, directoryPageCount - 1) },
    (_, index) => {
      const page = index + 2;
      return candidate(
        'directory-page',
        `/case-studies/page/${page}`,
        evaluateDirectoryPage(),
        companyLastModified,
        String(page)
      );
    }
  );

  return [
    ...briefCandidates,
    ...signalCandidates,
    ...entityCandidates,
    ...entityPeriodCandidates,
    ...taxonomyCandidates,
    ...companyCandidates,
    ...directoryCandidates,
  ];
}
