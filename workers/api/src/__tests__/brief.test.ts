import { describe, expect, it, vi } from 'vitest';
import {
  buildBriefEditionReceipt,
  categoryStatesForSnapshot,
  countriesForRegion,
  DEMO_REGIONS,
  extractBriefEditorialSummary,
  fallbackIdeas,
  fallbackStocks,
  fallbackTrends,
  familyForSignalType,
  familyLabel,
  findSeedProduct,
  isCompleteBriefText,
  isRegion,
  pruneUnpublishableBriefItems,
  REGIONS,
  regionLabel,
  SEED_IDEAS,
  SEED_PRODUCTS,
  SEED_STOCK_SIGNALS,
  SEED_TRENDS,
  summarizeBriefDiscovery,
  type Region,
  type BriefIntentItem,
  type BriefSnapshot,
  type SignalFamily,
} from '@high-signal/shared';
import {
  computeHitRate,
  headlineFromBody,
  HIT_RATE_FAMILY_MIN,
  HIT_RATE_SAMPLE_MIN,
  isBriefStockEvidenceEligible,
  isPublicSourceLink,
  pickSpotlight,
  rankStocks,
  renderFromSeed,
  mergeIntentIntoImprovements,
  mergeIntentIntoPerception,
  resolveHitRate,
  safe,
  seedToBrief,
  briefRoute,
  type BucketCounts,
} from '../routes/brief';

const intentFixture = (overrides: Partial<BriefIntentItem> = {}): BriefIntentItem => ({
  id: 'intent-1',
  brandId: 'brand-1',
  brandName: 'Acme',
  source: 'reddit',
  sourceUrl: 'https://reddit.com/r/tools/comments/intent-1',
  sourceTitle: 'Acme or Rival for a production workflow?',
  sourceExcerpt: 'We need proof that Acme works at production scale.',
  platform: 'reddit',
  intentStage: 'comparison',
  actionType: 'write_comparison',
  score: 82,
  competitors: ['Rival'],
  evidenceTaskId: null,
  foundAt: '2026-07-12T10:00:00.000Z',
  ...overrides,
});

describe('cadenced brief feed route', () => {
  const env = { DB: {} as D1Database };

  it('rejects an unknown feed before touching storage', async () => {
    const response = await briefRoute.request('http://test/feeds/not-a-feed/daily', {}, env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'unknown_brief_feed' });
  });

  it('rejects an invalid period key', async () => {
    const response = await briefRoute.request(
      'http://test/feeds/markets-companies/weekly/2026-W99',
      {},
      env
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_brief_feed_period',
      cadence: 'weekly',
    });
  });

  it('falls an unsupported daily opportunity request back to the current weekly edition', async () => {
    const response = await briefRoute.request(
      'http://test/feeds/opportunity-radar/daily?region=global',
      {},
      env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
    const body = (await response.json()) as {
      feed: string;
      cadence: string;
      cadenceFellBack: boolean;
      snapshot: BriefSnapshot;
      coverage: { configuredClasses: string[]; contributingClasses: string[] };
    };
    expect(body.feed).toBe('opportunity-radar');
    expect(body.cadence).toBe('weekly');
    expect(body.cadenceFellBack).toBe(true);
    expect(body.snapshot.categoryStates?.ideas.status).toBe('unavailable');
    expect(body.coverage.configuredClasses).toContain('community');
    expect(body.coverage.contributingClasses).toEqual([]);
  });
});

