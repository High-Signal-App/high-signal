#!/usr/bin/env tsx
/**
 * Unit tests for plan 0012 intent opportunity scoring.
 *
 * Run: `pnpm intent-opportunities:test`
 */

import {
  actionTypeFor,
  intentStageFor,
  keywordsForIntentBrand,
  scoreIntentOpportunity,
} from '@high-signal/shared';

let failures = 0;
let total = 0;

function checkEq<T>(label: string, actual: T, expected: T) {
  total++;
  if (actual === expected) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function check(label: string, condition: boolean) {
  total++;
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
const brand = {
  brandName: 'High Signal',
  brandAliases: ['highsignal', '', 'HS'],
  competitors: [{ name: 'Octolens' }, { name: 'Peekaboo' }, { name: '' }],
  nowMs: NOW,
};

console.log('keywordsForIntentBrand');
{
  const keywords = keywordsForIntentBrand(brand);
  check('includes brand name', keywords.includes('High Signal'));
  check('includes alias', keywords.includes('highsignal'));
  check('includes competitor', keywords.includes('Octolens'));
  check('drops blank competitor', !keywords.includes(''));
}

console.log('\nstage/action mapping');
checkEq(
  'purchase intent maps to purchase',
  intentStageFor('purchase-intent', 'research-only', false),
  'purchase'
);
checkEq('purchase stage maps to reply', actionTypeFor('purchase', 'research-only'), 'reply');
checkEq(
  'competitor mention wins comparison',
  intentStageFor('general', 'research-only', true),
  'comparison'
);
checkEq(
  'comparison maps to write_comparison',
  actionTypeFor('comparison', 'research-only'),
  'write_comparison'
);

console.log('\nscoreIntentOpportunity');
{
  const candidate = scoreIntentOpportunity(
    {
      source: 'reddit',
      sourceUrl: 'https://reddit.com/r/startups/comments/1',
      title: 'Looking for High Signal alternatives before we buy',
      content:
        'We are comparing High Signal with Octolens for Reddit monitoring and AI visibility. Any recommendations before we pay?',
      publishedAt: new Date(NOW - 2 * 24 * 3600 * 1000),
    },
    brand
  );

  check('returns a candidate for matched purchase/comparison intent', Boolean(candidate));
  checkEq('comparison stage when competitor is present', candidate?.intentStage, 'comparison');
  checkEq('comparison action', candidate?.actionType, 'write_comparison');
  check('scores high enough to prioritize', (candidate?.score ?? 0) >= 60);
  check(
    'captures matched brand keyword',
    candidate?.matchedKeywords.includes('High Signal') ?? false
  );
  check('captures matched competitor', candidate?.competitors.includes('Octolens') ?? false);
}

{
  const candidate = scoreIntentOpportunity(
    {
      source: 'hackernews',
      sourceUrl: 'https://news.ycombinator.com/item?id=1',
      title: 'Show HN: a Postgres backup tool',
      content: 'This does not mention the tracked brand or its competitors.',
      publishedAt: new Date(NOW),
    },
    brand
  );
  checkEq('ignores unrelated threads', candidate, null);
}

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}

console.log(`\nall ${total} ok`);
