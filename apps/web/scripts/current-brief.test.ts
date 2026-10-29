import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReaderEdition, istDay, type BriefSnapshot, type Region } from '@high-signal/shared';
import { canShareCurrentBrief, resolveCurrentBrief } from '../src/lib/current-brief';

const now = new Date('2026-10-01T18:30:00Z');

function edition(
  date: string,
  publishStatus: 'pending' | 'published' = 'published'
): BriefSnapshot {
  return {
    generatedAt: `${date}T04:00:00Z`,
    editionDate: date,
    timeZone: 'Asia/Kolkata',
    region: 'global',
    publishStatus,
    stocks: [
      {
        entityId: 'example',
        entityName: 'Example',
        ticker: null,
        country: null,
        signalType: 'expansion',
        signalFamily: 'company',
        direction: 'neutral',
        confidence: 'high',
        predictedWindowDays: 30,
        headline: 'Example expands production capacity',
        signalSlug: 'example',
        publishedAt: `${date}T04:00:00Z`,
        hitRate: null,
        hitRateSample: 0,
        hitRateBand: 'none',
        whatChanged: 'The company announced a capacity expansion.',
        whyItMatters: 'The expansion increases available production capacity.',
        uncertainty: 'The completion date remains subject to permitting.',
        evidenceUrls: [
          { url: 'https://primary.example/a' },
          { url: 'https://independent.example/a' },
        ],
        provenance: {
          claimId: 'claim',
          assertion: 'Example expands production capacity.',
          version: 1,
          evidenceCount: 2,
          primaryCount: 1,
          corroborationCount: 1,
          contradictionCount: 0,
          independentOriginCount: 2,
          evidenceUrls: ['https://primary.example/a', 'https://independent.example/a'],
        },
      },
    ],
    ideas: [],
    trends: [],
  };
}

function reader(editions: Record<string, BriefSnapshot | Error>, dates = Object.keys(editions)) {
  const calls: string[] = [];
  return {
    calls,
    brief: async ({ date = istDay(now) }: { date?: string }) => {
      calls.push(date);
      const result = editions[date];
      if (result instanceof Error) throw result;
      if (!result) throw new Error('offline');
      return result;
    },
    briefDates: async () => ({ dates: dates.map((date) => ({ date })) }),
  };
}

test('published current edition needs no fallback', async () => {
  const current = edition('2026-10-02');
  const source = reader({ '2026-10-02': current });
  assert.equal(await resolveCurrentBrief(source, 'global', 'today', now), current);
  assert.deepEqual(source.calls, ['2026-10-02']);
});

test('only a qualified current global edition can attest to shared fallback caching', () => {
  const current = edition('2026-10-02');
  assert.equal(canShareCurrentBrief(current, 'global', 'today', now), true);
  assert.equal(
    canShareCurrentBrief(
      {
        ...current,
        stocks: [],
        news: [
          {
            id: 'selected-technology',
            title: 'Acme launches Alpha Beta cloud model',
            summary:
              'Acme announced the Alpha Beta cloud model with an enterprise rollout this week.',
            event_at: '2026-10-02T04:00:00Z',
            what_changed: '',
            evidence_status: 'reported',
            source_references: [{ url: 'https://reporter.example/acme-alpha-beta-model' }],
          },
        ],
      },
      'global',
      'today',
      now
    ),
    true
  );
  const rejected: Array<[BriefSnapshot, Region, 'today' | 'yesterday']> = [
    [edition('2026-10-02', 'pending'), 'global', 'today'],
    [edition('2026-10-01'), 'global', 'today'],
    [current, 'global', 'yesterday'],
    [{ ...current, region: 'europe' }, 'europe', 'today'],
    [{ ...current, stocks: [] }, 'global', 'today'],
    [
      {
        ...current,
        stocks: [],
        news: [
          {
            id: 'outside-front-edition',
            title: 'Example launches a production facility',
            summary:
              'Example announced a production facility with increased manufacturing capacity.',
            event_at: '2026-10-02T04:00:00Z',
            what_changed: '',
            evidence_status: 'reported',
            source_references: [{ url: 'https://example.com/production-facility' }],
          },
        ],
      },
      'global',
      'today',
    ],
    [
      {
        ...current,
        readerEdition: {
          ...buildReaderEdition(current),
          news: [],
          signals: [],
          ideas: [],
          trends: [],
        },
      },
      'global',
      'today',
    ],
    [{ ...current, stocks: [{ ...current.stocks[0]!, evidenceUrls: [] }] }, 'global', 'today'],
  ];
  for (const [brief, region, day] of rejected) {
    assert.equal(canShareCurrentBrief(brief, region, day, now), false);
  }
});

