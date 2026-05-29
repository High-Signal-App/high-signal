import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../index";

const originalFetch = globalThis.fetch;

// Convergence now overlays Wikipedia Pageviews via globalThis.fetch when an
// entity has a wiki_url in the bundled seed. Stub it out so unit tests don't
// hit the network.
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response("", { status: 404 }));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

/** Minimal D1 mock — supports `.prepare().bind().all<T>()` like the real binding.
 *  Dispatches to the appropriate fixture by SQL fingerprint:
 *    - LAG(prob)   → velocity (market_quotes window query)
 *    - ROW_NUMBER  → recent (events × ROW_NUMBER)
 *    - else        → summary (top-level convergence aggregation)
 */
function mockDb(results: {
  summary?: unknown[];
  recent?: unknown[];
  velocity?: unknown[];
}) {
  let lastSql = "";
  return {
    prepare: vi.fn((sql: string) => {
      lastSql = sql;
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn(async () => ({
          results: lastSql.includes("LAG(prob)")
            ? results.velocity ?? []
            : lastSql.includes("ROW_NUMBER")
              ? results.recent ?? []
              : results.summary ?? [],
        })),
      };
    }),
  };
}

const envWithDb = (db: ReturnType<typeof mockDb>) => ({
  DB: db as unknown as D1Database,
  ENVIRONMENT: "test",
});

