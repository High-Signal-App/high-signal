import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BriefSnapshot } from '@high-signal/shared';
import { briefFooterMode } from '../src/lib/brief-footer';
import { renderStudioFooterHtml } from '@saas-maker/ui/footer-html';

const empty: BriefSnapshot = {
  generatedAt: '2026-10-14T04:00:00Z',
  editionDate: '2026-10-14',
  timeZone: 'Asia/Kolkata',
  region: 'global',
  publishStatus: 'pending',
  stocks: [],
  ideas: [],
  trends: [],
};

test('empty, error and recovered editions select the appropriate footer without sticky state', () => {
  const ready = { ...empty, publishStatus: 'published', stocks: [{}] } as BriefSnapshot;
  const unavailable = {
    ...ready,
    categoryStates: {
      stocks: { status: 'unavailable', source: 'live', reason: 'fixture' },
      ideas: { status: 'empty', source: 'live' },
      trends: { status: 'empty', source: 'live' },
    },
  } as BriefSnapshot;
  assert.deepEqual([empty, unavailable, ready, empty, ready].map(briefFooterMode), [
    'compact',
    'compact',
    'full',
    'compact',
    'full',
  ]);
  assert.equal(briefFooterMode({ ...empty, publishStatus: 'published' }), 'compact');
  assert.equal(briefFooterMode({ ...ready, publishStatus: 'pending' }), 'compact');
});

test('shared compact mode omits competing controls and full mode restores them', () => {
  const props = {
    product: 'High Signal',
    url: 'https://highsignal.app',
    capture: 'newsletter' as const,
  };
  const compact = renderStudioFooterHtml({ ...props, mode: 'compact' });
  const full = renderStudioFooterHtml({ ...props, mode: 'full' });
  assert.match(compact, /data-footer-mode="compact"/);
  assert.match(compact, /High Signal/);
  assert.doesNotMatch(compact, /data-subscribe|Ask AI|Send feedback/);
  assert.match(full, /data-subscribe/);
  assert.match(full, /Ask AI/);
  assert.match(full, /Send feedback/);
});
