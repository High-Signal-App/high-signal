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

  const evidenceTimes = Array.isArray(dailyDump?.evidenceEvents)
    ? dailyDump.evidenceEvents
        .map((event) => timestampMs(event?.publishedAt))
        .filter(Number.isFinite)
    : [];
  if (evidenceTimes.length === 0) {
    throw new Error('daily dump contains no timestamped material evidence');
  }
  const newestEvidenceAt = Math.max(...evidenceTimes);
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
