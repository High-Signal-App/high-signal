#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import { oppositeDirectionConflictIds, publishability } from '@high-signal/shared';

const realEvidence = ['https://a.example/report', 'https://b.example/confirmation'];
const now = new Date('2026-08-25T04:00:00Z');

assert.equal(
  publishability({ evidenceUrls: realEvidence, direction: 'up', now }).publishable,
  true
);
assert.equal(
  publishability({ evidenceUrls: realEvidence, publishedAt: '2026-08-26T04:00:00Z', now }).reason,
  'future_dated'
);
assert.equal(
  publishability({ evidenceUrls: ['https://polymarket.com/event/x'] }).reason,
  'prediction-market-only evidence'
);
assert.equal(
  publishability({ evidenceUrls: realEvidence, direction: 'sideways' }).reason,
  'impossible_direction'
);
assert.equal(
  publishability({ evidenceUrls: realEvidence, unresolvedContradictions: 1 }).reason,
  'unresolved_contradiction'
);
assert.equal(
  publishability({ evidenceUrls: realEvidence, oppositeDirectionConflict: true }).reason,
  'opposite_direction_conflict'
);
assert.equal(
  publishability({ evidenceUrls: realEvidence, requireSemanticOrigins: true }).reason,
  'missing_semantic_provenance'
);
assert.equal(
  publishability({
    evidenceUrls: realEvidence,
    requireSemanticOrigins: true,
    semanticOrigins: ['one-report', 'one-report'],
  }).reason,
  'single_evidentiary_origin'
);

const conflicts = oppositeDirectionConflictIds([
  {
    id: 'up',
    primaryEntityId: 'NVDA',
    signalType: 'guidance',
    direction: 'up',
    publishedAt: '2026-08-25T01:00:00Z',
  },
  {
    id: 'down',
    primaryEntityId: 'NVDA',
    signalType: 'guidance',
    direction: 'down',
    publishedAt: '2026-08-25T02:00:00Z',
  },
]);
assert.deepEqual([...conflicts].sort(), ['down', 'up']);

console.log('publishability: mandatory gate checks passed');