test('today uses the current refresh while yesterday retains its explicit date', async () => {
  const requests: Array<{ region: string; date?: string }> = [];
  const source = {
    brief: async (params: { region: string; date?: string }) => {
      requests.push(params);
      return edition(params.date ?? istDay(now));
    },
    briefDates: async () => ({ dates: [] }),
  };
  await resolveCurrentBrief(source, 'global', 'today', now);
  await resolveCurrentBrief(source, 'global', 'yesterday', now);
  assert.deepEqual(requests, [{ region: 'global' }, { region: 'global', date: '2026-10-01' }]);
});

test('pending current resolves to a qualified historical edition without relabeling it', async () => {
  const historical = edition('2026-10-01');
  const source = reader({
    '2026-10-02': edition('2026-10-02', 'pending'),
    '2026-10-01': historical,
  });
  assert.equal(await resolveCurrentBrief(source, 'global', 'today', now), historical);
  assert.equal(historical.editionDate, '2026-10-01');
  assert.equal(historical.publishStatus, 'published');
});

test('sorts valid dates newest first, deduplicates and excludes future and invalid dates', async () => {
  const source = reader(
    {
      '2026-10-02': edition('2026-10-02', 'pending'),
      '2026-10-01': edition('2026-10-01', 'pending'),
      '2026-09-30': edition('2026-09-30'),
    },
    ['2026-09-30', '2026-10-03', '2026-02-30', 'invalid', '2026-10-01', '2026-10-01']
  );
  assert.equal(
    (await resolveCurrentBrief(source, 'global', 'today', now)).editionDate,
    '2026-09-30'
  );
  assert.deepEqual(source.calls, ['2026-10-02', '2026-10-01', '2026-09-30']);
});

test('under-evidenced published editions are rejected and pending content is never rendered', async () => {
  const thin = edition('2026-10-01');
  thin.stocks[0]!.evidenceUrls = [{ url: 'https://primary.example/a' }];
  const source = reader({ '2026-10-02': edition('2026-10-02', 'pending'), '2026-10-01': thin });
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.equal(result.publishStatus, 'pending');
  assert.deepEqual(result.stocks, []);
  assert.equal(result.categoryStates?.stocks.status, 'empty');
});

test('no edition index gives explicit empty state', async () => {
  const source = reader({ '2026-10-02': edition('2026-10-02', 'pending') }, []);
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.deepEqual(result.news, []);
  assert.deepEqual(result.stocks, []);
  assert.equal(result.categoryStates?.stocks.reason, 'no_qualified_edition');
});

test('a published status alone cannot qualify an empty or unsupported edition', async () => {
  for (const stocks of [[], [{ ...edition('2026-10-02').stocks[0]!, provenance: undefined }]]) {
    const source = reader({ '2026-10-02': { ...edition('2026-10-02'), stocks } }, []);
    assert.deepEqual((await resolveCurrentBrief(source, 'global', 'today', now)).stocks, []);
  }
});

