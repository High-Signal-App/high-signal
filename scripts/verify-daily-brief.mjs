#!/usr/bin/env node
/**
 * Fail loudly when the public brief has silently stopped publishing.
 *
 * Why this exists: between 2026-08-11 and 2026-08-22 the global edition
 * published nothing every single day. `precomputeBriefSnapshots` rejected each
 * edition at `console.warn` and wrote no snapshot row, so `/brief/daily` 404'd
 * and the page rendered "no qualifying items" — which reads as a quiet news day
 * rather than an outage. Twelve days passed before anyone noticed. Nothing in
 * CI asserted that the product's one daily output existed.
 *
 * This checks the deployed API, not the database, so it verifies what a reader
 * actually gets. No credentials required — the brief is public.
 *
 * Exit code:
 *   0  — every checked region served a non-empty edition
 *   1+ — count of regions that failed
 *
 * Run:
 *   node scripts/verify-daily-brief.mjs
 *   HIGH_SIGNAL_API=http://localhost:8787 node scripts/verify-daily-brief.mjs
 *   BRIEF_REGIONS=global,south-asia node scripts/verify-daily-brief.mjs
 */

import { calendarDate, validateBriefFreshness } from './verify-daily-brief-lib.mjs';

const API = process.env.HIGH_SIGNAL_API ?? 'https://api.highsignal.app';
const REGIONS = (process.env.BRIEF_REGIONS ?? 'global')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

/** A region is healthy when the edition resolves and carries at least one item. */
async function checkRegion(region, dailyDump, now) {
  const expectedDate = calendarDate(now);
  const url = `${API}/brief/daily?region=${encodeURIComponent(region)}&date=${expectedDate}&validation=${now.getTime()}`;
  const res = await fetch(url);

  if (res.status === 404) {
    throw new Error(
      'no snapshot for today — precompute either never ran or rejected the edition. ' +
        'Check the Worker logs for "[brief-precompute] ' +
        region +
        ' REJECTED".'
    );
  }
  if (!res.ok) throw new Error(`status ${res.status}`);

  const brief = await res.json();
  const sections = ['stocks', 'ideas', 'trends'];
  const counts = Object.fromEntries(
    sections.map((key) => [key, Array.isArray(brief?.[key]) ? brief[key].length : 0])
  );
  const total = sections.reduce((sum, key) => sum + counts[key], 0);

  const withheld = sections.filter(
    (key) => brief?.categoryStates?.[key]?.reason === 'items_withheld_by_publish_gate'
  );

  if (total === 0) {
    throw new Error(
      `edition served but every section is empty (${JSON.stringify(counts)})` +
        (withheld.length > 0
          ? ` — ${withheld.join(', ')} had items withheld by the publish gate, so this is a gate ` +
            'failure, not a quiet day'
          : '')
    );
  }

  const freshness = validateBriefFreshness(brief, dailyDump, now);
  return { counts, total, withheld, freshness };
}

let failures = 0;
const now = new Date();
const expectedDate = calendarDate(now);
let dailyDump = null;

try {
  const response = await fetch(
    `${API}/data/daily?date=${expectedDate}&validation=${now.getTime()}`
  );
  if (!response.ok) throw new Error(`status ${response.status}`);
  dailyDump = await response.json();
} catch (err) {
  failures++;
  process.stdout.write(`✗ daily dump ... ${err instanceof Error ? err.message : String(err)}\n`);
}

for (const region of REGIONS) {
  process.stdout.write(`→ ${region} ... `);
  try {
    if (!dailyDump) throw new Error('daily dump unavailable');
    const { counts, total, withheld, freshness } = await checkRegion(region, dailyDump, now);
    const suffix = withheld.length > 0 ? ` (withheld: ${withheld.join(', ')})` : '';
    const ageMinutes = Math.max(0, Math.round(freshness.ageMs / 60_000));
    process.stdout.write(
      `✓ ${total} items ${JSON.stringify(counts)}; newest evidence ${ageMinutes}m old${suffix}\n`
    );
  } catch (err) {
    failures++;
    process.stdout.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} validation ${failures === 0 ? 'passed' : 'failed'}`);
process.exit(failures);
