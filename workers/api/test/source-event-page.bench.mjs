import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { sourceKeyPagePlan, sourcePageWorthResolving } from '../src/lib/source-event-page.ts';

// Aggregate production shape, synthetic values only. Age skew is intentional:
// the family can be large yet sit below all newer unrelated observations.
const total = 629511;
const familyRows = 42764;
const sources = Array.from({ length: 6 }, (_, i) => `us-gov-api:fixture-${i}`);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE events (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_url TEXT NOT NULL,
  published_at INTEGER NOT NULL, title TEXT, content TEXT,
  primary_entity_id TEXT, ingested_at INTEGER NOT NULL
);
CREATE INDEX events_source_rollup_idx ON events(source,published_at,ingested_at);
CREATE INDEX events_published_id_idx ON events(published_at,id);`);
const insert = db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,NULL,?)');
db.exec('BEGIN');
for (let i = 0; i < total; i++) {
  const family = i < familyRows;
  const id = `fixture-${String(i).padStart(8, '0')}`;
  const at = family ? 100000 + Math.floor(i / 18) : 200000 + Math.floor(i / 18);
  insert.run(
    id,
    family ? sources[i % sources.length] : 'other',
    `https://example.test/${id}`,
    at,
    id,
    `content-${id}`,
    at
  );
}
db.exec('COMMIT');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const oldSql = `SELECT id,title,content,source_url AS url,source,primary_entity_id AS entity,published_at AS publishedAt
 FROM events WHERE source='us-gov-api' OR source LIKE 'us-gov-api:%' OR source GLOB 'us-gov-api_*'
 ORDER BY published_at DESC,id DESC LIMIT ? OFFSET ?`;
const results = [];
for (const offset of [0, 50, 500, 5000, 20000, 40000]) {
  const plan = sourceKeyPagePlan(sources, { limit: 50, offset, range: null, cursor: null });
  assert.ok(plan);
  const before = db.prepare(oldSql);
  const selected = sourcePageWorthResolving(sources.length, familyRows, total, offset + 51);
  const after = selected ? db.prepare(plan.query) : before;
  const afterParams = selected ? plan.params : [51, offset];
  const expected = before.all(51, offset);
  assert.deepEqual(after.all(...afterParams), expected);
  const timings = { before: [], after: [] };
  for (let pair = 0; pair < 7; pair++) {
    for (const name of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now();
      const rows = name === 'before' ? before.all(51, offset) : after.all(...afterParams);
      timings[name].push(performance.now() - start);
      assert.deepEqual(rows, expected);
    }
  }
  results.push({
    offset,
    rows: expected.length,
    parity: true,
    usesKeyPage: selected,
    beforeMedianMs: median(timings.before),
    afterMedianMs: median(timings.after),
    speedup: median(timings.before) / median(timings.after),
    samples: timings,
  });
}
db.close();
console.log(
  JSON.stringify(
    {
      method:
        'same in-memory SQLite dataset; alternating paired queries; seven pairs; exact payload parity',
      totalRows: total,
      familyRows,
      sourceValues: sources.length,
      results,
    },
    null,
    2
  )
);
