import { eq } from 'drizzle-orm';
import {
  canonicalSourceUrl,
  normalizeClaimTuple,
  type ClaimEvidenceRole,
} from '@high-signal/shared';
import { db, schema } from '../db';
import { sha16 } from './ids';

export interface SignalUpsert {
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
  predictedWindowDays: number;
  publishedAt: string; // ISO
  evidenceUrls: string[];
  evidence?: Array<{
    url: string;
    sourceType?: string | null;
    excerpt?: string | null;
    publishedAt?: string | null;
    sourceDocumentKey?: string | null;
    originatingEvidenceId?: string | null;
    semanticAlignment?: 'unverified' | 'verified' | 'rejected';
    role?: ClaimEvidenceRole;
    supports?: Array<
      'observed_event' | 'direct_entity_impact' | 'supply_chain_impact' | 'business_inference'
    >;
  }>;
  spilloverEntityIds?: string[];
  reviewStatus?: 'draft' | 'published' | 'corrected' | 'killed';
  supersedesSignalId?: string | null;
  bodyMd: string;
  observedEvent?: string | null;
  directEntityImpact?: string | null;
  supplyChainImpact?: string | null;
  businessInference?: string | null;
  inferenceStrength?: 'none' | 'weak' | 'moderate' | 'strong' | null;
  inferenceEvidenceUrls?: string[];
  claim?: {
    assertion: string;
    event: string;
    amount?: string | number | null;
    date: string;
    direction: 'up' | 'down' | 'neutral';
  };
}

type SignalEvidenceUpsert = NonNullable<SignalUpsert['evidence']>[number];

type SyncTable =
  | 'entities'
  | 'signals'
  | 'evidence'
  | 'claim_records'
  | 'claim_evidence_links'
  | 'claim_timeline_events';
type Row = Record<string, string | number | null>;

/**
 * Every mutation shares this predicate inside a single D1 batch transaction.
 * A preflight read alone cannot prevent a reviewer publishing during sync.
 * Reviewed claims also freeze their draft parent, including changed claim tuples.
 */
const MUTABLE = `NOT EXISTS (
  SELECT 1 FROM signals WHERE slug = ? AND review_status <> 'draft'
) AND NOT EXISTS (
  SELECT 1 FROM claim_records c JOIN signals s ON s.id = c.signal_id
  WHERE s.slug = ? AND c.review_status <> 'draft'
)`;

