#!/usr/bin/env tsx
/**
 * Unit tests for plan 0008 claim-provenance helpers.
 *
 * Run: `pnpm claim-provenance:test`
 *
 * Same tiny-runner pattern as scripts/auto-publish-rules.test.ts — no vitest
 * dependency. Covers the rollup math, cite-or-kill at link level, and the
 * status-transition rules the worker and editor share.
 */

import {
  buildHistoricalClaimBackfill,
  normalizeClaimTuple,
  isIndependentCorroboration,
  canTransition,
  judgePublishability,
  rollupEvidence,
  selectBriefClaimProvenance,
  type ClaimEvidenceLink,
  type ClaimEvidenceRole,
} from '@high-signal/shared';

let failures = 0;
let total = 0;

function link(
  role: ClaimEvidenceRole,
  url = `https://example.com/${role}-${Math.random()}`
): ClaimEvidenceLink {
  return {
    id: `l-${role}-${total}`,
    claimId: 'c-1',
    evidenceUrl: url,
    sourceDocumentId: `source-${role}-${total}`,
    originatingEvidenceId: `origin-${role}-${total}`,
    semanticAlignment: 'verified',
    role,
    weight: 1,
    notes: 'alignment:verified',
    addedAt: new Date().toISOString(),
    addedBy: null,
  };
}

