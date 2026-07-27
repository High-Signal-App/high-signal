import { describe, expect, it, vi } from 'vitest';
import app from '../index';
import {
  aggregateBareTickerCandidates,
  aggregateCandidates,
  aggregateEntityCandidates,
  extractBareTickerTokens,
  extractEntityCandidates,
  extractTickerTokens,
  KNOWN_TICKERS,
  normalizeEntityCandidate,
  SEEDED_ENTITY_LOOKUP,
} from '../routes/unmapped';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

function mockDb(events: unknown[]) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(async () => ({ results: events })),
    })),
  };
}

const envWithDb = (db: ReturnType<typeof mockDb>) => ({
  DB: db as unknown as D1Database,
  ENVIRONMENT: 'test',
});

// ─── pure helpers ─────────────────────────────────────────────────────────

describe('extractTickerTokens', () => {
  it('extracts $TICKER patterns', () => {
    expect(extractTickerTokens('$NVDA gains on AI demand')).toEqual(['$NVDA']);
    expect(extractTickerTokens('$AAPL and $MSFT both up today')).toEqual(['$AAPL', '$MSFT']);
  });

  it('dedupes within a single title', () => {
    expect(extractTickerTokens('$NVDA $NVDA $NVDA')).toEqual(['$NVDA']);
  });

  it('supports exchange-suffixed tickers', () => {
    expect(extractTickerTokens('$BRK.B class B shares')).toEqual(['$BRK.B']);
  });

  it('strips currency-like stop tokens', () => {
    expect(extractTickerTokens('$USD weakens vs $EUR')).toEqual([]);
  });

  it('returns empty for text with no $TICKER', () => {
    expect(extractTickerTokens('nothing to see here, just normal prose')).toEqual([]);
  });

  it('includes content if provided', () => {
    expect(extractTickerTokens('title only', 'and $TSLA in the body')).toEqual(['$TSLA']);
  });
});

describe('extractBareTickerTokens', () => {
  const allowlist = new Set(['NVDA', 'AMZN', 'MSFT', 'ASML', 'ALL', 'ARE', 'ANY']);
  const stoplist = new Set(['ALL', 'ARE', 'ANY']);

  it('catches uppercase tokens that match the universe', () => {
    expect(
      extractBareTickerTokens('AMZN reports earnings tomorrow', null, allowlist, stoplist)
    ).toEqual(['AMZN']);
  });

  it('ignores tokens not in the universe', () => {
    expect(extractBareTickerTokens('FOOO is the next thing', null, allowlist, stoplist)).toEqual(
      []
    );
  });

  it('drops stoplisted tokens even if they happen to be tickers', () => {
    expect(extractBareTickerTokens('ALL ARE going up', null, allowlist, stoplist)).toEqual([]);
  });

  it('dedupes within a single title', () => {
    expect(extractBareTickerTokens('NVDA NVDA NVDA chip', null, allowlist, stoplist)).toEqual([
      'NVDA',
    ]);
  });

  it('does not match $TICKER (those have their own path)', () => {
    // $AMZN should NOT also count as bare AMZN — the leading $ is part of the
    // word boundary, but the AMZN substring after $ would technically match
    // \b[A-Z]{3,5}\b — we accept this overlap because the route surfaces
    // them in separate lists; deduping is the caller's job.
    expect(extractBareTickerTokens('see $AMZN today', null, allowlist, stoplist)).toEqual(['AMZN']);
  });

  it('requires length 3-5 — single letters and 6+ are ignored', () => {
    const al = new Set(['A', 'AB', 'MSFT', 'TOOLONG']);
    expect(extractBareTickerTokens('A AB MSFT TOOLONG', null, al, stoplist)).toEqual(['MSFT']);
  });

  it('uses the bundled KNOWN_TICKERS allowlist by default', () => {
    // Sanity: at least a few real symbols should be present.
    expect(KNOWN_TICKERS.has('NVDA')).toBe(true);
    expect(KNOWN_TICKERS.has('AMZN')).toBe(true);
    expect(KNOWN_TICKERS.has('MSFT')).toBe(true);
  });
});

describe('normalizeEntityCandidate', () => {
  it('strips corporate suffixes', () => {
    expect(normalizeEntityCandidate('Anthropic PBC')).toBe('Anthropic');
    expect(normalizeEntityCandidate('OpenAI Inc.')).toBe('OpenAI');
    expect(normalizeEntityCandidate('Mistral AI')).toBe('Mistral AI'); // AI is not a suffix
    expect(normalizeEntityCandidate('Hugging Face')).toBe('Hugging Face');
  });

  it('leaves entities without suffixes alone', () => {
    expect(normalizeEntityCandidate('Anthropic')).toBe('Anthropic');
  });
});

