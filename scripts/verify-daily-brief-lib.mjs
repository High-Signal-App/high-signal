export const IST_TIME_ZONE = 'Asia/Kolkata';
export const MAX_EVIDENCE_AGE_MS = 2 * 60 * 60 * 1000;

export function calendarDate(value, timeZone = IST_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  if (/^\d+$/.test(value)) return timestampMs(Number(value));
  return Date.parse(value);
}

const SIGNAL_SECTIONS = ['stocks', 'ideas', 'trends'];

function isPublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Validate that a served edition contains honest reader-visible content. */
export function validateBriefContent(brief) {
  for (const key of SIGNAL_SECTIONS) {
    if (!Array.isArray(brief?.[key])) throw new Error(`${key} section is not an array`);
  }
  if (brief?.news != null && !Array.isArray(brief.news)) {
    throw new Error('news section is not an array');
  }
  const news = brief?.news ?? [];
  const counts = {
    news: news.length,
    ...Object.fromEntries(SIGNAL_SECTIONS.map((key) => [key, brief[key].length])),
  };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const withheld = SIGNAL_SECTIONS.filter(
    (key) => brief?.categoryStates?.[key]?.reason === 'items_withheld_by_publish_gate'
  );

  if (total === 0) {
    throw new Error(
      `edition served but news and signal sections are empty (${JSON.stringify(counts)})` +
        (withheld.length > 0
          ? ` — ${withheld.join(', ')} had items withheld by the publish gate`
          : '')
    );
  }

  for (const [index, item] of news.entries()) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) {
      throw new Error(`news item ${index} has no title`);
    }
    if (!Number.isFinite(timestampMs(item.event_at))) {
      throw new Error(`news item ${index} has no publication date`);
    }
    if (
      !Array.isArray(item.source_references) ||
      !item.source_references.some((citation) => isPublicUrl(citation?.url))
    ) {
      throw new Error(`news item ${index} has no public source`);
    }
  }

  return { counts, total, withheld };
}

export function validateBriefFreshness(brief, dailyDump, now = new Date()) {
  const expectedDate = calendarDate(now);
  const briefDate = calendarDate(brief?.generatedAt);
  if (briefDate !== expectedDate) {
    throw new Error(
      `brief date ${briefDate ?? 'missing'} does not equal current IST date ${expectedDate}`
    );
  }
  if (dailyDump?.date !== expectedDate) {
    throw new Error(
      `daily dump date ${dailyDump?.date ?? 'missing'} does not equal current IST date ${expectedDate}`
    );
  }

  const newestEvidenceAt = timestampMs(dailyDump?.latestEvidenceInputAt);
  if (!Number.isFinite(newestEvidenceAt)) {
    throw new Error('daily dump contains no timestamped evidence input');
  }
  const ageMs = now.getTime() - newestEvidenceAt;
  if (ageMs < -5 * 60 * 1000) {
    throw new Error('newest material evidence is future-dated');
  }
  if (ageMs > MAX_EVIDENCE_AGE_MS) {
    throw new Error(
      `newest material evidence is ${(ageMs / 3_600_000).toFixed(2)}h old (limit 2h)`
    );
  }
  return { expectedDate, newestEvidenceAt: new Date(newestEvidenceAt).toISOString(), ageMs };
}