function checkEq<T>(label: string, actual: T, expected: T) {
  total++;
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

console.log('rollupEvidence');

console.log('historical backfill derivation');
{
  const backfill = buildHistoricalClaimBackfill({
    bodyMd: '# NVIDIA capacity expands\n\nMore context.',
    fallbackAssertion: 'fallback',
    evidenceUrls: ['https://a.example/x', 'https://a.example/x', 'https://b.example/y'],
  });
  checkEq('headline becomes assertion', backfill.assertion, 'NVIDIA capacity expands');
  checkEq('backfill deduplicates urls', backfill.evidence.length, 2);
  checkEq('first evidence is primary', backfill.evidence[0]?.role, 'primary');
  checkEq(
    'a different publisher remains context until semantic verification',
    backfill.evidence[1]?.role,
    'context'
  );
}

{
  const tuple = normalizeClaimTuple({
    entity: ' NVIDIA ',
    event: ' Capacity Expansion ',
    amount: '$5B',
    date: '2026-08-25T03:00:00Z',
    direction: 'up',
  });
  checkEq('claim tuple normalizes entity', tuple.entity, 'nvidia');
  checkEq(
    'claim tuple key includes entity event amount date direction',
    tuple.key,
    'nvidia|capacity expansion|$5b|2026-08-25|up'
  );
}
{
  // Same publisher twice is the same outlet, not corroboration.
  const sameHost = buildHistoricalClaimBackfill({
    bodyMd: '# Same outlet twice',
    fallbackAssertion: 'fallback',
    evidenceUrls: ['https://a.example/one', 'https://a.example/two'],
  });
  checkEq('same-host second link stays context', sameHost.evidence[1]?.role, 'context');

  // Crowd opinion never corroborates; the auto-publish rubric already kills it.
  const market = buildHistoricalClaimBackfill({
    bodyMd: '# Market only',
    fallbackAssertion: 'fallback',
    evidenceUrls: ['https://a.example/one', 'https://polymarket.com/event/two'],
  });
  checkEq('prediction market stays context', market.evidence[1]?.role, 'context');

  // Exactly one corroboration; extra independent sources remain context so the
  // count reflects a decision rather than a source tally.
  const many = buildHistoricalClaimBackfill({
    bodyMd: '# Three publishers',
    fallbackAssertion: 'fallback',
    evidenceUrls: ['https://a.example/one', 'https://b.example/two', 'https://c.example/three'],
  });
  checkEq('independent links still await semantic verification', many.evidence[1]?.role, 'context');
  checkEq('further independent links stay context', many.evidence[2]?.role, 'context');

  // A non-citation cannot corroborate anything.
  const bad = buildHistoricalClaimBackfill({
    bodyMd: '# Bad link',
    fallbackAssertion: 'fallback',
    evidenceUrls: ['https://a.example/one', 'javascript:alert(1)'],
  });
  checkEq('non-http link stays context', bad.evidence[1]?.role, 'context');

  checkEq(
    'isIndependentCorroboration rejects same host',
    isIndependentCorroboration('https://a.example/one', 'https://www.a.example/two'),
    false
  );
  checkEq(
    'isIndependentCorroboration accepts a different host',
    isIndependentCorroboration('https://a.example/one', 'https://b.example/two'),
    true
  );
}
{
  const r = rollupEvidence([
    link('primary'),
    link('primary'),
    link('corroboration'),
    link('context'),
  ]);
  checkEq('total counts', r.total, 4);
  checkEq('primary counts', r.primary, 2);
  checkEq('corroboration counts', r.corroboration, 1);
  checkEq('context counts', r.context, 1);
  checkEq('contradiction counts when none', r.contradiction, 0);
  checkEq('distinct urls', r.distinctUrls, 4);
  checkEq('distinct hosts', r.hosts.length, 1); // all example.com
}

console.log('\nselectBriefClaimProvenance');
{
  const now = new Date().toISOString();
  const claim = {
    id: 'c-summary',
    signalId: 'signal-1',
    briefItemId: null,
    agentEvalResponseId: null,
    surface: 'signal' as const,
    assertion: 'Structured claim',
    confidenceBand: 'high' as const,
    reviewStatus: 'published' as const,
    publishReason: 'two sources',
    parentClaimId: null,
    version: 2,
    createdAt: now,
    publishedAt: now,
    correctedAt: null,
    evidence: [
      link('primary', 'https://a.example/x'),
      link('corroboration', 'https://b.example/y'),
    ],
  };
  const summary = selectBriefClaimProvenance([claim]);
  checkEq('summary selects evidence-backed claim', summary?.claimId, 'c-summary');
  checkEq('summary reports evidence count', summary?.evidenceCount, 2);
  checkEq('empty claim list has no summary', selectBriefClaimProvenance([]), null);
}

{
  const r = rollupEvidence([
    link('primary', 'https://a.com/x'),
    link('primary', 'https://a.com/x'), // duplicate
    link('corroboration', 'https://b.com/y'),
  ]);
  checkEq('distinct urls dedupes', r.distinctUrls, 2);
}

console.log('\njudgePublishability — cite-or-kill at link level');
{
  const verdict = judgePublishability(rollupEvidence([]));
  checkEq('empty kills', verdict.publishable, false);
  checkEq('empty reason', verdict.reason, 'no_primary_evidence');
}
{
  const verdict = judgePublishability(rollupEvidence([link('primary')]));
  checkEq('primary-only without corroboration kills', verdict.publishable, false);
  checkEq('thin-corroboration reason', verdict.reason, 'thin_corroboration');
}
{
  const verdict = judgePublishability(
    rollupEvidence([link('corroboration'), link('corroboration')])
  );
  checkEq('two corroboration without primary kills', verdict.publishable, false);
  checkEq('no-primary reason', verdict.reason, 'no_primary_evidence');
}
{
  const verdict = judgePublishability(rollupEvidence([link('primary'), link('corroboration')]));
  checkEq('same-host primary + corroboration fails', verdict.publishable, false);
  checkEq('same-host reason', verdict.reason, 'support_not_independent');
}
{
  const verdict = judgePublishability(
    rollupEvidence([
      link('primary', 'https://primary.example/source'),
      link('corroboration', 'https://corroboration.example/source'),
    ])
  );
  checkEq('independent primary + corroboration passes', verdict.publishable, true);
}
{
  const primary = link('primary', 'https://primary.example/source');
  const repeated = link('corroboration', 'https://repeater.example/source');
  repeated.originatingEvidenceId = primary.originatingEvidenceId;
  const verdict = judgePublishability(rollupEvidence([primary, repeated]));
  checkEq('two publishers repeating one origin fail', verdict.publishable, false);
  checkEq('single-origin reason', verdict.reason, 'single_evidentiary_origin');
}
{
  const verdict = judgePublishability(
    rollupEvidence([
      link('primary', 'https://primary.example/source'),
      link('primary', 'https://second.example/source'),
    ])
  );
  checkEq('two primaries do not replace corroboration', verdict.publishable, false);
}
{
  const verdict = judgePublishability(
    rollupEvidence([link('primary'), link('corroboration'), link('contradiction')])
  );
  checkEq('contradiction blocks publish', verdict.publishable, false);
  checkEq('contradiction reason', verdict.reason, 'contradiction_present');
}
{
  const verdict = judgePublishability(
    rollupEvidence([link('primary'), link('context'), link('context')])
  );
  checkEq('context does not count as corroboration', verdict.publishable, false);
}
{
  const unusable = link('corroboration', 'https://corroboration.example/source');
  unusable.notes = 'alignment:rejected';
  const verdict = judgePublishability(
    rollupEvidence([link('primary', 'https://primary.example/source'), unusable])
  );
  checkEq('rejected alignment receives no corroboration credit', verdict.publishable, false);
}
{
  const noReceipt = link('corroboration', 'https://corroboration.example/source');
  noReceipt.sourceDocumentId = null;
  const verdict = judgePublishability(
    rollupEvidence([link('primary', 'https://primary.example/source'), noReceipt])
  );
  checkEq('support without a retained receipt receives no credit', verdict.publishable, false);
}
{
  const unverified = link('corroboration', 'https://corroboration.example/source');
  unverified.notes = null;
  unverified.semanticAlignment = 'unverified';
  const verdict = judgePublishability(
    rollupEvidence([link('primary', 'https://primary.example/source'), unverified])
  );
  checkEq('support without verified alignment receives no credit', verdict.publishable, false);
}

console.log('\ncanTransition — status flow guards');
checkEq('draft → published ok', canTransition('draft', 'published').ok, true);
checkEq('draft → killed ok', canTransition('draft', 'killed').ok, true);
checkEq('draft → held ok', canTransition('draft', 'held').ok, true);
checkEq('held → published ok', canTransition('held', 'published').ok, true);
checkEq('published → draft blocked', canTransition('published', 'draft').ok, false);
checkEq('published → corrected ok', canTransition('published', 'corrected').ok, true);
checkEq('killed → draft ok (reopen)', canTransition('killed', 'draft').ok, true);
checkEq('corrected → anywhere blocked', canTransition('corrected', 'draft').ok, false);
checkEq(
  'draft → corrected blocked (use correction flow)',
  canTransition('draft', 'corrected').ok,
  false
);
checkEq('same status blocked', canTransition('draft', 'draft').ok, false);

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