test('news-only published editions use existing news quality rules, never signal evidence rules', async () => {
  const newsOnly: BriefSnapshot = {
    ...edition('2026-10-01'),
    stocks: [],
    news: [
      {
        id: 'news',
        title: 'Example launches a production facility',
        summary:
          'Example announced a new production facility with increased manufacturing capacity.',
        event_at: '2026-10-01T04:00:00Z',
        what_changed: 'The production facility expands the company manufacturing footprint.',
        evidence_status: 'reported',
        source_references: [{ url: 'https://example.com/production-facility' }],
      },
    ],
  };
  const source = reader({ '2026-10-02': edition('2026-10-02', 'pending'), '2026-10-01': newsOnly });
  assert.equal(await resolveCurrentBrief(source, 'global', 'today', now), newsOnly);
  newsOnly.news![0]!.source_references = [];
  assert.deepEqual((await resolveCurrentBrief(source, 'global', 'today', now)).news, []);
});

test('a current challenge never requests the date index or another edition', async () => {
  const source = reader({ '2026-10-02': Object.assign(new Error('challenge'), { status: 403 }) });
  source.briefDates = async () => {
    assert.fail('must not read index after challenge');
  };
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.equal(result.categoryStates?.stocks.status, 'unavailable');
  assert.deepEqual(source.calls, ['2026-10-02']);
});

test('one unusable news item cannot silence the supported reporting in an edition', async () => {
  const valid = {
    id: 'valid-news',
    title: 'Example launches a production facility',
    summary: 'Example announced a production facility with increased manufacturing capacity.',
    event_at: '2026-10-02T04:00:00Z',
    what_changed: '',
    evidence_status: 'reported' as const,
    source_references: [{ url: 'https://example.com/production-facility' }],
  };
  const current: BriefSnapshot = {
    ...edition('2026-10-02'),
    stocks: [],
    news: [
      valid,
      { ...valid, id: 'no-citation', source_references: [] },
      { ...valid, id: 'wrong-subject', title: 'DifferentCo launches a production facility' },
      { ...valid, id: 'no-date', event_at: 'invalid' },
    ],
  };
  const source = reader({ '2026-10-02': current });
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.equal(result.publishStatus, 'published');
  assert.deepEqual(result.news, [valid]);
  assert.deepEqual(source.calls, ['2026-10-02']);
  assert.equal(current.news?.length, 4, 'the source edition is not mutated');
});

test('network failures yield unavailable unless a qualified fallback can be read', async () => {
  const source = reader({
    '2026-10-02': new Error('offline'),
    '2026-10-01': edition('2026-10-01'),
  });
  assert.equal(
    (await resolveCurrentBrief(source, 'global', 'today', now)).editionDate,
    '2026-10-01'
  );
  source.briefDates = async () => {
    throw new Error('index offline');
  };
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.deepEqual(result.stocks, []);
  assert.equal(result.categoryStates?.stocks.status, 'unavailable');
});

test('history challenge is respected and stops further fallback attempts', async () => {
  const source = reader({
    '2026-10-02': edition('2026-10-02', 'pending'),
    '2026-10-01': Object.assign(new Error('challenge'), { status: 403 }),
    '2026-09-30': edition('2026-09-30'),
  });
  const result = await resolveCurrentBrief(source, 'global', 'today', now);
  assert.deepEqual(source.calls, ['2026-10-02', '2026-10-01']);
  assert.equal(result.categoryStates?.stocks.status, 'unavailable');
});

test('uses IST midnight and yesterday across month boundary', async () => {
  assert.equal(istDay(new Date('2026-10-01T18:29:59Z')), '2026-10-01');
  const source = reader({ '2026-09-30': edition('2026-09-30') });
  await resolveCurrentBrief(source, 'global', 'yesterday', new Date('2026-10-01T18:29:59Z'));
  assert.deepEqual(source.calls, ['2026-09-30']);
});

test('rejects response date, region, timezone and stock-day mismatches', async () => {
  for (const change of [
    { editionDate: '2026-10-01' },
    { region: 'europe' as const },
    { timeZone: undefined },
    { stocks: [{ ...edition('2026-10-02').stocks[0]!, publishedAt: '2026-10-01T18:29:59Z' }] },
  ]) {
    const source = reader({ '2026-10-02': { ...edition('2026-10-02'), ...change } }, []);
    assert.deepEqual((await resolveCurrentBrief(source, 'global', 'today', now)).stocks, []);
  }
});