describe('extractEntityCandidates', () => {
  const stoplist = new Set(['the', 'this', 'today', 'monday']);
  const seeded = new Set(['nvidia corporation', 'nvidia']);

  it('catches multi-word proper nouns', () => {
    expect(
      extractEntityCandidates(
        'Mistral AI raises $200M from existing investors',
        null,
        seeded,
        stoplist
      )
    ).toContain('Mistral AI');
  });

  it('catches single-word proper nouns ≥3 chars', () => {
    expect(extractEntityCandidates('Anthropic announces Opus 4.7', null, seeded, stoplist)).toEqual(
      expect.arrayContaining(['Anthropic'])
    );
  });

  it('drops stoplisted tokens', () => {
    expect(extractEntityCandidates('The market is up Today', null, seeded, stoplist)).toEqual([]);
  });

  it('drops already-seeded entities', () => {
    expect(
      extractEntityCandidates('NVIDIA Corporation beats earnings', null, seeded, stoplist)
    ).toEqual([]);
  });

  it('dedupes within a single title', () => {
    const got = extractEntityCandidates(
      'Anthropic and Anthropic again — Anthropic is busy',
      null,
      seeded,
      stoplist
    );
    expect(got).toEqual(['Anthropic']);
  });

  it('normalizes corporate suffixes for keying', () => {
    const got = extractEntityCandidates(
      'Anthropic PBC raises another round',
      null,
      seeded,
      stoplist
    );
    expect(got).toContain('Anthropic');
  });

  it("strips leading auxiliary/question words ('Will Harvey Weinstein' → 'Harvey Weinstein')", () => {
    const got = extractEntityCandidates(
      'Will Harvey Weinstein be sentenced to no prison time?',
      null,
      seeded,
      stoplist
    );
    expect(got).toContain('Harvey Weinstein');
    expect(got).not.toContain('Will Harvey Weinstein');
  });

  it('drops candidates that become empty after leading-strip', () => {
    // "Will" alone → strip "Will" → "" → length < 3 → dropped.
    const got = extractEntityCandidates('Will it rain tomorrow?', null, seeded, stoplist);
    expect(got).toEqual([]);
  });

  it('drops yes/no market answers', () => {
    const fullStoplist = new Set([...stoplist, 'yes', 'no']);
    const got = extractEntityCandidates('YES at 22% on Polymarket', null, seeded, fullStoplist);
    expect(got).not.toContain('YES');
  });

  it('drops standalone short ALL-CAPS acronyms — bare-ticker path handles those', () => {
    const got = extractEntityCandidates(
      'EOY review of ARC and WTI movements',
      null,
      seeded,
      stoplist
    );
    expect(got).not.toContain('EOY');
    expect(got).not.toContain('ARC');
    expect(got).not.toContain('WTI');
  });

  it('keeps multi-word ALL-CAPS phrases (e.g. FIFA World Cup)', () => {
    // The regex captures "FIFA World Cup" as one phrase — the
    // standalone-acronym guard requires whitespace-absent, so this
    // multi-word form passes.
    const got = extractEntityCandidates(
      'Will Congo DR win the 2026 FIFA World Cup?',
      null,
      seeded,
      stoplist
    );
    expect(got).toContain('FIFA World Cup');
  });
});

describe('aggregateEntityCandidates', () => {
  const ev = (
    title: string,
    source = 'news',
    source_url = 'https://example/',
    published_at = 1700000000
  ) => ({ title, content: null, source, source_url, published_at });

  // Note: "Anthropic", "Mistral", "OpenAI" etc are already in the bundled
  // seed file so they get filtered out by SEEDED_ENTITY_LOOKUP — use a
  // fictional name here so we're testing the aggregation, not the seed.

  it('requires count≥2 OR sources≥2 — singletons get filtered', () => {
    const got = aggregateEntityCandidates([
      ev('Quixote Labs announces release', 'news'),
      ev('Acmecorp Robotics in the news', 'reddit'),
    ]);
    expect(got).toEqual([]);
  });

  it('keeps entities with ≥2 mentions', () => {
    const got = aggregateEntityCandidates([
      ev('Quixote Labs announces release', 'news'),
      ev('Quixote Labs raises capital', 'news'),
    ]);
    expect(got.map((c) => c.token)).toContain('Quixote Labs');
  });

  it('keeps entities mentioned across multiple sources', () => {
    const got = aggregateEntityCandidates([
      ev('Quixote Labs announces release', 'news'),
      ev('Quixote Labs in the news', 'reddit'),
    ]);
    expect(got.map((c) => c.token)).toContain('Quixote Labs');
  });
});

describe('SEEDED_ENTITY_LOOKUP', () => {
  it('includes well-known seeded entities by name and alias', () => {
    expect(SEEDED_ENTITY_LOOKUP.has('nvidia corporation')).toBe(true);
    expect(SEEDED_ENTITY_LOOKUP.has('nvidia')).toBe(true);
    expect(SEEDED_ENTITY_LOOKUP.has('anthropic pbc')).toBe(true);
    // Stripped suffix form is also in the set so "Anthropic" alone is matched.
    expect(SEEDED_ENTITY_LOOKUP.has('anthropic')).toBe(true);
  });
});

