type AttentionTable = 'digg_clusters' | 'mts_situations';
type AttentionIdColumn = 'short_id' | 'situation_id';

export type AttentionVerificationResult = {
  shortId: string;
  status: 'running' | 'verified_candidate' | 'insufficient_evidence' | 'failed';
  candidateSlug?: string | null;
  error?: string | null;
};

const VERIFICATION_STATUSES = new Set<AttentionVerificationResult['status']>([
  'running',
  'verified_candidate',
  'insufficient_evidence',
  'failed',
]);

const EVIDENCE_SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'from',
  'into',
  'may',
  'team',
  'that',
  'the',
  'this',
  'with',
]);

export function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

export function jsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function bestPosition(...values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isInteger(value) && value! > 0);
  return valid.length > 0 ? Math.min(...valid) : null;
}

export function positionUpdate(
  previous: number | null | undefined,
  incoming: number | null | undefined
) {
  if (incoming == null) return { position: previous ?? null, delta: null };
  return { position: incoming, delta: previous == null ? null : previous - incoming };
}

export function canonicalAttentionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^ref$|^source$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function tokenizableTitle(value: string) {
  let normalized = '';
  for (const char of value.toLowerCase()) {
    const isLetter = char >= 'a' && char <= 'z';
    const isNumber = char >= '0' && char <= '9';
    normalized += isLetter || isNumber ? char : ' ';
  }
  return normalized;
}

export function evidenceSearchTokens(title: string): string[] {
  const tokens: string[] = [];
  for (const raw of tokenizableTitle(title).split(' ')) {
    if (raw.length < 4 || EVIDENCE_SEARCH_STOP_WORDS.has(raw)) continue;
    const variants = raw.endsWith('ai') && raw.length > 6 ? [raw.slice(0, -2), raw] : [raw];
    for (const token of variants) {
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens.slice(0, 8);
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export async function runD1Batches(
  d1: D1Database,
  statements: D1PreparedStatement[],
  batchSize = 80
) {
  for (let index = 0; index < statements.length; index += batchSize) {
    const batch = statements.slice(index, index + batchSize);
    if (batch.length > 0) await d1.batch(batch);
  }
}

export async function attentionVerificationMetrics(d1: D1Database, table: AttentionTable) {
  try {
    const rows = await d1
      .prepare(
        `SELECT verification_status, first_seen_at, verified_at, verification_requested_at
         FROM ${table} WHERE verification_status IS NOT NULL
         ORDER BY verification_requested_at DESC LIMIT 500`
      )
      .all<{
        verification_status: string;
        first_seen_at: number;
        verified_at: number | null;
        verification_requested_at: number | null;
      }>();
    const values = rows.results ?? [];
    const now = Math.floor(Date.now() / 1000);
    const latencies = values.flatMap((row) =>
      row.verification_status === 'verified_candidate' && row.verified_at != null
        ? [(row.verified_at - row.first_seen_at) / 60]
        : []
    );
    return {
      pending: values.filter((row) => ['requested', 'running'].includes(row.verification_status))
        .length,
      running: values.filter((row) => row.verification_status === 'running').length,
      pendingOlderThan90Minutes: values.filter(
        (row) =>
          ['requested', 'running'].includes(row.verification_status) &&
          row.verification_requested_at != null &&
          row.verification_requested_at <= now - 90 * 60
      ).length,
      verifiedCandidates: latencies.length,
      medianFirstSeenToVerifiedMinutes: median(latencies),
      targetMinutes: 90,
    };
  } catch {
    return {
      pending: 0,
      running: 0,
      pendingOlderThan90Minutes: 0,
      verifiedCandidates: 0,
      medianFirstSeenToVerifiedMinutes: null,
      targetMinutes: 90,
    };
  }
}

export function parseVerificationResults(value: unknown): AttentionVerificationResult[] {
  if (!value || typeof value !== 'object') return [];
  const results = (value as { results?: Array<Partial<AttentionVerificationResult>> }).results;
  return (results ?? []).flatMap((result) =>
    result.shortId && result.status && VERIFICATION_STATUSES.has(result.status)
      ? [
          {
            shortId: result.shortId,
            status: result.status,
            candidateSlug: result.candidateSlug,
            error: result.error,
          },
        ]
      : []
  );
}

export async function recordVerificationResults(
  d1: D1Database,
  table: AttentionTable,
  idColumn: AttentionIdColumn,
  results: AttentionVerificationResult[]
) {
  const now = Math.floor(Date.now() / 1000);
  await runD1Batches(
    d1,
    results.map((result) =>
      d1
        .prepare(
          `UPDATE ${table} SET verification_status=?,
             verification_started_at=CASE WHEN ?='running' THEN COALESCE(verification_started_at, ?) ELSE verification_started_at END,
             verified_at=CASE WHEN ?='verified_candidate' THEN ? ELSE verified_at END,
             verification_candidate_slug=COALESCE(?, verification_candidate_slug),
             verification_error=?,
             verification_attempts=verification_attempts + CASE WHEN ?='running' THEN 1 ELSE 0 END
           WHERE ${idColumn}=?`
        )
        .bind(
          result.status,
          result.status,
          now,
          result.status,
          now,
          result.candidateSlug ?? null,
          result.error?.slice(0, 500) ?? null,
          result.status,
          result.shortId
        )
    )
  );
}

export async function retainedEvidenceCandidates(
  d1: D1Database,
  title: string,
  firstSeenAt: number,
  excludedSourcePatterns: string[]
) {
  const tokens = evidenceSearchTokens(title);
  if (tokens.length === 0) return [];
  const exclusions = excludedSourcePatterns.map(() => 'source NOT LIKE ?').join(' AND ');
  const rows = await d1
    .prepare(
      `SELECT source_url, title, content, published_at, source FROM events
       WHERE published_at >= ? AND published_at <= unixepoch() AND length(content) >= 500
         ${exclusions ? `AND ${exclusions}` : ''}
         AND (${tokens.map(() => 'lower(title) LIKE ?').join(' OR ')})
       ORDER BY published_at DESC LIMIT 50`
    )
    .bind(
      firstSeenAt - 3 * 24 * 60 * 60,
      ...excludedSourcePatterns,
      ...tokens.map((token) => `%${token}%`)
    )
    .all<{
      source_url: string;
      title: string;
      content: string;
      published_at: number;
      source: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    url: row.source_url,
    title: row.title,
    retainedContent: row.content,
    seendate: new Date(row.published_at * 1000).toISOString(),
    retainedSource: row.source,
  }));
}

export async function recentPublishedSignals(d1: D1Database, entityIds: string[], now: number) {
  if (entityIds.length === 0) return [];
  const rows = await d1
    .prepare(
      `SELECT id, primary_entity_id FROM signals
       WHERE review_status='published' AND published_at >= ?
         AND primary_entity_id IN (${entityIds.map(() => '?').join(',')})
       ORDER BY published_at DESC`
    )
    .bind(now - 7 * 24 * 60 * 60, ...entityIds)
    .all<{ id: string; primary_entity_id: string }>();
  return rows.results ?? [];
}