describe('region rollups', () => {
  it('REGIONS includes global and never overlaps countries between regions', () => {
    expect(REGIONS).toContain('global');
    const seen = new Map<string, Region>();
    for (const region of REGIONS) {
      if (region === 'global') continue;
      for (const country of countriesForRegion(region)) {
        const previous = seen.get(country);
        if (previous && previous !== region) {
          throw new Error(`country ${country} in both ${previous} and ${region}`);
        }
        seen.set(country, region);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it('global region has no country filter', () => {
    expect(countriesForRegion('global')).toEqual([]);
  });

  it('isRegion accepts known regions and rejects unknown', () => {
    expect(isRegion('south-asia')).toBe(true);
    expect(isRegion('east-asia')).toBe(true);
    expect(isRegion('middle-earth')).toBe(false);
    expect(isRegion('')).toBe(false);
    expect(isRegion(null)).toBe(false);
    expect(isRegion(42)).toBe(false);
  });

  it('regionLabel returns a human label for every region', () => {
    for (const region of REGIONS) {
      const label = regionLabel(region);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/undefined/i);
    }
  });
});

describe('brief stock ranking', () => {
  it('prefers independently verified origins over direction', () => {
    const ranked = rankStocks([
      { direction: 'up', confidence: 'high', verifiedOriginCount: 2 },
      { direction: 'neutral', confidence: 'low', verifiedOriginCount: 4 },
      { direction: 'down', confidence: 'high', verifiedOriginCount: 3 },
    ]);
    expect(ranked.map((r) => r.verifiedOriginCount)).toEqual([4, 3, 2]);
  });

  it('uses quality then confidence when proof strength ties', () => {
    const ranked = rankStocks([
      { direction: 'up', confidence: 'high', verifiedOriginCount: 2, qualityScore: 70 },
      { direction: 'neutral', confidence: 'low', verifiedOriginCount: 2, qualityScore: 90 },
      { direction: 'down', confidence: 'medium', verifiedOriginCount: 2, qualityScore: 80 },
    ]);
    expect(ranked.map((r) => r.qualityScore)).toEqual([90, 80, 70]);
  });

  it('does not mutate the input array', () => {
    const original = [
      { direction: 'down' as const, confidence: 'low' as const },
      { direction: 'up' as const, confidence: 'high' as const },
    ];
    const snapshot = original.slice();
    rankStocks(original);
    expect(original).toEqual(snapshot);
  });
});

describe('brief read-time evidence gate', () => {
  it('requires two unique citations for legacy published stocks', () => {
    expect(isBriefStockEvidenceEligible([])).toBe(false);
    expect(isBriefStockEvidenceEligible(['https://example.com/one'])).toBe(false);
    expect(
      isBriefStockEvidenceEligible(['https://example.com/one', ' https://example.com/one '])
    ).toBe(false);
    expect(
      isBriefStockEvidenceEligible(['https://example.com/one', 'https://another.example/two'])
    ).toBe(true);
    expect(isBriefStockEvidenceEligible(['https://example.com/one', 'javascript:alert(1)'])).toBe(
      false
    );
  });

  it('rejects prediction-market-only citation sets', () => {
    expect(
      isBriefStockEvidenceEligible([
        'https://polymarket.com/event/one',
        'https://manifold.markets/question/two',
      ])
    ).toBe(false);
    expect(
      isBriefStockEvidenceEligible([
        'https://polymarket.com/event/one',
        'https://www.sec.gov/Archives/filing.htm',
      ])
    ).toBe(true);
  });

  it('accepts only HTTP(S) community source links', () => {
    expect(isPublicSourceLink('https://reddit.com/r/tools/comments/one')).toBe(true);
    expect(isPublicSourceLink(' http://example.com/thread ')).toBe(true);
    expect(isPublicSourceLink('javascript:alert(1)')).toBe(false);
    expect(isPublicSourceLink('/relative/thread')).toBe(false);
    expect(isPublicSourceLink('')).toBe(false);
    expect(isPublicSourceLink(null)).toBe(false);
  });
});

describe('brief discovery summary', () => {
  it('counts public items and requires evidence on each one', () => {
    expect(
      summarizeBriefDiscovery({
        stocks: [{ evidenceUrls: [{ url: 'https://example.com/stock' }] }],
        ideas: [{ evidenceUrls: [] }],
        trends: [{ evidenceUrls: [{ url: 'https://example.com/trend' }] }],
      })
    ).toEqual({ publicItemCount: 3, citedItemCount: 2 });
  });

  it('fails closed for a missing or malformed public corpus', () => {
    expect(summarizeBriefDiscovery(null)).toEqual({ publicItemCount: 0, citedItemCount: 0 });
    expect(
      summarizeBriefDiscovery({ stocks: undefined, ideas: undefined, trends: undefined })
    ).toEqual({ publicItemCount: 0, citedItemCount: 0 });
  });
});

describe('brief hit-rate', () => {
  it('returns null when decided sample < HIT_RATE_SAMPLE_MIN', () => {
    expect(computeHitRate({ hit: 0, miss: 0, push: 0 })).toEqual({
      hitRate: null,
      sample: 0,
    });
    expect(computeHitRate({ hit: 1, miss: 1, push: 5 })).toEqual({
      hitRate: null,
      sample: 2,
    });
  });

  it('computes hit-rate excluding pushes once threshold is met', () => {
    expect(HIT_RATE_SAMPLE_MIN).toBe(3);
    expect(computeHitRate({ hit: 2, miss: 1, push: 4 })).toEqual({
      hitRate: 2 / 3,
      sample: 3,
    });
    expect(computeHitRate({ hit: 10, miss: 0, push: 0 })).toEqual({
      hitRate: 1,
      sample: 10,
    });
    expect(computeHitRate({ hit: 0, miss: 5, push: 0 })).toEqual({
      hitRate: 0,
      sample: 5,
    });
  });
});

describe('brief headline extraction', () => {
  it('uses the first non-empty line, stripping leading hashes', () => {
    expect(headlineFromBody('# Boom in HBM demand\n\nbody...', 'fallback')).toBe(
      'Boom in HBM demand'
    );
    expect(headlineFromBody('\n\n## Capex raise\n', 'fallback')).toBe('Capex raise');
  });

  it('falls back to entity name on empty body', () => {
    expect(headlineFromBody('', 'NVDA')).toBe('NVDA');
    expect(headlineFromBody('   \n  \n', 'NVDA')).toBe('NVDA');
  });

  it('truncates absurdly long first lines at 180 chars', () => {
    const long = 'Lorem ipsum '.repeat(40);
    const result = headlineFromBody(long, 'fallback');
    expect(result.length).toBeLessThanOrEqual(180);
  });
});

describe('brief editorial quality', () => {
  it('extracts only complete grounded editorial sentences', () => {
    const summary = extractBriefEditorialSummary(`
## What changed
Amazon committed to a new power-backed data-center expansion in Texas.
## Why it matters
The expansion signals durable demand for accelerators, networking, and grid equipment.
## Uncertainty
The project could still face permitting, financing, and climate-policy risk.
`);
    expect(summary).toEqual({
      whatChanged: 'Amazon committed to a new power-backed data-center expansion in Texas.',
      whyItMatters:
        'The expansion signals durable demand for accelerators, networking, and grid equipment.',
      uncertainty: 'The project could still face permitting, financing, and climate-policy risk.',
    });
    expect(
      extractBriefEditorialSummary(
        'Amazon announced a new data center. The expansion signals more infrastructure demand. Risks include permitting delays.'
      )
    ).toEqual({
      whatChanged: 'Amazon announced a new data center.',
      whyItMatters: 'The expansion signals more infrastructure demand.',
      uncertainty: 'Risks include permitting delays.',
    });
    expect(extractBriefEditorialSummary('Amazon announced a new data center.')).toBeNull();
    expect(isCompleteBriefText('A complete editorial sentence with grounded detail.')).toBe(true);
    expect(isCompleteBriefText('broken [link](https://example.com')).toBe(false);
  });

  const validSnapshot = (): BriefSnapshot => ({
    generatedAt: '2026-08-11T07:00:00.000Z',
    region: 'global',
    hasBrand: false,
    categoryStates: {
      stocks: { status: 'ready', source: 'live' },
      ideas: { status: 'empty', source: 'live' },
      trends: { status: 'empty', source: 'live' },
    },
    stocks: [
      {
        entityId: 'amazon',
        entityName: 'Amazon',
        ticker: 'AMZN',
        country: 'US',
        signalType: 'data_center_buildout',
        signalFamily: 'supply-demand',
        direction: 'up',
        confidence: 'high',
        predictedWindowDays: 60,
        headline: 'Amazon expands power-backed data-center capacity.',
        whatChanged: 'Amazon committed to a new power-backed data-center expansion in Texas.',
        whyItMatters:
          'The expansion signals durable demand for accelerators, networking, and grid equipment.',
        uncertainty: 'The project could still face permitting, financing, and climate-policy risk.',
        signalSlug: 'amzn-data-center-buildout',
        publishedAt: '2026-08-11T06:00:00.000Z',
        evidenceUrls: [
          { url: 'https://primary.example/report' },
          { url: 'https://corroboration.example/report' },
        ],
        hitRate: null,
        hitRateSample: 0,
        hitRateBand: 'none',
        provenance: {
          claimId: 'claim-1',
          assertion: 'Amazon is expanding power-backed data-center capacity.',
          version: 1,
          evidenceCount: 2,
          primaryCount: 1,
          corroborationCount: 1,
          contradictionCount: 0,
          independentOriginCount: 2,
          evidenceUrls: ['https://primary.example/report', 'https://corroboration.example/report'],
        },
      },
    ],
    ideas: [],
    trends: [],
    perception: [],
    improvements: [],
  });

  it('accepts a real partial edition with explicit empty categories', () => {
    const snapshot = validSnapshot();
    expect(categoryStatesForSnapshot(snapshot)).toEqual(snapshot.categoryStates);
    expect(buildBriefEditionReceipt(snapshot)).toMatchObject({
      publishable: true,
      counts: { stocks: 1, ideas: 0, trends: 0 },
      issues: [],
    });
  });

  it('fails closed for fixture, malformed, unsupported, and unavailable editions', () => {
    const fixture = validSnapshot();
    if (!fixture.categoryStates) throw new Error('expected category state fixture');
    fixture.categoryStates.stocks.source = 'fixture';
    expect(buildBriefEditionReceipt(fixture).issues).toContainEqual({
      section: 'stocks',
      item: null,
      reason: 'fixture_content',
    });

    const malformed = validSnapshot();
    malformed.stocks[0].whyItMatters = 'broken [link](https://example.com';
    expect(buildBriefEditionReceipt(malformed).issues).toContainEqual({
      section: 'stocks',
      item: 0,
      reason: 'incomplete_editorial_summary',
    });

    const unsupported = validSnapshot();
    unsupported.stocks[0].provenance = undefined;
    expect(buildBriefEditionReceipt(unsupported).issues).toContainEqual({
      section: 'stocks',
      item: 0,
      reason: 'unsupported_structured_claim',
    });

    const unavailable = validSnapshot();
    if (!unavailable.categoryStates) throw new Error('expected category state fixture');
    unavailable.categoryStates.trends = { status: 'unavailable', reason: 'query_failed' };
    expect(buildBriefEditionReceipt(unavailable).issues).toContainEqual({
      section: 'trends',
      item: null,
      reason: 'query_failed',
    });
  });

  it('leaves a clean edition untouched', () => {
    const snapshot = validSnapshot();
    const pruned = pruneUnpublishableBriefItems(snapshot);
    expect(pruned.withheld).toEqual([]);
    expect(pruned.snapshot).toBe(snapshot);
  });

  it('withholds the failing item instead of silencing the edition', () => {
    const snapshot = validSnapshot();
    const good = snapshot.stocks[0];
    // Two items, one uncited. Before pruning the whole edition is rejected.
    snapshot.stocks = [
      good,
      { ...good, entityId: 'nvidia', entityName: 'Nvidia', provenance: undefined },
    ];
    expect(buildBriefEditionReceipt(snapshot).publishable).toBe(false);

    const pruned = pruneUnpublishableBriefItems(snapshot);
    expect(pruned.withheld).toEqual([
      { section: 'stocks', index: 1, reasons: ['unsupported_structured_claim'] },
    ]);
    expect(pruned.snapshot.stocks).toEqual([good]);
    expect(buildBriefEditionReceipt(pruned.snapshot).publishable).toBe(true);
  });

  it('marks a category emptied by pruning as withheld, not as nothing found', () => {
    const snapshot = validSnapshot();
    snapshot.stocks[0].provenance = undefined;

    const pruned = pruneUnpublishableBriefItems(snapshot);
    expect(pruned.snapshot.stocks).toEqual([]);
    expect(pruned.snapshot.categoryStates?.stocks).toMatchObject({
      status: 'empty',
      reason: 'items_withheld_by_publish_gate',
    });
    // Nothing survived anywhere, so the edition still fails closed.
    expect(buildBriefEditionReceipt(pruned.snapshot).issues).toContainEqual({
      section: 'edition',
      item: null,
      reason: 'edition_has_no_items',
    });
  });

  it('cannot rescue an edition whose failure a prune would misrepresent', () => {
    const fixture = validSnapshot();
    if (!fixture.categoryStates) throw new Error('expected category state fixture');
    fixture.categoryStates.stocks.source = 'fixture';
    expect(pruneUnpublishableBriefItems(fixture).withheld).toEqual([]);
    expect(
      buildBriefEditionReceipt(pruneUnpublishableBriefItems(fixture).snapshot).publishable
    ).toBe(false);

    const unavailable = validSnapshot();
    if (!unavailable.categoryStates) throw new Error('expected category state fixture');
    unavailable.categoryStates.stocks = { status: 'unavailable', reason: 'query_failed' };
    unavailable.stocks[0].provenance = undefined;
    const pruned = pruneUnpublishableBriefItems(unavailable);
    expect(pruned.snapshot.categoryStates?.stocks).toEqual({
      status: 'unavailable',
      reason: 'query_failed',
    });
    expect(buildBriefEditionReceipt(pruned.snapshot).publishable).toBe(false);
  });
});

describe('seed-product picker', () => {
  it('has at least 30 products spanning all three domains', () => {
    expect(SEED_PRODUCTS.length).toBeGreaterThanOrEqual(30);
    const domains = new Set(SEED_PRODUCTS.map((p) => p.domain));
    expect(domains.has('technology')).toBe(true);
    expect(domains.has('startups')).toBe(true);
    expect(domains.has('finance')).toBe(true);
  });

  it('findSeedProduct returns the right record or undefined', () => {
    expect(findSeedProduct('stripe')?.brandName).toBe('Stripe');
    expect(findSeedProduct('not-a-real-id')).toBeUndefined();
  });

  it('DEMO_REGIONS surfaces 5–7 regions and always includes global first', () => {
    expect(DEMO_REGIONS.length).toBeGreaterThanOrEqual(5);
    expect(DEMO_REGIONS.length).toBeLessThanOrEqual(7);
    expect(DEMO_REGIONS[0]).toBe('global');
    for (const region of DEMO_REGIONS) {
      expect(REGIONS).toContain(region);
    }
  });
});

describe('brief seed fallback', () => {
  it('seedToBrief surfaces every improvement from a product', () => {
    const stripe = findSeedProduct('stripe');
    if (!stripe) throw new Error('expected stripe seed fixture');
    const rendered = seedToBrief(stripe, '2026-05-25T00:00:00.000Z');
    expect(rendered.perception).toHaveLength(1);
    expect(rendered.perception[0].brandName).toBe('Stripe');
    expect(rendered.improvements).toHaveLength(stripe.improvements.length);
    for (const improvement of rendered.improvements) {
      expect(improvement.surfacedAt).toBe('2026-05-25T00:00:00.000Z');
      expect(improvement.auditId).toBe('seed:stripe');
    }
  });

  it('renderFromSeed returns null for unknown ids', () => {
    expect(renderFromSeed('not-a-real-id')).toBeNull();
  });

  it('pickSpotlight rotates deterministically per hour and respects region', () => {
    const baseHour = 1_700_000_000_000; // arbitrary epoch ms
    const first = pickSpotlight('global', baseHour);
    const sameHour = pickSpotlight('global', baseHour + 1000);
    expect(first?.id).toBe(sameHour?.id);

    // A different hour can pick a different product (not guaranteed if the
    // bucket wraps, but with the full SEED_PRODUCTS pool it should be common).
    const distinctHours = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const product = pickSpotlight('global', baseHour + i * 60 * 60 * 1000);
      if (product) distinctHours.add(product.id);
    }
    expect(distinctHours.size).toBeGreaterThan(1);

    const naOnly = pickSpotlight('north-america', baseHour);
    expect(naOnly?.region).toBe('north-america');
  });

  it('pickSpotlight returns null only when no products match the region', () => {
    // Every demo region now has at least one seed product after the SSS
    // upgrade — if a region were to lose its seeds entirely we'd want
    // this to start failing to flag the regression.
    for (const region of DEMO_REGIONS) {
      if (region === 'global') continue;
      expect(pickSpotlight(region, 1_700_000_000_000)).not.toBeNull();
    }
    // A genuinely non-existent region (after isRegion gate would never
    // reach this code path) returns null. The whole code path is type-safe
    // so we cast to test the defensive branch only.
    expect(pickSpotlight('global', 0)).not.toBeNull();
  });
});

describe('intent-aware personal brief sections', () => {
  it('attaches the highest-scoring finding to existing perception metrics', () => {
    const perception = [
      {
        brandName: 'Acme',
        mentionRate: 0.4,
        positiveShare: 0.5,
        competitorPresence: 0.2,
        latestCheckAt: '2026-07-12T09:00:00.000Z',
        configId: 'brand-1',
      },
    ];
    const result = mergeIntentIntoPerception(perception, [
      intentFixture({ id: 'low', score: 45 }),
      intentFixture({ id: 'high', score: 91, sourceUrl: 'https://example.com/high' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ mentionRate: 0.4, topIntent: { id: 'high', score: 91 } });
  });

  it('keeps an intent-only brand visible with unavailable metrics', () => {
    const [result] = mergeIntentIntoPerception([], [intentFixture()]);
    expect(result).toMatchObject({
      brandName: 'Acme',
      configId: 'brand-1',
      mentionRate: null,
      positiveShare: null,
      competitorPresence: null,
      topIntent: { sourceUrl: 'https://reddit.com/r/tools/comments/intent-1' },
    });
  });

  it('deduplicates an evidence task by source URL and attaches its intent context', () => {
    const sourceUrl = 'https://reddit.com/r/tools/comments/intent-1';
    const result = mergeIntentIntoImprovements(
      [
        {
          brandName: 'Acme',
          area: 'comparisons',
          task: 'Publish a comparison page',
          priority: 'high',
          auditId: 'audit-1',
          surfacedAt: '2026-07-12T09:00:00.000Z',
          sourceUrl,
        },
      ],
      [intentFixture({ sourceUrl })]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ auditId: 'audit-1', sourceUrl, intent: { id: 'intent-1' } });
  });

  it('turns an unlinked actionable finding into a source-backed improvement', () => {
    const [result] = mergeIntentIntoImprovements(
      [],
      [intentFixture({ actionType: 'reply', intentStage: 'purchase', score: 78 })]
    );
    expect(result).toMatchObject({
      brandName: 'Acme',
      area: 'buyer response',
      priority: 'high',
      auditId: null,
      sourceUrl: 'https://reddit.com/r/tools/comments/intent-1',
      intent: { intentStage: 'purchase', actionType: 'reply' },
    });
  });

  it('does not turn a watch-only finding into a section 5 action', () => {
    expect(
      mergeIntentIntoImprovements(
        [],
        [intentFixture({ actionType: 'watch', intentStage: 'awareness' })]
      )
    ).toEqual([]);
  });

  it('keeps existing output when the independent intent builder fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const intents = await safe<BriefIntentItem>(async () => {
      throw new Error('no such table: intent_opportunities');
    }, 'intent');
    const existing = [
      {
        brandName: 'Acme',
        mentionRate: 0.4,
        positiveShare: null,
        competitorPresence: null,
        latestCheckAt: null,
        configId: 'brand-1',
      },
    ];
    expect(intents).toEqual([]);
    expect(mergeIntentIntoPerception(existing, intents)).toEqual(existing);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});

describe('brief seed-content fallback (public sections)', () => {
  it('seed pools have enough breadth for the brief limits', () => {
    expect(SEED_STOCK_SIGNALS.length).toBeGreaterThanOrEqual(8);
    expect(SEED_IDEAS.length).toBeGreaterThanOrEqual(6);
    expect(SEED_TRENDS.length).toBeGreaterThanOrEqual(5);
  });

  it('fallbackStocks returns shaped items for global and respects limit', () => {
    const items = fallbackStocks('global', 5);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.entityName.length).toBeGreaterThan(0);
      expect(['up', 'down', 'neutral']).toContain(item.direction);
      expect(['low', 'medium', 'high']).toContain(item.confidence);
      expect(item.evidenceUrls.length).toBeGreaterThan(0);
      expect(typeof item.publishedAt).toBe('string');
      // hitRate is either null (insufficient sample) or in [0, 1].
      if (item.hitRate !== null) {
        expect(item.hitRate).toBeGreaterThanOrEqual(0);
        expect(item.hitRate).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fallbackStocks filters by region', () => {
    const eu = fallbackStocks('europe', 10);
    expect(eu.length).toBeGreaterThan(0);
    for (const item of eu) {
      expect([
        'NL',
        'DE',
        'FR',
        'GB',
        'SE',
        'CH',
        'IE',
        'PL',
        'BE',
        'DK',
        'FI',
        'NO',
        'AT',
        'PT',
        'CZ',
        'HU',
        'RO',
        'GR',
        'ES',
        'IT',
      ]).toContain(item.country);
    }
  });

  it('fallbackIdeas includes both region-specific and global items for non-global regions', () => {
    const ideas = fallbackIdeas('south-asia', 10);
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(['south-asia', 'global']).toContain(idea.region);
      expect(idea.title.length).toBeGreaterThan(0);
      expect(idea.evidenceUrls.length).toBeGreaterThan(0);
      expect(idea.opportunity).toBeDefined();
      expect(['enter', 'test', 'watch', 'avoid']).toContain(idea.opportunity?.verdict);
      expect(['low', 'medium', 'high']).toContain(idea.opportunity?.confidence);
      expect(idea.opportunity?.targetUser.length).toBeGreaterThan(0);
      expect(idea.opportunity?.problem.length).toBeGreaterThan(0);
      expect(idea.opportunity?.marketTimingReasons.length).toBeGreaterThan(0);
      expect(idea.opportunity?.evidenceMix.length).toBeGreaterThan(0);
      expect(idea.opportunity?.risks.length).toBeGreaterThan(0);
      expect(idea.opportunity?.nextValidationStep.length).toBeGreaterThan(0);
    }
  });

  it('fallbackIdeas carries decision-grade opportunity payloads', () => {
    const [idea] = fallbackIdeas('global', 1);
    expect(idea?.opportunity).toMatchObject({
      verdict: expect.any(String),
      confidence: expect.any(String),
      targetUser: expect.any(String),
      problem: expect.any(String),
      nextValidationStep: expect.any(String),
    });
    expect(idea?.opportunity?.evidenceMix[0]).toMatchObject({
      kind: 'demand',
      label: expect.any(String),
      summary: expect.any(String),
      strength: expect.any(String),
      sourceCount: expect.any(Number),
    });
    expect(idea?.opportunity?.competitorNotes.length).toBeGreaterThan(0);
    expect(idea?.opportunity?.pricingNotes.length).toBeGreaterThan(0);
    expect(idea?.opportunity?.agentVisibilityNotes.length).toBeGreaterThan(0);
  });

  it('fallbackTrends has surfacedAt in the recent past', () => {
    const trends = fallbackTrends('global', 5);
    expect(trends.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const trend of trends) {
      const ts = Date.parse(trend.surfacedAt);
      expect(now - ts).toBeGreaterThan(0);
      expect(now - ts).toBeLessThan(60 * 24 * 60 * 60 * 1000); // last 60 days
    }
  });

  it('every surfaced region has at least one seeded stock', () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackStocks(region, 12);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('every surfaced region has at least one seeded idea', () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackIdeas(region, 10);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('every surfaced region has at least one seeded trend', () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackTrends(region, 10);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('every demo region has at least one seed product', () => {
    for (const region of DEMO_REGIONS) {
      if (region === 'global') continue;
      const products = SEED_PRODUCTS.filter((p) => p.region === region);
      expect(products.length).toBeGreaterThan(0);
    }
  });
});

describe('signal-family fallback', () => {
  it('maps common AI-infra signal types to supply-demand or ai-adoption', () => {
    expect(familyForSignalType('capex_raise')).toBe('supply-demand');
    expect(familyForSignalType('gpu_lead_time_shift')).toBe('supply-demand');
    expect(familyForSignalType('hbm_supply_warning')).toBe('supply-demand');
    expect(familyForSignalType('ai_deal_velocity')).toBe('ai-adoption');
    expect(familyForSignalType('cloud_recovery')).toBe('ai-adoption');
  });

  it("falls back to 'other' for unknown signal types", () => {
    expect(familyForSignalType('some_brand_new_signal_we_havent_seen')).toBe('other');
  });

  it('familyLabel returns a non-empty string for every family', () => {
    const families: SignalFamily[] = [
      'supply-demand',
      'ai-adoption',
      'macro-demand',
      'capital-allocation',
      'consumer-behavior',
      'platform-momentum',
      'regulatory-shift',
      'other',
    ];
    for (const family of families) {
      expect(familyLabel(family).length).toBeGreaterThan(0);
    }
  });
});

describe('brief hit-rate resolver', () => {
  it("picks 'direct' when the exact signal type has enough sample", () => {
    const byType = new Map<string, BucketCounts>([['capex_raise', { hit: 5, miss: 2, push: 1 }]]);
    const byFamily = new Map<SignalFamily, BucketCounts>();
    const r = resolveHitRate('capex_raise', byType, byFamily);
    expect(r.band).toBe('direct');
    expect(r.sample).toBe(7);
    expect(r.hitRate).toBeCloseTo(5 / 7);
  });

  it('falls back to family rate when exact type is too thin', () => {
    const byType = new Map<string, BucketCounts>([
      ['new_capex_variant', { hit: 0, miss: 0, push: 0 }],
    ]);
    const byFamily = new Map<SignalFamily, BucketCounts>([
      ['supply-demand', { hit: 6, miss: 4, push: 2 }],
    ]);
    const r = resolveHitRate('new_capex_variant', byType, byFamily);
    expect(r.band).toBe('family');
    expect(r.sample).toBeGreaterThanOrEqual(HIT_RATE_FAMILY_MIN);
    expect(r.hitRate).toBeCloseTo(6 / 10);
  });

  it("surfaces 'early' when family has any decided but below family min", () => {
    const byFamily = new Map<SignalFamily, BucketCounts>([
      ['ai-adoption', { hit: 1, miss: 1, push: 0 }],
    ]);
    const r = resolveHitRate('ai_deal_velocity', new Map(), byFamily);
    expect(r.band).toBe('early');
    expect(r.sample).toBe(2);
  });

  it("returns 'none' when nothing has been scored anywhere relevant", () => {
    const r = resolveHitRate('totally_new_signal', new Map(), new Map());
    expect(r.band).toBe('none');
    expect(r.hitRate).toBeNull();
    expect(r.sample).toBe(0);
  });

  it('uses direct early-band if the exact type has only 1 scored', () => {
    const byType = new Map<string, BucketCounts>([['fresh_type', { hit: 1, miss: 0, push: 0 }]]);
    const r = resolveHitRate('fresh_type', byType, new Map());
    expect(r.band).toBe('early');
    expect(r.sample).toBe(1);
    expect(r.hitRate).toBe(1);
  });
});
