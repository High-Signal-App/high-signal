import {
  buildBriefEditionReceipt,
  istDay,
  istDayFromTimestamp,
  istDayRange,
  sanitizeBriefNewsItems,
  type BriefSnapshot,
  type Region,
} from '@high-signal/shared';

interface BriefReader {
  brief(params: { region: Region; date: string }): Promise<BriefSnapshot>;
  briefDates(): Promise<{ dates: Array<{ date: string }> }>;
}

/** Trust the edition response and its evidence, never the date index alone. */
function qualifiedEdition(brief: BriefSnapshot, date: string, region: Region): boolean {
  if (
    brief.publishStatus !== 'published' ||
    brief.editionDate !== date ||
    brief.region !== region
  ) {
    return false;
  }
  if (brief.timeZone !== 'Asia/Kolkata') return false;
  if (brief.stocks.some((item) => istDayFromTimestamp(item.publishedAt) !== date)) return false;
  const receipt = buildBriefEditionReceipt(brief);
  const news = brief.news ?? [];
  const issues = receipt.issues.filter(
    (issue) => !(news.length > 0 && issue.reason === 'edition_has_no_items')
  );
  return (
    issues.length === 0 &&
    (receipt.publishable || news.length > 0) &&
    sanitizeBriefNewsItems(news).length === news.length &&
    news.every((item) => Number.isFinite(Date.parse(item.event_at)))
  );
}

function isChallenge(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

/** Read only public editions; the existing API retains all history/challenge gates. */
export async function resolveCurrentBrief(
  reader: BriefReader,
  region: Region,
  day: 'today' | 'yesterday',
  now = new Date()
): Promise<BriefSnapshot> {
  const requestedDate = istDay(now, day === 'yesterday' ? -1 : 0);
  let unavailable = false;
  let pending: BriefSnapshot | undefined;
  try {
    const requested = await reader.brief({ region, date: requestedDate });
    if (qualifiedEdition(requested, requestedDate, region)) return requested;
    unavailable = Object.values(requested.categoryStates ?? {}).some(
      (state) => state.status === 'unavailable'
    );
    if (requested.publishStatus === 'pending') pending = requested;
  } catch (error) {
    unavailable = true;
    if (isChallenge(error)) return emptyBrief();
  }

  try {
    const { dates } = await reader.briefDates();
    const candidates = [...new Set(dates.map((item) => item.date))]
      .filter((date) => istDayRange(date) !== null && date < requestedDate)
      .sort()
      .reverse();
    for (const date of candidates) {
      try {
        const brief = await reader.brief({ region, date });
        if (qualifiedEdition(brief, date, region)) return brief;
      } catch (error) {
        unavailable = true;
        // A challenge is an access boundary, not a reason to try another route.
        if (isChallenge(error)) break;
      }
    }
  } catch {
    unavailable = true;
  }
  return emptyBrief();

  function emptyBrief(): BriefSnapshot {
    const state = unavailable
      ? { status: 'unavailable' as const, source: 'live' as const, reason: 'brief_api_unavailable' }
      : { status: 'empty' as const, source: 'live' as const, reason: 'no_qualified_edition' };
    return {
      generatedAt: now.toISOString(),
      editionDate: requestedDate,
      timeZone: 'Asia/Kolkata',
      region,
      publishStatus: 'pending',
      ...(pending?.nextExpectedPublishAt
        ? { nextExpectedPublishAt: pending.nextExpectedPublishAt }
        : {}),
      stocks: [],
      ideas: [],
      trends: [],
      news: [],
      categoryStates: { stocks: state, ideas: state, trends: state },
    };
  }
}
