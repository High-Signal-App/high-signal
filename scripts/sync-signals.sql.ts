import { createHash } from 'node:crypto';
import { normalizeClaimTuple } from '@high-signal/shared';
import { canonicalSourceUrl, escSql as esc, parseFrontmatter } from './sync-signals.lib';

type SignalFront = ReturnType<typeof parseFrontmatter>['front'];

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function mutableSignal(slug: string): string {
  return `NOT EXISTS (SELECT 1 FROM signals WHERE slug=${esc(slug)} AND review_status<>'draft')
    AND NOT EXISTS (SELECT 1 FROM claim_records c JOIN signals s ON s.id=c.signal_id
      WHERE s.slug=${esc(slug)} AND c.review_status<>'draft')`;
}

function buildClaimEvidenceSql(front: SignalFront, claimId: string, now: number): string[] {
  const statements: string[] = [];
  const guard = mutableSignal(front.slug);
  for (const [index, url] of front.evidence_urls.entries()) {
    const rawRole = front.proof_roles?.[index];
    const role = ['primary', 'corroboration', 'contradiction', 'context'].includes(rawRole ?? '')
      ? rawRole
      : 'context';
    const rawAlignment = front.proof_semantic_alignments?.[index];
    const rawOrigin = front.proof_originating_evidence_ids?.[index]?.trim() || null;
    const documentKey = front.proof_source_document_keys?.[index]?.trim() || null;
    const documentWhere = documentKey
      ? `document_key=${esc(documentKey)}`
      : `canonical_url=${esc(canonicalSourceUrl(url))}`;
    const sourceDocumentId = `(SELECT id FROM source_documents WHERE ${documentWhere} LIMIT 1)`;
    const eligibleForVerification =
      rawAlignment === 'verified' &&
      rawOrigin !== null &&
      (role === 'primary' || role === 'corroboration');
    const alignment =
      rawAlignment === 'rejected'
        ? `'rejected'`
        : eligibleForVerification
          ? `CASE WHEN ${sourceDocumentId} IS NOT NULL THEN 'verified' ELSE 'unverified' END`
          : `'unverified'`;
    const supports = front.proof_supports?.[index]?.trim();
    const notes = eligibleForVerification
      ? `CASE WHEN ${sourceDocumentId} IS NOT NULL THEN ${esc(`verifier:signal-extractor alignment:verified${supports ? ` supports:${supports}` : ''}`)} ELSE ${esc('verifier:signal-extractor alignment:unverified')} END`
      : esc(
          `verifier:signal-extractor alignment:${rawAlignment === 'rejected' ? 'rejected' : 'unverified'}${supports ? ` supports:${supports}` : ''}`
        );
    const originId = rawOrigin ? hash16(`origin:${claimId}:${rawOrigin.toLowerCase()}`) : null;
    const linkId = hash16(`link:${claimId}:${canonicalSourceUrl(url)}`);
    statements.push(
      `INSERT INTO claim_evidence_links (id,claim_id,evidence_url,source_document_id,originating_evidence_id,semantic_alignment,role,weight,notes,added_at,added_by) SELECT ${esc(linkId)},${esc(claimId)},${esc(url)},${sourceDocumentId},${esc(originId)},${alignment},${esc(role)},1,${notes},${now},'signal-extractor' WHERE ${guard} ON CONFLICT(id) DO UPDATE SET source_document_id=excluded.source_document_id,originating_evidence_id=excluded.originating_evidence_id,semantic_alignment=excluded.semantic_alignment,role=excluded.role,notes=excluded.notes;`
    );
    const evidenceTimelineId = hash16(`tl:${claimId}:add:${linkId}`);
    statements.push(
      `INSERT OR IGNORE INTO claim_timeline_events (id,claim_id,kind,payload,actor,created_at) SELECT ${esc(evidenceTimelineId)},${esc(claimId)},'evidence_added',${esc(JSON.stringify({ linkId, url, role, source: 'signal-extractor' }))},'signal-extractor',${now} WHERE ${guard};`
    );
  }
  return statements;
}