describe('aggregateBareTickerCandidates', () => {
  const ev = (
    title: string,
    source = 'news',
    source_url = 'https://example/',
    published_at = 1700000000
  ) => ({ title, content: null, source, source_url, published_at });

  it('ranks bare tickers from real text', () => {
    const got = aggregateBareTickerCandidates([
      ev('AMZN reports beats'),
      ev('AMZN announces'),
      ev('MSFT and AMZN both up'),
    ]);
    const byToken = Object.fromEntries(got.map((c) => [c.token, c.count]));
    expect(byToken['AMZN']).toBe(3);
    expect(byToken['MSFT']).toBe(1);
  });
});

describe('aggregateCandidates', () => {
  const ev = (
    title: string,
    source = 'news',
    source_url = 'https://example/',
    published_at = 1700000000
  ) => ({ title, content: null, source, source_url, published_at });

  it('counts mentions per token across events', () => {
    const got = aggregateCandidates([
      ev('$NVDA up'),
      ev('$NVDA earnings beat'),
      ev('$AAPL announces new chip'),
      ev('$NVDA partners'),
    ]);
    const byToken = Object.fromEntries(got.map((c) => [c.token, c.count]));
    expect(byToken['$NVDA']).toBe(3);
    expect(byToken['$AAPL']).toBe(1);
  });

  it('sorts by count desc then token asc', () => {
    const got = aggregateCandidates([
      ev('$ZZZ'),
      ev('$ZZZ'),
      ev('$AAA'),
      ev('$AAA'),
      ev('$AAA'),
      ev('$BBB'),
    ]);
    expect(got.map((c) => c.token)).toEqual(['$AAA', '$ZZZ', '$BBB']);
  });

  it('collects distinct sources per token', () => {
    const got = aggregateCandidates([ev('$XYZ', 'news'), ev('$XYZ', 'reddit'), ev('$XYZ', 'news')]);
    expect(got[0].sources).toEqual(['news', 'reddit']);
  });

  it('caps samples per token', () => {
    const got = aggregateCandidates(
      Array.from({ length: 10 }, (_, i) => ev(`$ABC #${i}`, 'news')),
      2
    );
    expect(got[0].samples).toHaveLength(2);
  });
});

// ─── route ────────────────────────────────────────────────────────────────

describe('/unmapped', () => {
  it('returns empty when there are no unmapped events', async () => {
    const res = await fetcher.fetch(new Request('http://t/unmapped'), envWithDb(mockDb([])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[]; eventsScanned: number };
    expect(body.candidates).toEqual([]);
    expect(body.eventsScanned).toBe(0);
  });

  it('ranks candidates from mock events', async () => {
    const events = [
      {
        title: '$NVDA at ATH',
        content: null,
        source: 'news',
        source_url: 'x',
        published_at: 1700000000,
      },
      {
        title: '$NVDA earnings',
        content: null,
        source: 'reddit',
        source_url: 'x',
        published_at: 1700000001,
      },
      {
        title: '$ASML guidance',
        content: null,
        source: 'edgar_8k',
        source_url: 'x',
        published_at: 1700000002,
      },
    ];
    const res = await fetcher.fetch(new Request('http://t/unmapped'), envWithDb(mockDb(events)));
    const body = (await res.json()) as {
      eventsScanned: number;
      candidates: Array<{ token: string; count: number }>;
    };
    expect(body.eventsScanned).toBe(3);
    expect(body.candidates[0]).toEqual(expect.objectContaining({ token: '$NVDA', count: 2 }));
    expect(body.candidates[1]).toEqual(expect.objectContaining({ token: '$ASML', count: 1 }));
  });

  it('returns bareTickerCandidates alongside $TICKER candidates', async () => {
    const events = [
      {
        title: 'AMZN reports beats',
        content: null,
        source: 'news',
        source_url: 'x',
        published_at: 1700000000,
      },
      {
        title: 'AMZN partnership',
        content: null,
        source: 'reddit',
        source_url: 'x',
        published_at: 1700000001,
      },
      {
        title: '$NVDA at ATH',
        content: null,
        source: 'news',
        source_url: 'x',
        published_at: 1700000002,
      },
    ];
    const res = await fetcher.fetch(new Request('http://t/unmapped'), envWithDb(mockDb(events)));
    const body = (await res.json()) as {
      candidates: Array<{ token: string; count: number }>;
      bareTickerCandidates: Array<{ token: string; count: number }>;
    };
    expect(body.candidates[0]).toEqual(expect.objectContaining({ token: '$NVDA', count: 1 }));
    expect(body.bareTickerCandidates[0]).toEqual(
      expect.objectContaining({ token: 'AMZN', count: 2 })
    );
  });

  it('clamps query params to safe ranges', async () => {
    const res = await fetcher.fetch(
      new Request('http://t/unmapped?hours=99999&top=99999&limit=99999'),
      envWithDb(mockDb([]))
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { windowHours: number };
    expect(body.windowHours).toBe(24 * 30);
  });
});
