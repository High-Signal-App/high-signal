#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { buildSignalSql } from './sync-signals.sql';
import { canonicalSourceUrl, escSql, parseFrontmatter, parseTinyYaml } from './sync-signals.lib';

const VALID = `---
slug: nvda-h100
signal_type: lead_time_shift
primary_entity: NVDA
direction: up
confidence: medium
predicted_window_days: 20
published_at: 2026-05-01T14:30:00Z
evidence_urls:
  - https://example.com/a
  - https://example.com/b
evidence_quotes:
  - "supplier lead times tightened again"
  - "customer allocation shifted toward the new cluster"
evidence_source_types:
  - news
  - official
spillover_entity_ids: [ASML, AMAT]
supersedes: null
review_status: draft
claim_assertion: NVIDIA expanded capacity
claim_event: capacity expansion
claim_date: '2026-05-01'
claim_direction: up
proof_originating_evidence_ids:
  - announcement-1
  - filing-2
proof_semantic_alignments:
  - verified
  - verified
proof_roles:
  - primary
  - corroboration
---

body text`;

const parsed = parseFrontmatter(VALID);
assert.equal(parsed.front.slug, 'nvda-h100');
assert.equal(parsed.front.predicted_window_days, 20);
assert.deepEqual(parsed.front.evidence_urls, ['https://example.com/a', 'https://example.com/b']);
assert.deepEqual(parsed.front.evidence_quotes, [
  'supplier lead times tightened again',
  'customer allocation shifted toward the new cluster',
]);
assert.deepEqual(parsed.front.evidence_source_types, ['news', 'official']);
assert.deepEqual(parsed.front.spillover_entity_ids, ['ASML', 'AMAT']);
assert.equal(parsed.front.supersedes, null);
assert.equal(parsed.front.claim_event, 'capacity expansion');
assert.deepEqual(parsed.front.proof_roles, ['primary', 'corroboration']);
assert.equal(parsed.body, 'body text');

// parseTinyYaml inline list edge: spaces around commas, empty elements.
const inline = parseTinyYaml('tags: [a , b ,, c]');
assert.deepEqual(inline.tags, ['a', 'b', 'c']);

// parseTinyYaml block list with trailing blank line.
const block = parseTinyYaml('evidence_urls:\n  - one\n  - two\n');
assert.deepEqual(block.evidence_urls, ['one', 'two']);

// parseTinyYaml strips surrounding quotes only at the edges.
assert.equal(parseTinyYaml(`title: "it's fine"`).title, "it's fine");

// SQL escape doubles single quotes.
assert.equal(escSql("Sam's tools"), "'Sam''s tools'");
assert.equal(escSql(null), 'NULL');
assert.equal(escSql(undefined), 'NULL');

assert.equal(
  canonicalSourceUrl('https://www.example.com/a/?utm_source=x&keep=1#section'),
  'https://example.com/a/?keep=1'
);

// Missing frontmatter delimiters throws a clear error.
assert.throws(() => parseFrontmatter('no front\nmatter here'), /missing frontmatter/);

// Missing required fields names them in the error.
const missingDirection = VALID.replace(/direction: up\n/, '');
assert.throws(() => parseFrontmatter(missingDirection), /direction/);

// Empty evidence list rejected.
const emptyEvidence = VALID.replace(
  /evidence_urls:\n {2}- https:\/\/example\.com\/a\n {2}- https:\/\/example\.com\/b/,
  'evidence_urls:'
);
assert.throws(() => parseFrontmatter(emptyEvidence), /evidence_urls/);

// Invalid review_status rejected.
const badReview = VALID.replace('review_status: draft', 'review_status: archived');
assert.throws(() => parseFrontmatter(badReview), /review_status/);

// Non-numeric predicted_window_days rejected.
const badWindow = VALID.replace('predicted_window_days: 20', 'predicted_window_days: soon');
assert.throws(() => parseFrontmatter(badWindow), /predicted_window_days/);

// Bad ISO date rejected.
const badDate = VALID.replace('2026-05-01T14:30:00Z', 'yesterday');
assert.throws(() => parseFrontmatter(badDate), /published_at/);

// Exercise generated operator-import SQL against the actual schema, not SQL strings.
const database = new DatabaseSync(':memory:');
const migrations = new URL('../packages/db/migrations/', import.meta.url);
for (const file of readdirSync(migrations)
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  database.exec(readFileSync(new URL(file, migrations), 'utf8'));
}
database.exec(`PRAGMA foreign_keys = ON;
  INSERT INTO entities (id, name, type, created_at, updated_at) VALUES ('NVDA', 'NVIDIA', 'public', 1, 1)`);
const apply = (front = parsed.front, body = parsed.body) => {
  database.exec('BEGIN');
  try {
    database.exec(buildSignalSql(front, body).join('\n'));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};
const snapshot = () =>
  Object.fromEntries(
    ['signals', 'evidence', 'claim_records', 'claim_evidence_links', 'claim_timeline_events'].map(
      (table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]
    )
  );
try {
  apply();
  apply(parsed.front, 'A newer unreviewed draft');
  assert.equal(
    database.prepare('SELECT body_md FROM signals').get()!.body_md,
    'A newer unreviewed draft'
  );
  for (const status of ['published', 'corrected', 'killed']) {
    database.prepare('UPDATE signals SET review_status = ?').run(status);
    const before = snapshot();
    apply(
      { ...parsed.front, claim_assertion: 'Unsupported replacement' },
      'Changed reviewed prose'
    );
    assert.deepEqual(snapshot(), before, `${status} signal history must be immutable`);
  }
  database.exec("UPDATE signals SET review_status = 'draft'");
  for (const status of ['held', 'published', 'corrected', 'killed']) {
    database.prepare('UPDATE claim_records SET review_status = ?').run(status);
    const before = snapshot();
    apply({ ...parsed.front, claim_event: 'Different event' }, 'Changed proof history');
    assert.deepEqual(snapshot(), before, `${status} claim must freeze its parent`);
  }
  database.exec("UPDATE claim_records SET review_status = 'draft'");
  const beforeFailure = snapshot();
  database.exec(`CREATE TRIGGER fail_proof BEFORE INSERT ON claim_evidence_links
    BEGIN SELECT RAISE(ABORT, 'injected proof failure'); END`);
  assert.throws(() => apply(parsed.front, 'Partial write attempt'), /injected proof failure/);
  assert.deepEqual(snapshot(), beforeFailure, 'Failed import must roll back all candidate writes');
  database.exec('DROP TRIGGER fail_proof');
  apply(
    { ...parsed.front, slug: 'nvda-correction', review_status: 'corrected' },
    'A new correction'
  );
  const beforeCorrectionReplay = snapshot();
  apply(
    { ...parsed.front, slug: 'nvda-correction', review_status: 'corrected' },
    'Rewritten correction'
  );
  assert.deepEqual(snapshot(), beforeCorrectionReplay);
} finally {
  database.close();
}

console.log('sync-signals.test.ts: parsing and transactional history checks passed');
