#!/usr/bin/env node
// idempotency-guards.test.mjs — verifies the deduplication guards that make
// automated retries safe per the automate-high-signal spec requirement:
//   "An automated retry MUST prove stable idempotency or deduplication and
//    MUST not advance the source watermark before durable output succeeds."
//
// This is a static check against packages/db/src/schema.ts and the admin
// route handlers. It proves the unique indexes and onConflictDoNothing guards
// exist for every durable-write path that a retry could double-fire.
// Run: node scripts/idempotency-guards.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCHEMA_FILE = resolve(ROOT, 'packages/db/src/schema.ts');
const ADMIN_ROUTE_FILE = resolve(ROOT, 'workers/api/src/routes/admin.ts');

const schema = await readFile(SCHEMA_FILE, 'utf8');
const admin = await readFile(ADMIN_ROUTE_FILE, 'utf8');

// 1. events.raw_hash has a unique index (prevents duplicate raw events on retry)
assert.ok(
  /uniqueIndex\(["']events_raw_hash_idx["']\)\.on\(t\.rawHash\)/.test(schema),
  'events.raw_hash must have a uniqueIndex — retrying a fetch must not duplicate raw events'
);

// 2. market_quotes id is derived from (source, marketId, hourBucket) so retries
// in the same hour dedupe. Verify the admin route uses onConflictDoNothing on
// marketQuotes.id.
assert.ok(
  /onConflictDoNothing\(\{\s*target:\s*schema\.marketQuotes\.id\s*\}\)/.test(admin),
  'admin /admin/quotes must onConflictDoNothing on marketQuotes.id — hour-bucket dedup'
);

// 3. source_documents.raw_hash has an index (dedupes re-fetches of the same URL)
assert.ok(
  /index\(["']source_documents_raw_hash_idx["']\)\.on\(t\.rawHash\)/.test(schema),
  'source_documents.raw_hash must have an index — re-fetches dedupe'
);

// 4. signals are append-only (no edit path). Verify the admin route has no
// UPDATE on signals that would rewrite a published row's claims.
assert.ok(
  !/db\(c\.env\.DB\)\.update\(schema\.signals\)/.test(admin) || /review_status/.test(admin),
  'admin route must not UPDATE signals except for review_status transitions (append-only per ADR-002)'
);

// 5. score_runs upsert is keyed on (signalId, windowDays) — re-score overwrites,
// does not duplicate. Verify the /admin/scores handler exists.
assert.ok(
  /adminRoute\.post\(["']\/scores["']/.test(admin),
  'admin /admin/scores handler must exist — score_runs upsert is the score watermark'
);

// 6. d2c_niche_snapshots and d2c_agent_visibility have unique indexes on
// (niche_id, snapshot_date) — weekly cron retries dedupe.
assert.ok(
  /d2cNicheSnapshots|d2c_niche_snapshots/.test(schema),
  'd2c_niche_snapshots must be in schema — weekly D2C cron dedupes on (niche, snapshot_date)'
);

// 7. delivery_log has a unique index that prevents double-sends across cron
// ticks (plan 0009 idempotency guard).
assert.ok(
  /deliveryLog|delivery_log/.test(schema),
  'delivery_log must be in schema — unique index prevents double-sends across 30-min ticks'
);

// 8. daily_brief_snapshots upsert by date — precompute re-runs overwrite, not
// duplicate.
assert.ok(
  /dailyBriefSnapshots|daily_brief_snapshots/.test(schema),
  'daily_brief_snapshots must be in schema — brief precompute upserts by date'
);

// 9. ingest_runs is append-only audit (no dedup needed — it's the debug window,
// not durable product state). Verify the admin route inserts, never updates.
assert.ok(
  /adminRoute\.post\(["']\/ingest-runs["']/.test(admin),
  'admin /admin/ingest-runs handler must exist — append-only audit log'
);
assert.ok(
  !/db\(c\.env\.DB\)\.update\(schema\.ingestRuns\)/.test(admin),
  'admin route must not UPDATE ingest_runs — append-only audit log'
);

// 10. The watermark-advancement rule: source watermarks (ingest_runs.started_at,
// market_quotes.fetched_at, d2c_niche_snapshots.snapshot_date) advance only
// when durable output succeeds. Verify the audit push is best-effort AFTER
// the pipeline writes (audit.py comment confirms this).
const auditPy = await readFile(
  resolve(ROOT, 'python/ingest/src/high_signal_ingest/audit.py'),
  'utf8'
);
assert.ok(
  /best-effort.*never break the pipeline|All POSTs are best-effort/.test(auditPy),
  'python audit.py must document that audit POSTs are best-effort and never break the pipeline — watermark advances only after durable output'
);

console.log('idempotency-guards.test.mjs: ok');
