#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { escSql, parseFrontmatter, parseTinyYaml } from "./sync-signals.lib";

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
---

body text`;

const parsed = parseFrontmatter(VALID);
assert.equal(parsed.front.slug, "nvda-h100");
assert.equal(parsed.front.predicted_window_days, 20);
assert.deepEqual(parsed.front.evidence_urls, [
  "https://example.com/a",
  "https://example.com/b",
]);
assert.deepEqual(parsed.front.evidence_quotes, [
  "supplier lead times tightened again",
  "customer allocation shifted toward the new cluster",
]);
assert.deepEqual(parsed.front.evidence_source_types, ["news", "official"]);
assert.deepEqual(parsed.front.spillover_entity_ids, ["ASML", "AMAT"]);
assert.equal(parsed.front.supersedes, null);
assert.equal(parsed.body, "body text");

// parseTinyYaml inline list edge: spaces around commas, empty elements.
const inline = parseTinyYaml("tags: [a , b ,, c]");
assert.deepEqual(inline.tags, ["a", "b", "c"]);

// parseTinyYaml block list with trailing blank line.
const block = parseTinyYaml("evidence_urls:\n  - one\n  - two\n");
assert.deepEqual(block.evidence_urls, ["one", "two"]);

// parseTinyYaml strips surrounding quotes only at the edges.
assert.equal(parseTinyYaml(`title: "it's fine"`).title, "it's fine");

// SQL escape doubles single quotes.
assert.equal(escSql("Sam's tools"), "'Sam''s tools'");
assert.equal(escSql(null), "NULL");
assert.equal(escSql(undefined), "NULL");

// Missing frontmatter delimiters throws a clear error.
assert.throws(() => parseFrontmatter("no front\nmatter here"), /missing frontmatter/);

// Missing required fields names them in the error.
const missingDirection = VALID.replace(/direction: up\n/, "");
assert.throws(() => parseFrontmatter(missingDirection), /direction/);

// Empty evidence list rejected.
const emptyEvidence = VALID.replace(
  /evidence_urls:\n  - https:\/\/example\.com\/a\n  - https:\/\/example\.com\/b/,
  "evidence_urls:",
);
assert.throws(() => parseFrontmatter(emptyEvidence), /evidence_urls/);

// Invalid review_status rejected.
const badReview = VALID.replace("review_status: draft", "review_status: archived");
assert.throws(() => parseFrontmatter(badReview), /review_status/);

// Non-numeric predicted_window_days rejected.
const badWindow = VALID.replace(
  "predicted_window_days: 20",
  "predicted_window_days: soon",
);
assert.throws(() => parseFrontmatter(badWindow), /predicted_window_days/);

// Bad ISO date rejected.
const badDate = VALID.replace("2026-05-01T14:30:00Z", "yesterday");
assert.throws(() => parseFrontmatter(badDate), /published_at/);

console.log("sync-signals.test.ts: ok");