function buildClaimSql(front: SignalFront, signalId: string): string[] {
  const guard = mutableSignal(front.slug);
  const claimEvent = front.claim_event?.trim();
  if (!claimEvent) return [];
  const claimDirection = ['up', 'down', 'neutral'].includes(front.claim_direction ?? '')
    ? (front.claim_direction as 'up' | 'down' | 'neutral')
    : (front.direction as 'up' | 'down' | 'neutral');
  const tuple = normalizeClaimTuple({
    entity: front.primary_entity,
    event: claimEvent,
    amount: front.claim_amount ?? null,
    date: front.claim_date ?? front.published_at,
    direction: claimDirection,
  });
  const claimId = hash16(`claim:signal-extractor:${signalId}:${tuple.key}`);
  const now = Math.floor(Date.now() / 1000);
  const assertion = front.claim_assertion?.trim() || front.slug.replaceAll('-', ' ');
  const createdTimelineId = hash16(`tl:${claimId}:created`);
  return [
    `INSERT INTO claim_records (id,signal_id,surface,assertion,confidence_band,review_status,version,created_at,claim_entity_id,claim_event,claim_amount,claim_date,claim_direction,claim_tuple_key) SELECT ${esc(claimId)},${esc(signalId)},'signal',${esc(assertion)},${esc(front.confidence)},'draft',1,${now},${esc(tuple.entity)},${esc(tuple.event)},${esc(tuple.amount)},${esc(tuple.date)},${esc(tuple.direction)},${esc(tuple.key)} WHERE ${guard} ON CONFLICT(id) DO UPDATE SET assertion=excluded.assertion,confidence_band=excluded.confidence_band,claim_entity_id=excluded.claim_entity_id,claim_event=excluded.claim_event,claim_amount=excluded.claim_amount,claim_date=excluded.claim_date,claim_direction=excluded.claim_direction,claim_tuple_key=excluded.claim_tuple_key;`,
    `INSERT OR IGNORE INTO claim_timeline_events (id,claim_id,kind,payload,actor,created_at) SELECT ${esc(createdTimelineId)},${esc(claimId)},'created',${esc(JSON.stringify({ source: 'signal-extractor', signalSlug: front.slug }))},'signal-extractor',${now} WHERE ${guard};`,
    ...buildClaimEvidenceSql(front, claimId, now),
  ];
}

/** Wrangler executes this SQL file as one batch/import, rolling back failures. */
export function buildSignalSql(f: SignalFront, body: string): string[] {
  const id = hash16(f.slug);
  const sql: string[] = [];
  const guard = mutableSignal(f.slug);
  const publishedAt = Math.floor(new Date(f.published_at).getTime() / 1000);
  const inferenceEvidenceUrls = (f.inference_evidence_urls ?? []).filter((url) =>
    f.evidence_urls.includes(url)
  );
  const businessInference =
    f.business_inference && inferenceEvidenceUrls.length > 0 ? f.business_inference : null;
  const reviewStatus = f.review_status === 'corrected' ? 'corrected' : 'draft';

  sql.push(
    `INSERT INTO signals (id,slug,signal_type,primary_entity_id,direction,confidence,predicted_window_days,published_at,evidence_urls,spillover_entity_ids,review_status,supersedes_signal_id,body_md,observed_event,direct_entity_impact,supply_chain_impact,business_inference,inference_strength,inference_evidence_urls) SELECT ${esc(id)},${esc(f.slug)},${esc(f.signal_type)},${esc(f.primary_entity)},${esc(f.direction)},${esc(f.confidence)},${f.predicted_window_days},${publishedAt},${esc(JSON.stringify(f.evidence_urls))},${esc(JSON.stringify(f.spillover_entity_ids ?? []))},'draft',${esc(f.supersedes ?? null)},${esc(body)},${esc(f.observed_event)},${esc(f.direct_entity_impact)},${esc(f.supply_chain_impact)},${esc(businessInference)},${esc(businessInference ? (f.inference_strength ?? 'weak') : 'none')},${esc(JSON.stringify(inferenceEvidenceUrls))} WHERE ${guard} ON CONFLICT(slug) DO UPDATE SET signal_type=excluded.signal_type,direction=excluded.direction,confidence=excluded.confidence,predicted_window_days=excluded.predicted_window_days,published_at=excluded.published_at,evidence_urls=excluded.evidence_urls,spillover_entity_ids=excluded.spillover_entity_ids,supersedes_signal_id=excluded.supersedes_signal_id,body_md=excluded.body_md,observed_event=excluded.observed_event,direct_entity_impact=excluded.direct_entity_impact,supply_chain_impact=excluded.supply_chain_impact,business_inference=excluded.business_inference,inference_strength=excluded.inference_strength,inference_evidence_urls=excluded.inference_evidence_urls;`
  );
  sql.push(`DELETE FROM evidence WHERE signal_id = ${esc(id)} AND ${guard};`);
  for (const [index, url] of f.evidence_urls.entries()) {
    const eid = hash16(`${id}:${url}`);
    const publishedAtRaw = f.evidence_published_at?.[index];
    const evidencePublishedAt =
      publishedAtRaw && Number.isFinite(new Date(publishedAtRaw).getTime())
        ? Math.floor(new Date(publishedAtRaw).getTime() / 1000)
        : null;
    sql.push(
      `INSERT INTO evidence (id,signal_id,url,source_type,excerpt,published_at) SELECT ${esc(eid)},${esc(id)},${esc(url)},${esc(f.evidence_source_types?.[index] ?? 'web')},${esc(f.evidence_quotes?.[index] || null)},${evidencePublishedAt ?? 'NULL'} WHERE ${guard};`
    );
  }

  sql.push(...buildClaimSql(f, id));
  if (reviewStatus === 'corrected') {
    sql.push(`UPDATE signals SET review_status='corrected' WHERE id=${esc(id)} AND ${guard};`);
  }
  return sql;
}
