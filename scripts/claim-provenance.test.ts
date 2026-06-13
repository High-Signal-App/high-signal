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
  canTransition,
  judgePublishability,
  rollupEvidence,
  type ClaimEvidenceLink,
  type ClaimEvidenceRole,
} from "@high-signal/shared";

let failures = 0;
let total = 0;

function link(role: ClaimEvidenceRole, url = `https://example.com/${role}-${Math.random()}`): ClaimEvidenceLink {
  return {
    id: `l-${role}-${total}`,
    claimId: "c-1",
    evidenceUrl: url,
    sourceDocumentId: null,
    role,
    weight: 1,
    notes: null,
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

console.log("rollupEvidence");
{
  const r = rollupEvidence([link("primary"), link("primary"), link("corroboration"), link("context")]);
  checkEq("total counts", r.total, 4);
  checkEq("primary counts", r.primary, 2);
  checkEq("corroboration counts", r.corroboration, 1);
  checkEq("context counts", r.context, 1);
  checkEq("contradiction counts when none", r.contradiction, 0);
  checkEq("distinct urls", r.distinctUrls, 4);
  checkEq("distinct hosts", r.hosts.length, 1); // all example.com
}

{
  const r = rollupEvidence([
    link("primary", "https://a.com/x"),
    link("primary", "https://a.com/x"), // duplicate
    link("corroboration", "https://b.com/y"),
  ]);
  checkEq("distinct urls dedupes", r.distinctUrls, 2);
}

console.log("\njudgePublishability — cite-or-kill at link level");
{
  const verdict = judgePublishability(rollupEvidence([]));
  checkEq("empty kills", verdict.publishable, false);
  checkEq("empty reason", verdict.reason, "no_primary_evidence");
}
{
  const verdict = judgePublishability(rollupEvidence([link("primary")]));
  checkEq("primary-only without corroboration kills", verdict.publishable, false);
  checkEq("thin-corroboration reason", verdict.reason, "thin_corroboration");
}
{
  const verdict = judgePublishability(rollupEvidence([link("corroboration"), link("corroboration")]));
  checkEq("two corroboration without primary kills", verdict.publishable, false);
  checkEq("no-primary reason", verdict.reason, "no_primary_evidence");
}
{
  const verdict = judgePublishability(rollupEvidence([link("primary"), link("corroboration")]));
  checkEq("primary + corroboration passes", verdict.publishable, true);
}
{
  const verdict = judgePublishability(rollupEvidence([link("primary"), link("primary")]));
  checkEq("two primaries pass", verdict.publishable, true);
}
{
  const verdict = judgePublishability(
    rollupEvidence([link("primary"), link("corroboration"), link("contradiction")]),
  );
  checkEq("contradiction blocks publish", verdict.publishable, false);
  checkEq("contradiction reason", verdict.reason, "contradiction_present");
}
{
  const verdict = judgePublishability(rollupEvidence([link("primary"), link("context"), link("context")]));
  checkEq("context does not count as corroboration", verdict.publishable, false);
}

console.log("\ncanTransition — status flow guards");
checkEq("draft → published ok", canTransition("draft", "published").ok, true);
checkEq("draft → killed ok", canTransition("draft", "killed").ok, true);
checkEq("draft → held ok", canTransition("draft", "held").ok, true);
checkEq("held → published ok", canTransition("held", "published").ok, true);
checkEq("published → draft blocked", canTransition("published", "draft").ok, false);
checkEq("published → corrected ok", canTransition("published", "corrected").ok, true);
checkEq("killed → draft ok (reopen)", canTransition("killed", "draft").ok, true);
checkEq("corrected → anywhere blocked", canTransition("corrected", "draft").ok, false);
checkEq("draft → corrected blocked (use correction flow)", canTransition("draft", "corrected").ok, false);
checkEq("same status blocked", canTransition("draft", "draft").ok, false);

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