function syncBatch(d1: D1Database, slug: string) {
  const statements: D1PreparedStatement[] = [];
  return {
    statements,
    // Identifiers are code-owned constants below; input values are always bound.
    insert(table: SyncTable, row: Row, conflict = 'id', update: string[] = []) {
      const columns = Object.keys(row);
      const onConflict = update.length
        ? `DO UPDATE SET ${update.map((column) => `"${column}" = excluded."${column}"`).join(', ')}`
        : 'DO NOTHING';
      statements.push(
        d1
          .prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
        SELECT ${columns.map(() => '?').join(', ')} WHERE ${MUTABLE}
        ON CONFLICT ("${conflict}") ${onConflict}`)
          .bind(...Object.values(row), slug, slug)
      );
    },
    write(statement: string, ...values: (string | number)[]) {
      statements.push(d1.prepare(`${statement} AND ${MUTABLE}`).bind(...values, slug, slug));
    },
  };
}

type SyncBatch = ReturnType<typeof syncBatch>;

export async function syncSignal(d1: D1Database, signal: SignalUpsert) {
  const [existing] = await db(d1)
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(eq(schema.signals.slug, signal.slug))
    .limit(1);
  const id = existing?.id ?? (await sha16(signal.slug));
  const batch = syncBatch(d1, signal.slug);
  const now = Math.floor(Date.now() / 1000);
  const entityIds = [...new Set([signal.primaryEntityId, ...(signal.spilloverEntityIds ?? [])])];
  for (const entityId of entityIds) {
    batch.insert('entities', {
      id: entityId,
      name: entityId,
      type: 'private',
      metadata: JSON.stringify({ autoCreated: true, source: 'admin/sync' }),
      created_at: now,
      updated_at: now,
    });
  }

  const content = signalContent(signal);
  // Keep the candidate mutable until every dependent write has succeeded.
  // Incoming "published" never bypasses the explicit publication gate.
  const signalIndex = batch.statements.length;
  batch.insert(
    'signals',
    {
      id,
      slug: signal.slug,
      primary_entity_id: signal.primaryEntityId,
      review_status: 'draft',
      ...content,
    },
    'slug',
    Object.keys(content)
  );

  await queueSignalEvidence(batch, id, signal);
  if (signal.claim) await queueClaim(d1, batch, id, signal, now);
  if (signal.reviewStatus === 'corrected') {
    batch.write("UPDATE signals SET review_status = 'corrected' WHERE id = ?", id);
  }
  const results = await d1.batch(batch.statements);
  const upserts = results[signalIndex]!.meta.changes > 0 ? 1 : 0;
  return {
    upserts,
    proofUpserts: signal.claim ? upserts : 0,
    createdEntities: results
      .slice(0, entityIds.length)
      .reduce((count, result) => count + result.meta.changes, 0),
  };
}

function signalContent(signal: SignalUpsert): Row {
  const inferenceUrls = [
    ...new Set(
      (signal.inferenceEvidenceUrls ?? []).filter((url) => signal.evidenceUrls.includes(url))
    ),
  ];
  const inference =
    signal.businessInference && inferenceUrls.length ? signal.businessInference : null;
  return {
    signal_type: signal.signalType,
    direction: signal.direction,
    confidence: signal.confidence,
    predicted_window_days: signal.predictedWindowDays,
    published_at: Math.floor(new Date(signal.publishedAt).getTime() / 1000),
    evidence_urls: JSON.stringify(signal.evidenceUrls),
    spillover_entity_ids: JSON.stringify(signal.spilloverEntityIds ?? []),
    supersedes_signal_id: signal.supersedesSignalId ?? null,
    body_md: signal.bodyMd,
    observed_event: signal.observedEvent ?? null,
    direct_entity_impact: signal.directEntityImpact ?? null,
    supply_chain_impact: signal.supplyChainImpact ?? null,
    business_inference: inference,
    inference_strength: inference ? (signal.inferenceStrength ?? 'weak') : 'none',
    inference_evidence_urls: JSON.stringify(inferenceUrls),
  };
}

async function queueSignalEvidence(batch: SyncBatch, id: string, signal: SignalUpsert) {
  batch.write('DELETE FROM evidence WHERE signal_id = ?', id);
  const evidenceByUrl = new Map((signal.evidence ?? []).map((item) => [item.url, item]));
  for (const url of new Set(signal.evidenceUrls)) {
    const item = evidenceByUrl.get(url);
    const publishedAt = item?.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
    batch.insert('evidence', {
      id: await sha16(`${id}:${url}`),
      signal_id: id,
      url,
      source_type: item?.sourceType || inferSourceType(url),
      excerpt: item?.excerpt ?? null,
      published_at: Number.isFinite(publishedAt) ? Math.floor(publishedAt / 1000) : null,
    });
  }
}

async function queueClaim(
  d1: D1Database,
  batch: SyncBatch,
  signalId: string,
  signal: SignalUpsert,
  now: number
) {
  if (!signal.claim) return;
  const tuple = normalizeClaimTuple({
    entity: signal.primaryEntityId,
    event: signal.claim.event,
    amount: signal.claim.amount ?? null,
    date: signal.claim.date,
    direction: signal.claim.direction,
  });
  const claimId = await sha16(`claim:signal-extractor:${signalId}:${tuple.key}`);
  const content: Row = {
    assertion: signal.claim.assertion.trim().slice(0, 500) || signal.slug.replaceAll('-', ' '),
    confidence_band: signal.confidence,
    claim_entity_id: tuple.entity,
    claim_event: tuple.event,
    claim_amount: tuple.amount,
    claim_date: tuple.date,
    claim_direction: tuple.direction,
    claim_tuple_key: tuple.key,
  };
  batch.insert(
    'claim_records',
    {
      id: claimId,
      signal_id: signalId,
      surface: 'signal',
      review_status: 'draft',
      version: 1,
      created_at: now,
      ...content,
    },
    'id',
    Object.keys(content)
  );
  batch.insert('claim_timeline_events', {
    id: await sha16(`tl:${claimId}:created`),
    claim_id: claimId,
    kind: 'created',
    payload: JSON.stringify({ source: 'signal-extractor', signalSlug: signal.slug }),
    actor: 'signal-extractor',
    created_at: now,
  });
  const evidenceByUrl = new Map((signal.evidence ?? []).map((item) => [item.url, item]));
  for (const url of new Set(signal.evidenceUrls)) {
    await queueEvidenceLink(d1, batch, claimId, url, evidenceByUrl.get(url), now);
  }
}

async function queueEvidenceLink(
  d1: D1Database,
  batch: SyncBatch,
  claimId: string,
  url: string,
  item: SignalEvidenceUpsert | undefined,
  now: number
) {
  const sourceDocumentId = await resolveSourceDocumentId(d1, item, url);
  const rawOrigin = item?.originatingEvidenceId?.trim() || null;
  const verified =
    item?.semanticAlignment === 'verified' &&
    !!sourceDocumentId &&
    !!rawOrigin &&
    (item.role === 'primary' || item.role === 'corroboration');
  const alignment =
    item?.semanticAlignment === 'rejected' ? 'rejected' : verified ? 'verified' : 'unverified';
  const originId = rawOrigin ? await sha16(`origin:${claimId}:${rawOrigin.toLowerCase()}`) : null;
  const role = item?.role ?? 'context';
  const linkId = await sha16(`link:${claimId}:${canonicalSourceUrl(url)}`);
  const content: Row = {
    source_document_id: sourceDocumentId,
    originating_evidence_id: originId,
    semantic_alignment: alignment,
    role,
    notes: [
      'verifier:signal-extractor',
      `alignment:${alignment}`,
      item?.supports?.length ? `supports:${item.supports.join(',')}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  };
  batch.insert(
    'claim_evidence_links',
    {
      id: linkId,
      claim_id: claimId,
      evidence_url: url,
      weight: 1,
      added_at: now,
      added_by: 'signal-extractor',
      ...content,
    },
    'id',
    Object.keys(content)
  );
  batch.insert('claim_timeline_events', {
    id: await sha16(`tl:${claimId}:add:${linkId}`),
    claim_id: claimId,
    kind: 'evidence_added',
    payload: JSON.stringify({ linkId, url, role, source: 'signal-extractor' }),
    actor: 'signal-extractor',
    created_at: now,
  });
}

async function resolveSourceDocumentId(
  d1: D1Database,
  item: SignalEvidenceUpsert | undefined,
  url: string
): Promise<string | null> {
  const where = item?.sourceDocumentKey
    ? eq(schema.sourceDocuments.documentKey, item.sourceDocumentKey)
    : eq(schema.sourceDocuments.canonicalUrl, canonicalSourceUrl(url));
  const [sourceDocument] = await db(d1)
    .select({ id: schema.sourceDocuments.id })
    .from(schema.sourceDocuments)
    .where(where)
    .limit(1);
  return sourceDocument?.id ?? null;
}

function inferSourceType(url: string): string {
  if (url.includes('sec.gov')) return 'edgar';
  if (url.includes('reddit.com')) return 'reddit';
  if (url.includes('github.com')) return 'github';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'x';
  return 'web';
}