describe("/convergence", () => {
  it("returns empty rows when DB has nothing in the window", async () => {
    const db = mockDb({ summary: [], recent: [] });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      windowHours: number;
      minSources: number;
      rows: unknown[];
    };
    expect(body.windowHours).toBe(24);
    expect(body.minSources).toBe(3);
    expect(body.rows).toEqual([]);
  });

  it("clamps `hours` and `min_sources` to safe ranges", async () => {
    const db = mockDb({ summary: [], recent: [] });
    const res = await fetcher.fetch(
      new Request("http://t/convergence?hours=999999&min_sources=50"),
      envWithDb(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { windowHours: number; minSources: number };
    // 999999 hours → clamped to 30 days = 720
    expect(body.windowHours).toBe(24 * 30);
    // 50 → clamped to 10
    expect(body.minSources).toBe(10);
  });

  it("attaches market velocity when a prediction-market quote exists", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "NVDA",
          entity_name: "NVIDIA",
          entity_ticker: "NVDA",
          entity_sector: "Information Technology",
          source_count: 4,
          event_count: 8,
          sources: "edgar_8k,news,reddit,market:polymarket",
          latest_at: 1700000000,
          earliest_at: 1699990000,
        },
      ],
      recent: [],
      velocity: [
        {
          entity_id: "NVDA",
          source: "polymarket",
          market_id: "abc-123",
          question: "Will NVDA hit $400 by year-end?",
          market_url: "https://polymarket.com/event/nvda",
          prob_now: 0.72,
          fetched_at_now: 1700000000,
          prob_prior: 0.55,
          fetched_at_prior: 1699985600, // 4h earlier
        },
      ],
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{
        entityId: string;
        marketQuote: {
          source: string;
          probNow: number;
          probPrior: number;
          probChange: number;
        } | null;
      }>;
    };
    expect(body.rows[0].marketQuote).not.toBeNull();
    expect(body.rows[0].marketQuote!.source).toBe("polymarket");
    expect(body.rows[0].marketQuote!.probNow).toBeCloseTo(0.72);
    expect(body.rows[0].marketQuote!.probChange).toBeCloseTo(0.17, 5);
  });

  it("labels rows as 'breakout' when ≥3 sources fire AND attention surges ≥25%", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "NVDA",
          entity_name: "NVIDIA",
          entity_ticker: "NVDA",
          entity_sector: null,
          source_count: 4,
          event_count: 10,
          sources: "news,reddit,ir,market:polymarket",
          latest_at: 1700000000,
          earliest_at: 1699900000,
          first_seen_ever: 1500000000,
        },
      ],
      recent: [],
      velocity: [],
    });
    // Mock Wikipedia: NVDA attention up 40% over prior week
    globalThis.fetch = vi.fn(async () => {
      const items = [
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026050${i + 1}00`, views: 1000 })),
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026051${i + 1}00`, views: 1400 })),
      ];
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    const body = (await res.json()) as { rows: Array<{ label: string | null; labelReason: string | null }> };
    expect(body.rows[0].label).toBe("breakout");
    expect(body.rows[0].labelReason).toMatch(/attention/);
  });

  it("labels rows as 'divergence' when ≥3 sources fire AND attention is dropping", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "NVDA",
          entity_name: "NVIDIA",
          entity_ticker: "NVDA",
          entity_sector: null,
          source_count: 5,
          event_count: 30,
          sources: "news,reddit,ir,market:polymarket,gdelt:nvda",
          latest_at: 1700000000,
          earliest_at: 1699900000,
          first_seen_ever: 1500000000,
        },
      ],
      recent: [],
      velocity: [],
    });
    // Attention -40% (sharp drop)
    globalThis.fetch = vi.fn(async () => {
      const items = [
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026050${i + 1}00`, views: 2000 })),
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026051${i + 1}00`, views: 1200 })),
      ];
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    const body = (await res.json()) as { rows: Array<{ label: string | null }> };
    expect(body.rows[0].label).toBe("divergence");
  });

  it("does NOT label flat-trend or sub-25% gains", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "NVDA",
          entity_name: "NVIDIA",
          entity_ticker: "NVDA",
          entity_sector: null,
          source_count: 3,
          event_count: 5,
          sources: "news,reddit,ir",
          latest_at: 1700000000,
          earliest_at: 1699900000,
          first_seen_ever: 1500000000,
        },
      ],
      recent: [],
      velocity: [],
    });
    // ~10% gain — under the 25% breakout threshold + over the 5% flat band.
    globalThis.fetch = vi.fn(async () => {
      const items = [
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026050${i + 1}00`, views: 1000 })),
        ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `2026051${i + 1}00`, views: 1100 })),
      ];
      return new Response(JSON.stringify({ items }), {
        headers: { "content-type": "application/json" },
      });
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    const body = (await res.json()) as { rows: Array<{ label: string | null }> };
    expect(body.rows[0].label).toBeNull();
  });

  it("marketQuote is null when no market_quote exists for the entity", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "OBSCURE",
          entity_name: "Obscure Co",
          entity_ticker: "OBSC",
          entity_sector: null,
          source_count: 3,
          event_count: 5,
          sources: "news,reddit,ir",
          latest_at: 1700000000,
          earliest_at: 1699990000,
        },
      ],
      recent: [],
      velocity: [], // no market quote for OBSCURE
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    const body = (await res.json()) as { rows: Array<{ marketQuote: unknown | null }> };
    expect(body.rows[0].marketQuote).toBeNull();
  });

  it("probChange is null when no prior tick exists yet (new market)", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "BRAND-NEW",
          entity_name: "Just Listed",
          entity_ticker: null,
          entity_sector: null,
          source_count: 3,
          event_count: 3,
          sources: "news,reddit,market:kalshi",
          latest_at: 1700000000,
          earliest_at: 1700000000,
        },
      ],
      recent: [],
      velocity: [
        {
          entity_id: "BRAND-NEW",
          source: "kalshi",
          market_id: "NEW-MARKET",
          question: "...",
          market_url: "https://kalshi.com/markets/NEW-MARKET",
          prob_now: 0.5,
          fetched_at_now: 1700000000,
          prob_prior: null,
          fetched_at_prior: null,
        },
      ],
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    const body = (await res.json()) as {
      rows: Array<{ marketQuote: { probNow: number; probChange: number | null } }>;
    };
    expect(body.rows[0].marketQuote.probNow).toBeCloseTo(0.5);
    expect(body.rows[0].marketQuote.probChange).toBeNull();
  });

  it("returns shaped rows with attached recent events", async () => {
    const db = mockDb({
      summary: [
        {
          primary_entity_id: "AAPL",
          entity_name: "Apple Inc.",
          entity_ticker: "AAPL",
          entity_sector: "Information Technology",
          source_count: 4,
          event_count: 11,
          sources: "edgar_8k,news,reddit,market:polymarket",
          latest_at: 1700000000,
          earliest_at: 1699990000,
        },
      ],
      recent: [
        {
          primary_entity_id: "AAPL",
          source: "news",
          title: "Apple announces new chip",
          source_url: "https://example/a",
          published_at: 1700000000,
        },
        {
          primary_entity_id: "AAPL",
          source: "reddit",
          title: "AAPL discussion",
          source_url: "https://example/b",
          published_at: 1699999000,
        },
      ],
    });
    const res = await fetcher.fetch(new Request("http://t/convergence"), envWithDb(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{
        entityId: string;
        ticker: string;
        sourceCount: number;
        sources: string[];
        recent: unknown[];
      }>;
    };
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0];
    expect(row.entityId).toBe("AAPL");
    expect(row.ticker).toBe("AAPL");
    expect(row.sourceCount).toBe(4);
    expect(row.sources).toEqual([
      "edgar_8k",
      "news",
      "reddit",
      "market:polymarket",
    ]);
    expect(row.recent).toHaveLength(2);
  });

  it("respects custom min_sources", async () => {
    const db = mockDb({ summary: [], recent: [] });
    const res = await fetcher.fetch(
      new Request("http://t/convergence?min_sources=5&hours=48"),
      envWithDb(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { windowHours: number; minSources: number };
    expect(body.windowHours).toBe(48);
    expect(body.minSources).toBe(5);
  });
});
