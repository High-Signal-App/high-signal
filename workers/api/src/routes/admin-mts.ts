import { Hono } from 'hono';
import {
  attentionVerificationMetrics,
  bestPosition,
  canonicalAttentionUrl,
  epoch,
  jsonArray,
  parseVerificationResults,
  positionUpdate,
  recentPublishedSignals,
  recordVerificationResults,
  retainedEvidenceCandidates,
  runD1Batches as runBatches,
} from '../lib/attention-admin';
import { buildPatterns, matchEntity, type GazetteerEntity } from '../lib/gazetteer';
import { sha16 } from '../lib/ids';

type Env = { DB: D1Database };

const MTS_FEED_URL = 'https://api.mts.now/situations';
const MIN_REFRESH_SECONDS = 25 * 60;
const MAX_VERIFICATION_REQUESTS_PER_POLL = 6;
const STALE_RUNNING_SECONDS = 45 * 60;

interface SourceReference {
  url: string;
  evidenceRole?: string | null;
  postedAt?: string | null;
}

interface MtsSituationInput {
  situationId: string;
  canonicalMtsUrl: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  firstSeenAt: string;
  retrievedAt: string;
  position?: number | null;
  rankScore?: number | null;
  criticality?: string | null;
  lifecycle?: string | null;
  eventType?: string | null;
  genre?: string | null;
  confirmationInferred?: boolean;
  entities?: Array<{ name?: string; type?: string }>;
  topics?: Array<{ slug?: string; name?: string; confidence?: number | null }>;
  sourceReferences?: SourceReference[];
  sourceUrls?: string[];
  distinctSourceCount?: number;
  attentionMetrics?: Record<string, unknown>;
  payloadHash: string;
}

interface MtsFeedInput {
  feedKey: 'situations';
  feedUrl: string;
  retrievedAt: string;
  payloadHash: string;
  itemCount: number;
  situations: MtsSituationInput[];
}

interface ExistingSituation {
  situation_id: string;
  first_seen_at: number;
  position: number | null;
  peak_position: number | null;
  primary_entity_id: string | null;
  verification_status: string | null;
}

export function mtsVerificationReasons(input: {
  position?: number | null;
  positionDelta?: number | null;
  distinctSourceCount?: number | null;
  velocity?: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.position != null && input.position <= 20) reasons.push('rank<=20');
  if ((input.positionDelta ?? 0) >= 5) reasons.push('rank_velocity>=5');
  if ((input.velocity ?? 0) >= 1.25) reasons.push('narrative_velocity>=1.25');
  if ((input.distinctSourceCount ?? 0) >= 3) reasons.push('sources>=3');
  return reasons;
}

export const mtsAdminRoute = new Hono<{ Bindings: Env }>();

function compactSourceReferences(value: SourceReference[] | undefined): SourceReference[] {
  const byUrl = new Map<string, SourceReference>();
  for (const reference of value ?? []) {
    const url = canonicalAttentionUrl(reference.url);
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, {
      url,
      evidenceRole: reference.evidenceRole?.slice(0, 60) ?? null,
      postedAt: reference.postedAt?.slice(0, 40) ?? null,
    });
  }
  return Array.from(byUrl.values()).slice(0, 50);
}

function validSituation(value: MtsSituationInput): boolean {
  return Boolean(
    value?.situationId &&
      value.title &&
      value.canonicalMtsUrl &&
      canonicalAttentionUrl(value.canonicalMtsUrl) &&
      value.payloadHash
  );
}

async function feedState(d1: D1Database) {
  try {
    return await d1
      .prepare('SELECT last_retrieved_at FROM mts_feed_state WHERE feed_key=?')
      .bind('situations')
      .first<{ last_retrieved_at: number }>();
  } catch {
    return null;
  }
}

