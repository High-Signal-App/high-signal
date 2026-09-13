import { describe, expect, it } from 'vitest';
import {
  buildBriefEditionReceipt,
  categoryStatesForSnapshot,
  countriesForRegion,
  extractBriefEditorialSummary,
  familyForSignalType,
  familyLabel,
  isCompleteBriefText,
  isRegion,
  pruneUnpublishableBriefItems,
  PUBLIC_BRIEF_REGIONS,
  REGIONS,
  regionLabel,
  summarizeBriefDiscovery,
  type Region,
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
  rankStocks,
  resolveHitRate,
  type BucketCounts,
} from '../routes/brief';

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

  it('offers a bounded set of valid regions in the public brief picker', () => {
    expect(PUBLIC_BRIEF_REGIONS.length).toBeGreaterThanOrEqual(5);
    expect(PUBLIC_BRIEF_REGIONS.length).toBeLessThanOrEqual(7);
    expect(PUBLIC_BRIEF_REGIONS[0]).toBe('global');
    for (const region of PUBLIC_BRIEF_REGIONS) expect(REGIONS).toContain(region);
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

  it('skips generic editorial section labels', () => {
    expect(
      headlineFromBody(
        '## What changed\nA federal judge vacated the supply-chain designation.',
        'Anthropic'
      )
    ).toBe('A federal judge vacated the supply-chain designation.');
  });

  it('truncates long headlines at a word boundary', () => {
    const headline = headlineFromBody(
      `## What changed\n${'A material regulatory development with independently verified consequences '.repeat(4)}`,
      'Anthropic'
    );

    expect(headline.length).toBeLessThanOrEqual(161);
    expect(headline).toMatch(/…$/);
    expect(headline).not.toMatch(/ consequ…$/);
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
    expect(
      extractBriefEditorialSummary(
        'A judge removed a supply-chain risk designation. The ruling signals renewed enterprise access. However, an appeal could reverse the order.'
      )
    ).toEqual({
      whatChanged: 'A judge removed a supply-chain risk designation.',
      whyItMatters: 'The ruling signals renewed enterprise access.',
      uncertainty: 'However, an appeal could reverse the order.',
    });
    expect(
      extractBriefEditorialSummary(`
## What changed
A court removed the designation.
## Why it matters
The ruling signals renewed enterprise access.
## Uncertainty and watchpoints
An appeal could reverse the order.
## Evidence
Primary and corroborating reports are attached.
`)
    ).toEqual({
      whatChanged: 'A court removed the designation.',
      whyItMatters: 'The ruling signals renewed enterprise access.',
      uncertainty: 'An appeal could reverse the order.',
    });
    expect(extractBriefEditorialSummary('Amazon announced a new data center.')).toBeNull();
    expect(isCompleteBriefText('A complete editorial sentence with grounded detail.')).toBe(true);
    expect(isCompleteBriefText('broken [link](https://example.com')).toBe(false);
  });

  const validSnapshot = (): BriefSnapshot => ({
    generatedAt: '2026-08-11T07:00:00.000Z',
    region: 'global',
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

  it('does not let news items fail or inflate the market-signal receipt', () => {
    const snapshot = validSnapshot();
    snapshot.news = [
      {
        id: 'news-1',
        title: 'Single-source reported news',
        summary: 'A retained excerpt describes the announcement without a second origin.',
        event_at: '2026-08-11T05:00:00.000Z',
        what_changed: '',
        source_references: [{ url: 'https://reuters.com/example' }],
        evidence_status: 'reported',
      },
    ];
    expect(buildBriefEditionReceipt(snapshot).publishable).toBe(true);
    const pruned = pruneUnpublishableBriefItems({
      ...snapshot,
      stocks: snapshot.stocks.map((item) => ({ ...item, evidenceUrls: [] })),
    });
    expect(pruned.snapshot.news).toEqual(snapshot.news);
  });

  it('withholds research opportunities and trends without claim evidence while keeping qualified stock items', () => {
    const snapshot = validSnapshot();
    const item = {
      title: 'Research hypothesis',
      description: 'Customers may need a different product.',
      whyNow: 'A product listing was collected this week.',
      region: 'global' as const,
      source: 'opportunity' as const,
      subreddit: 'synthetic',
      surfacedAt: '2026-09-09T00:00:00Z',
      evidenceUrls: [{ url: 'https://marketplace.example/product' }],
    };
    snapshot.ideas = [item];
    snapshot.trends = [item];
    const pruned = pruneUnpublishableBriefItems(snapshot);
    expect(pruned.snapshot.ideas).toEqual([]);
    expect(pruned.snapshot.trends).toEqual([]);
    expect(pruned.snapshot.stocks).toHaveLength(1);
    expect(pruned.snapshot.categoryStates?.ideas.reason).toBe('items_withheld_by_publish_gate');
    expect(snapshot.ideas).toHaveLength(1);
  });

  it('requires matching citations and independent origins for a supported opportunity', () => {
    const snapshot = validSnapshot();
    const stock = snapshot.stocks[0];
    snapshot.ideas = [
      {
        title: 'Supported opportunity',
        description: 'Two retained sources document the same customer need.',
        whyNow: 'Independent sources reported this need this week.',
        region: 'global',
        source: 'opportunity',
        subreddit: null,
        surfacedAt: '2026-09-09T00:00:00Z',
        evidenceUrls: stock.evidenceUrls,
        provenance: { ...stock.provenance!, assertion: 'A customer need exists.' },
      },
    ];
    expect(pruneUnpublishableBriefItems(snapshot).snapshot.ideas).toHaveLength(1);
    snapshot.ideas[0].provenance!.independentOriginCount = 1;
    expect(pruneUnpublishableBriefItems(snapshot).snapshot.ideas).toEqual([]);
    snapshot.ideas[0].provenance!.independentOriginCount = 2;
    snapshot.ideas[0].evidenceUrls = [
      { url: 'https://unrelated.example/' },
      { url: 'https://other.example/' },
    ];
    expect(pruneUnpublishableBriefItems(snapshot).snapshot.ideas).toEqual([]);
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
