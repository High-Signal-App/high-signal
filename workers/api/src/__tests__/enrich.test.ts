import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import { buildSparql, enrichmentToCsvRow, parseSparql } from "../routes/enrich";

const fetcher = app as unknown as {
  fetch(req: Request, env?: Record<string, unknown>): Promise<Response>;
};

const originalFetch = globalThis.fetch;

describe("enrich pure helpers", () => {
  it("buildSparql includes the ticker as a literal", () => {
    const q = buildSparql("NVDA");
    expect(q).toContain('wdt:P249 "NVDA"');
    expect(q).toContain("?countryLabel");
    expect(q).toContain("schema:about");
  });

  it("parseSparql returns nulls when the response is empty", () => {
    const out = parseSparql("XYZ", { results: { bindings: [] } });
    expect(out.ticker).toBe("XYZ");
    expect(out.name).toBeNull();
    expect(out.wikidataId).toBeNull();
  });

  it("parseSparql handles missing body gracefully", () => {
    const out = parseSparql("XYZ", null);
    expect(out.ticker).toBe("XYZ");
    expect(out.name).toBeNull();
  });

  it("parseSparql extracts the first binding's fields", () => {
    const body = {
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q182477" },
            itemLabel: { value: "NVIDIA Corporation" },
            countryLabel: { value: "United States" },
            industryLabel: { value: "Graphics Processing Units" },
            exchangeLabel: { value: "NASDAQ" },
            article: { value: "https://en.wikipedia.org/wiki/Nvidia" },
            cik: { value: "1045810" },
          },
        ],
      },
    };
    const out = parseSparql("NVDA", body);
    expect(out.ticker).toBe("NVDA");
    expect(out.wikidataId).toBe("Q182477");
    expect(out.name).toBe("NVIDIA Corporation");
    expect(out.country).toBe("United States");
    expect(out.industry).toBe("Graphics Processing Units");
    expect(out.wikiUrl).toBe("https://en.wikipedia.org/wiki/Nvidia");
    expect(out.cik).toBe("1045810");
  });

  it("enrichmentToCsvRow produces a 10-cell row in ai_infra_entities.csv format", () => {
    const row = enrichmentToCsvRow({
      ticker: "NVDA",
      wikidataId: "Q182477",
      name: "NVIDIA Corporation",
      country: "United States",
      industry: "Graphics Processing Units",
      exchange: "NASDAQ",
      wikiUrl: "https://en.wikipedia.org/wiki/Nvidia",
      cik: "1045810",
      isin: null,
    });
    // CSV row should have 10 columns
    expect(row.split(",").length).toBeGreaterThanOrEqual(10);
    expect(row).toContain("NVDA");
    expect(row).toContain("NVIDIA Corporation");
    expect(row).toContain("public");
  });

  it("enrichmentToCsvRow quotes cells containing commas", () => {
    const row = enrichmentToCsvRow({
      ticker: "TEST",
      wikidataId: null,
      name: "Corp, Inc.",
      country: null,
      industry: null,
      exchange: null,
      wikiUrl: null,
      cik: null,
      isin: null,
    });
    expect(row).toContain('"Corp, Inc."');
  });
});


describe("/enrich/ticker", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 when token is missing", async () => {
    const res = await fetcher.fetch(new Request("http://t/enrich/ticker"));
    expect(res.status).toBe(400);
  });

  it("strips a leading $ from the token", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ results: { bindings: [] } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const res = await fetcher.fetch(new Request("http://t/enrich/ticker?token=$NVDA"));
    expect(res.status).toBe(200);
    // SPARQL request URL should contain the bare ticker, not "$NVDA"
    expect(decodeURIComponent(capturedUrl)).toContain('"NVDA"');
    expect(decodeURIComponent(capturedUrl)).not.toContain('"$NVDA"');
  });

  it("returns fallback enrichment when Wikidata is down", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await fetcher.fetch(new Request("http://t/enrich/ticker?token=$AAPL"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enrichment: { ticker: string; name: string | null };
      csvRow: string;
    };
    expect(body.enrichment.ticker).toBe("AAPL");
    expect(body.enrichment.name).toBeNull();
    expect(body.csvRow).toContain("AAPL");
  });

  it("returns the parsed enrichment when Wikidata answers", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: {
            bindings: [
              {
                item: { value: "http://www.wikidata.org/entity/Q312" },
                itemLabel: { value: "Apple Inc." },
                countryLabel: { value: "United States" },
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const res = await fetcher.fetch(new Request("http://t/enrich/ticker?token=$AAPL"));
    const body = (await res.json()) as {
      enrichment: { name: string };
      csvRow: string;
    };
    expect(body.enrichment.name).toBe("Apple Inc.");
    expect(body.csvRow).toContain("Apple Inc.");
  });
});