mtsAdminRoute.get('/status', async (c) => {
  const state = await feedState(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const lastRetrievedAt = state?.last_retrieved_at ?? null;
  const dueAt = lastRetrievedAt == null ? null : lastRetrievedAt + MIN_REFRESH_SECONDS;
  return c.json({
    feedKey: 'situations',
    feedUrl: MTS_FEED_URL,
    minimumRefreshSeconds: MIN_REFRESH_SECONDS,
    lastRetrievedAt:
      lastRetrievedAt == null ? null : new Date(lastRetrievedAt * 1000).toISOString(),
    dueAt: dueAt == null ? null : new Date(dueAt * 1000).toISOString(),
    isDue: dueAt == null || dueAt <= now,
    verification: await attentionVerificationMetrics(c.env.DB, 'mts_situations'),
  });
});

mtsAdminRoute.post('/', async (c) => {
  const body = (await c.req.json()) as { feed?: MtsFeedInput };
  const feed = body.feed;
  if (
    !feed ||
    feed.feedKey !== 'situations' ||
    feed.feedUrl !== MTS_FEED_URL ||
    !Array.isArray(feed.situations) ||
    !feed.payloadHash
  ) {
    return c.json({ error: 'bad_payload' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const retrievedAt = epoch(feed.retrievedAt);
  if (retrievedAt == null || retrievedAt > now + 300)
    return c.json({ error: 'bad_timestamp' }, 400);
  const state = await feedState(c.env.DB);
  if (state && retrievedAt - state.last_retrieved_at < MIN_REFRESH_SECONDS) {
    return c.json({ skipped: true, reason: 'minimum_refresh_interval', feeds: 0, situations: 0 });
  }

  const incoming = feed.situations.filter(validSituation);
  const ids = Array.from(new Set(incoming.map((item) => item.situationId)));
  const existing = await existingSituations(c.env.DB, ids);
  const entityRows = await c.env.DB.prepare(
    'SELECT id, name, ticker, metadata FROM entities'
  ).all<GazetteerEntity>();
  const entityPatterns = buildPatterns(entityRows.results ?? []);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO mts_feed_snapshots
        (id, feed_key, feed_url, retrieved_at, payload_hash, item_count)
       VALUES (?, 'situations', ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    ).bind(
      await sha16(`mts-feed:${retrievedAt}:${feed.payloadHash}`),
      feed.feedUrl,
      retrievedAt,
      feed.payloadHash,
      incoming.length
    ),
  ];
  const normalized = new Map<
    string,
    { situation: MtsSituationInput; entityId: string | null; sourceUrls: string[] }
  >();
  const verificationCandidates = new Map<string, { reasons: string[] }>();

  for (const situation of incoming) {
    const prior = existing.get(situation.situationId);
    const rank = positionUpdate(prior?.position, situation.position);
    const peakPosition = bestPosition(prior?.peak_position, rank.position);
    const firstSeenAt = Math.min(
      epoch(situation.firstSeenAt) ?? retrievedAt,
      prior?.first_seen_at ?? Infinity
    );
    const references = compactSourceReferences(situation.sourceReferences);
    const sourceUrls = references.map((reference) => reference.url);
    const entityText = `${situation.title} ${(situation.entities ?? [])
      .map((entity) => entity.name ?? '')
      .join(' ')}`;
    const entityId = prior?.primary_entity_id ?? matchEntity(entityText, entityPatterns);
    const distinctSourceCount = Math.max(
      references.length,
      Math.max(0, Math.floor(situation.distinctSourceCount ?? 0))
    );
    const velocity = Number(situation.attentionMetrics?.['velocity'] ?? 0) || 0;

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO mts_situations
          (situation_id, canonical_mts_url, title, created_at, updated_at, first_seen_at,
           retrieved_at, position, position_delta, peak_position, rank_score, criticality,
           lifecycle, event_type, genre, confirmation_inferred, entities, topics,
           source_references, distinct_source_count, attention_metrics, primary_entity_id,
           source_class, evidence_tier, confidence_contribution, attention_contribution,
           payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'attention_aggregator', 'derived', 'none', 'allowed', ?)
         ON CONFLICT(situation_id) DO UPDATE SET
           canonical_mts_url=excluded.canonical_mts_url,
           title=excluded.title,
           created_at=COALESCE(mts_situations.created_at, excluded.created_at),
           updated_at=COALESCE(excluded.updated_at, mts_situations.updated_at),
           first_seen_at=MIN(mts_situations.first_seen_at, excluded.first_seen_at),
           retrieved_at=excluded.retrieved_at,
           position=excluded.position,
           position_delta=excluded.position_delta,
           peak_position=COALESCE(excluded.peak_position, mts_situations.peak_position),
           rank_score=excluded.rank_score,
           criticality=excluded.criticality,
           lifecycle=excluded.lifecycle,
           event_type=excluded.event_type,
           genre=excluded.genre,
           confirmation_inferred=excluded.confirmation_inferred,
           entities=excluded.entities,
           topics=excluded.topics,
           source_references=excluded.source_references,
           distinct_source_count=excluded.distinct_source_count,
           attention_metrics=excluded.attention_metrics,
           primary_entity_id=COALESCE(mts_situations.primary_entity_id, excluded.primary_entity_id),
           payload_hash=excluded.payload_hash`
      ).bind(
        situation.situationId,
        situation.canonicalMtsUrl,
        situation.title.slice(0, 500),
        epoch(situation.createdAt),
        epoch(situation.updatedAt),
        Number.isFinite(firstSeenAt) ? firstSeenAt : retrievedAt,
        retrievedAt,
        rank.position,
        rank.delta,
        peakPosition,
        situation.rankScore ?? null,
        situation.criticality ?? null,
        situation.lifecycle ?? null,
        situation.eventType ?? null,
        situation.genre ?? null,
        situation.confirmationInferred ? 1 : 0,
        JSON.stringify(situation.entities ?? []),
        JSON.stringify(situation.topics ?? []),
        JSON.stringify(references),
        distinctSourceCount,
        JSON.stringify(situation.attentionMetrics ?? {}),
        entityId,
        situation.payloadHash
      ),
      c.env.DB.prepare(
        `INSERT INTO mts_situation_snapshots
          (id, situation_id, retrieved_at, position, position_delta, peak_position,
           rank_score, distinct_source_count, attention_metrics, payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
      ).bind(
        await sha16(
          `mts-situation:${situation.situationId}:${retrievedAt}:${situation.payloadHash}`
        ),
        situation.situationId,
        retrievedAt,
        rank.position,
        rank.delta,
        peakPosition,
        situation.rankScore ?? null,
        distinctSourceCount,
        JSON.stringify(situation.attentionMetrics ?? {}),
        situation.payloadHash
      )
    );
    normalized.set(situation.situationId, { situation, entityId, sourceUrls });
    const reasons = mtsVerificationReasons({
      position: rank.position,
      positionDelta: rank.delta,
      distinctSourceCount,
      velocity,
    });
    if (!prior?.verification_status && reasons.length > 0) {
      verificationCandidates.set(situation.situationId, { reasons });
    }
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO mts_feed_state
        (feed_key, feed_url, last_retrieved_at, last_payload_hash, item_count)
       VALUES ('situations', ?, ?, ?, ?)
       ON CONFLICT(feed_key) DO UPDATE SET feed_url=excluded.feed_url,
         last_retrieved_at=excluded.last_retrieved_at,
         last_payload_hash=excluded.last_payload_hash, item_count=excluded.item_count`
    ).bind(feed.feedUrl, retrievedAt, feed.payloadHash, incoming.length)
  );
  await runBatches(c.env.DB, statements);

  const signalLinks = await linkSignals(c.env.DB, normalized, now);
  const linked = await existingSignalLinks(c.env.DB, Array.from(verificationCandidates.keys()));
  await runBatches(
    c.env.DB,
    Array.from(verificationCandidates.entries()).flatMap(([situationId, candidate]) =>
      linked.has(situationId)
        ? []
        : [
            c.env.DB.prepare(
              `UPDATE mts_situations SET verification_status='requested',
                 verification_reason=?, verification_requested_at=?, verification_error=NULL
               WHERE situation_id=? AND verification_status IS NULL`
            ).bind(candidate.reasons.join(','), now, situationId),
          ]
    )
  );

  return c.json({
    feeds: 1,
    situations: normalized.size,
    snapshots: normalized.size,
    signalLinks,
    verificationRequests: await pendingVerificationRequests(c.env.DB),
    classification: {
      sourceClass: 'attention_aggregator',
      evidenceTier: 'derived',
      confidenceContribution: 'none',
      attentionContribution: 'allowed',
    },
    retention: 'reference_metadata_only',
  });
});

mtsAdminRoute.post('/verification-results', async (c) => {
  const results = parseVerificationResults(await c.req.json());
  await recordVerificationResults(c.env.DB, 'mts_situations', 'situation_id', results);
  return c.json({ updated: results.length });
});

async function existingSituations(d1: D1Database, ids: string[]) {
  const output = new Map<string, ExistingSituation>();
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    if (chunk.length === 0) continue;
    const rows = await d1
      .prepare(
        `SELECT situation_id, first_seen_at, position, peak_position, primary_entity_id,
                verification_status FROM mts_situations
         WHERE situation_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<ExistingSituation>();
    for (const row of rows.results ?? []) output.set(row.situation_id, row);
  }
  return output;
}

async function existingSignalLinks(d1: D1Database, ids: string[]) {
  const output = new Set<string>();
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    if (chunk.length === 0) continue;
    const rows = await d1
      .prepare(
        `SELECT DISTINCT situation_id FROM mts_signal_links
         WHERE situation_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<{ situation_id: string }>();
    for (const row of rows.results ?? []) output.add(row.situation_id);
  }
  return output;
}

async function pendingVerificationRequests(d1: D1Database) {
  const rows = await d1
    .prepare(
      `SELECT situation_id, title, primary_entity_id, source_references, first_seen_at,
              verification_reason, verification_status, verification_attempts,
              verification_requested_at, verification_started_at, retrieved_at,
              position, position_delta, distinct_source_count,
              (SELECT COALESCE(MAX(retrieved_at), 0) FROM mts_feed_snapshots) latest_retrieved_at
       FROM mts_situations
       WHERE verification_attempts < 3 AND (
         verification_status IN ('requested', 'insufficient_evidence', 'failed') OR
         (verification_status='running' AND verification_started_at <= unixepoch() - ${STALE_RUNNING_SECONDS})
       )
       ORDER BY CASE WHEN retrieved_at >= (SELECT COALESCE(MAX(retrieved_at), 0) - 600 FROM mts_feed_snapshots) THEN 0 ELSE 1 END,
                COALESCE(position, 10000), ABS(COALESCE(position_delta, 0)) DESC,
                distinct_source_count DESC, verification_requested_at
       LIMIT ${MAX_VERIFICATION_REQUESTS_PER_POLL}`
    )
    .all<{
      situation_id: string;
      title: string;
      primary_entity_id: string | null;
      source_references: string;
      first_seen_at: number;
      verification_reason: string | null;
    }>();
  return Promise.all(
    (rows.results ?? []).map(async (row) => ({
      shortId: row.situation_id,
      title: row.title,
      summary: null,
      entityId: row.primary_entity_id,
      sourceUrls: jsonArray(row.source_references).flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const url = (value as Record<string, unknown>)['url'];
        return typeof url === 'string' ? [url] : [];
      }),
      retainedEvidence: await retainedEvidenceCandidates(d1, row.title, row.first_seen_at, [
        'news:mts-verification:%',
        'news:digg-verification:%',
      ]),
      firstSeenAt: new Date(row.first_seen_at * 1000).toISOString(),
      reasons: (row.verification_reason ?? '').split(',').filter(Boolean),
    }))
  );
}

type MtsLinkInput = {
  situation: MtsSituationInput;
  entityId: string | null;
  sourceUrls: string[];
};

type MtsSignalLink = {
  situationId: string;
  signalId: string;
  entityId: string | null;
  basis: 'evidence_url' | 'entity';
  confidence: number;
};

async function addEvidenceUrlLinks(
  d1: D1Database,
  situations: Map<string, MtsLinkInput>,
  links: Map<string, MtsSignalLink>
) {
  const owners = new Map<string, string[]>();
  for (const [situationId, value] of situations) {
    for (const url of value.sourceUrls) owners.set(url, [...(owners.get(url) ?? []), situationId]);
  }
  const urls = Array.from(owners.keys());
  for (let index = 0; index < urls.length; index += 80) {
    const chunk = urls.slice(index, index + 80);
    if (chunk.length === 0) continue;
    const rows = await d1
      .prepare(
        `SELECT e.url, e.signal_id, s.primary_entity_id FROM evidence e
         JOIN signals s ON s.id=e.signal_id
         WHERE s.review_status='published' AND e.url IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<{ url: string; signal_id: string; primary_entity_id: string | null }>();
    for (const row of rows.results ?? []) {
      for (const situationId of owners.get(row.url) ?? []) {
        links.set(`${situationId}:${row.signal_id}`, {
          situationId,
          signalId: row.signal_id,
          entityId: row.primary_entity_id,
          basis: 'evidence_url',
          confidence: 1,
        });
      }
    }
  }
}

async function addRecentEntityLinks(
  d1: D1Database,
  situations: Map<string, MtsLinkInput>,
  links: Map<string, MtsSignalLink>,
  now: number
) {
  const entityIds = Array.from(
    new Set(
      Array.from(situations.values()).flatMap((value) => (value.entityId ? [value.entityId] : []))
    )
  );
  if (entityIds.length === 0) return;
  const rows = await recentPublishedSignals(d1, entityIds, now);
  const perEntity = new Map<string, number>();
  for (const row of rows) {
    const used = perEntity.get(row.primary_entity_id) ?? 0;
    if (used >= 3) continue;
    perEntity.set(row.primary_entity_id, used + 1);
    for (const [situationId, value] of situations) {
      if (value.entityId !== row.primary_entity_id) continue;
      const key = `${situationId}:${row.id}`;
      if (links.has(key)) continue;
      links.set(key, {
        situationId,
        signalId: row.id,
        entityId: row.primary_entity_id,
        basis: 'entity',
        confidence: 0.55,
      });
    }
  }
}

async function linkSignals(d1: D1Database, situations: Map<string, MtsLinkInput>, now: number) {
  const links = new Map<string, MtsSignalLink>();
  await addEvidenceUrlLinks(d1, situations, links);
  await addRecentEntityLinks(d1, situations, links, now);
  await runBatches(
    d1,
    Array.from(links.values()).map((link) =>
      d1
        .prepare(
          `INSERT INTO mts_signal_links
          (situation_id, signal_id, entity_id, match_basis, match_confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(situation_id, signal_id) DO UPDATE SET entity_id=excluded.entity_id,
           match_basis=excluded.match_basis, match_confidence=excluded.match_confidence,
           updated_at=excluded.updated_at`
        )
        .bind(link.situationId, link.signalId, link.entityId, link.basis, link.confidence, now, now)
    )
  );
  return links.size;
}
