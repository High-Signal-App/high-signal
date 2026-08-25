#!/usr/bin/env tsx
/**
 * Sync `signals/YYYY-MM-DD/*.md` (the git-versioned source of truth) into D1.
 *
 *   pnpm tsx scripts/sync-signals.ts --local
 *   pnpm tsx scripts/sync-signals.ts --remote
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeClaimTuple } from '@high-signal/shared';
import { canonicalSourceUrl, escSql as esc, parseFrontmatter } from './sync-signals.lib';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIGNALS_ROOT = resolve(__root, 'signals');
const TMP_DIR = resolve(__root, '.tmp');
const TMP_SQL = resolve(TMP_DIR, 'signals-sync.sql');
const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const CACHE_FILE = resolve(TMP_DIR, `signals-sync-cache-${flag.slice(2)}.json`);
const FORCE = process.argv.includes('--force');

type HashCache = Record<string, string>;
type SignalFront = ReturnType<typeof parseFrontmatter>['front'];

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function loadCache(): HashCache {
  if (FORCE || !existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as HashCache;
  } catch {
    return {};
  }
}

function saveCache(cache: HashCache): void {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = resolve(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.md') && f !== 'README.md') out.push(p);
  }
  return out;
}

function buildClaimEvidenceSql(front: SignalFront, claimId: string, now: number): string[] {
  const statements: string[] = [];
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
      `INSERT INTO claim_evidence_links (id,claim_id,evidence_url,source_document_id,originating_evidence_id,semantic_alignment,role,weight,notes,added_at,added_by) VALUES (${esc(linkId)},${esc(claimId)},${esc(url)},${sourceDocumentId},${esc(originId)},${alignment},${esc(role)},1,${notes},${now},'signal-extractor') ON CONFLICT(id) DO UPDATE SET source_document_id=excluded.source_document_id,originating_evidence_id=excluded.originating_evidence_id,semantic_alignment=excluded.semantic_alignment,role=excluded.role,notes=excluded.notes;`
    );
    const evidenceTimelineId = hash16(`tl:${claimId}:add:${linkId}`);
    statements.push(
      `INSERT OR IGNORE INTO claim_timeline_events (id,claim_id,kind,payload,actor,created_at) VALUES (${esc(evidenceTimelineId)},${esc(claimId)},'evidence_added',${esc(JSON.stringify({ linkId, url, role, source: 'signal-extractor' }))},'signal-extractor',${now});`
    );
  }
  return statements;
}

function buildClaimSql(front: SignalFront, signalId: string): string[] {
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
    `INSERT INTO claim_records (id,signal_id,surface,assertion,confidence_band,review_status,version,created_at,claim_entity_id,claim_event,claim_amount,claim_date,claim_direction,claim_tuple_key) VALUES (${esc(claimId)},${esc(signalId)},'signal',${esc(assertion)},${esc(front.confidence)},'draft',1,${now},${esc(tuple.entity)},${esc(tuple.event)},${esc(tuple.amount)},${esc(tuple.date)},${esc(tuple.direction)},${esc(tuple.key)}) ON CONFLICT(id) DO UPDATE SET assertion=excluded.assertion,confidence_band=excluded.confidence_band,claim_entity_id=excluded.claim_entity_id,claim_event=excluded.claim_event,claim_amount=excluded.claim_amount,claim_date=excluded.claim_date,claim_direction=excluded.claim_direction,claim_tuple_key=excluded.claim_tuple_key;`,
    `INSERT OR IGNORE INTO claim_timeline_events (id,claim_id,kind,payload,actor,created_at) VALUES (${esc(createdTimelineId)},${esc(claimId)},'created',${esc(JSON.stringify({ source: 'signal-extractor', signalSlug: front.slug }))},'signal-extractor',${now});`,
    ...buildClaimEvidenceSql(front, claimId, now),
  ];
}

function run() {
  const files = walk(SIGNALS_ROOT);
  const cache = loadCache();
  const nextCache: HashCache = {};
  console.log(`[sync] ${files.length} signal files${FORCE ? ' (force)' : ''}`);

  const sql: string[] = [];
  let skipped = 0;
  let written = 0;
  for (const fp of files) {
    const md = readFileSync(fp, 'utf-8');
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(md);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] skip ${fp}: ${reason}`);
      continue;
    }
    const f = parsed.front;
    const body = parsed.body;
    const id = hash16(f.slug);
    const contentHash = createHash('sha256').update(md).digest('hex');
    nextCache[id] = contentHash;
    if (cache[id] === contentHash) {
      skipped += 1;
      continue;
    }
    written += 1;
    const publishedAt = Math.floor(new Date(f.published_at).getTime() / 1000);
    const inferenceEvidenceUrls = (f.inference_evidence_urls ?? []).filter((url) =>
      f.evidence_urls.includes(url)
    );
    const businessInference =
      f.business_inference && inferenceEvidenceUrls.length > 0 ? f.business_inference : null;
    const reviewStatus = f.review_status === 'corrected' ? 'corrected' : 'draft';

    sql.push(
      `INSERT OR REPLACE INTO signals (id,slug,signal_type,primary_entity_id,direction,confidence,predicted_window_days,published_at,evidence_urls,spillover_entity_ids,review_status,supersedes_signal_id,body_md,observed_event,direct_entity_impact,supply_chain_impact,business_inference,inference_strength,inference_evidence_urls) VALUES (${esc(id)},${esc(f.slug)},${esc(f.signal_type)},${esc(f.primary_entity)},${esc(f.direction)},${esc(f.confidence)},${f.predicted_window_days},${publishedAt},${esc(JSON.stringify(f.evidence_urls))},${esc(JSON.stringify(f.spillover_entity_ids ?? []))},${esc(reviewStatus)},${esc(f.supersedes ?? null)},${esc(body)},${esc(f.observed_event)},${esc(f.direct_entity_impact)},${esc(f.supply_chain_impact)},${esc(businessInference)},${esc(businessInference ? (f.inference_strength ?? 'weak') : 'none')},${esc(JSON.stringify(inferenceEvidenceUrls))});`
    );
    sql.push(`DELETE FROM evidence WHERE signal_id = ${esc(id)};`);
    for (const [index, url] of f.evidence_urls.entries()) {
      const eid = hash16(`${id}:${url}`);
      const publishedAtRaw = f.evidence_published_at?.[index];
      const evidencePublishedAt =
        publishedAtRaw && Number.isFinite(new Date(publishedAtRaw).getTime())
          ? Math.floor(new Date(publishedAtRaw).getTime() / 1000)
          : null;
      sql.push(
        `INSERT INTO evidence (id,signal_id,url,source_type,excerpt,published_at) VALUES (${esc(eid)},${esc(id)},${esc(url)},${esc(f.evidence_source_types?.[index] ?? 'web')},${esc(f.evidence_quotes?.[index] || null)},${evidencePublishedAt ?? 'NULL'});`
      );
    }

    sql.push(...buildClaimSql(f, id));
  }

  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_SQL, sql.join('\n') + '\n');
  console.log(
    `[sync] wrote ${TMP_SQL} (${sql.length} statements; ${written} changed, ${skipped} unchanged)`
  );

  if (sql.length === 0) {
    console.log('[sync] nothing to apply');
    saveCache(nextCache);
    return;
  }
  const proc = spawn(
    'wrangler',
    [
      'd1',
      'execute',
      'high-signal-db',
      flag,
      `--file=${TMP_SQL}`,
      '--config=workers/api/wrangler.toml',
    ],
    { stdio: 'inherit', cwd: __root }
  );
  proc.on('close', (code) => {
    if (code === 0) saveCache(nextCache);
    process.exit(code ?? 0);
  });
}

run();
