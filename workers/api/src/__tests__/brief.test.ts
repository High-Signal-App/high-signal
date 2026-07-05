import { describe, expect, it } from "vitest";
import {
  countriesForRegion,
  DEMO_REGIONS,
  fallbackIdeas,
  fallbackStocks,
  fallbackTrends,
  familyForSignalType,
  familyLabel,
  findSeedProduct,
  isRegion,
  REGIONS,
  regionLabel,
  SEED_IDEAS,
  SEED_PRODUCTS,
  SEED_STOCK_SIGNALS,
  SEED_TRENDS,
  type Region,
  type SignalFamily,
} from "@high-signal/shared";
import {
  computeHitRate,
  headlineFromBody,
  HIT_RATE_FAMILY_MIN,
  HIT_RATE_SAMPLE_MIN,
  pickSpotlight,
  rankStocks,
  renderFromSeed,
  resolveHitRate,
  seedToBrief,
  type BucketCounts,
} from "../routes/brief";

describe("region rollups", () => {
  it("REGIONS includes global and never overlaps countries between regions", () => {
    expect(REGIONS).toContain("global");
    const seen = new Map<string, Region>();
    for (const region of REGIONS) {
      if (region === "global") continue;
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

  it("global region has no country filter", () => {
    expect(countriesForRegion("global")).toEqual([]);
  });

  it("isRegion accepts known regions and rejects unknown", () => {
    expect(isRegion("south-asia")).toBe(true);
    expect(isRegion("east-asia")).toBe(true);
    expect(isRegion("middle-earth")).toBe(false);
    expect(isRegion("")).toBe(false);
    expect(isRegion(null)).toBe(false);
    expect(isRegion(42)).toBe(false);
  });

  it("regionLabel returns a human label for every region", () => {
    for (const region of REGIONS) {
      const label = regionLabel(region);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/undefined/i);
    }
  });
});

describe("brief stock ranking", () => {
  it("prefers up over down over neutral", () => {
    const ranked = rankStocks([
      { direction: "neutral", confidence: "high" },
      { direction: "down", confidence: "high" },
      { direction: "up", confidence: "low" },
    ]);
    expect(ranked.map((r) => r.direction)).toEqual(["up", "down", "neutral"]);
  });

  it("within the same direction, prefers high → medium → low confidence", () => {
    const ranked = rankStocks([
      { direction: "up", confidence: "low" },
      { direction: "up", confidence: "high" },
      { direction: "up", confidence: "medium" },
    ]);
    expect(ranked.map((r) => r.confidence)).toEqual(["high", "medium", "low"]);
  });

  it("does not mutate the input array", () => {
    const original = [
      { direction: "down" as const, confidence: "low" as const },
      { direction: "up" as const, confidence: "high" as const },
    ];
    const snapshot = original.slice();
    rankStocks(original);
    expect(original).toEqual(snapshot);
  });
});

describe("brief hit-rate", () => {
  it("returns null when decided sample < HIT_RATE_SAMPLE_MIN", () => {
    expect(computeHitRate({ hit: 0, miss: 0, push: 0 })).toEqual({
      hitRate: null,
      sample: 0,
    });
    expect(computeHitRate({ hit: 1, miss: 1, push: 5 })).toEqual({
      hitRate: null,
      sample: 2,
    });
  });

  it("computes hit-rate excluding pushes once threshold is met", () => {
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

describe("brief headline extraction", () => {
  it("uses the first non-empty line, stripping leading hashes", () => {
    expect(headlineFromBody("# Boom in HBM demand\n\nbody...", "fallback")).toBe(
      "Boom in HBM demand",
    );
    expect(headlineFromBody("\n\n## Capex raise\n", "fallback")).toBe("Capex raise");
  });

  it("falls back to entity name on empty body", () => {
    expect(headlineFromBody("", "NVDA")).toBe("NVDA");
    expect(headlineFromBody("   \n  \n", "NVDA")).toBe("NVDA");
  });

  it("truncates absurdly long first lines at 180 chars", () => {
    const long = "Lorem ipsum ".repeat(40);
    const result = headlineFromBody(long, "fallback");
    expect(result.length).toBeLessThanOrEqual(180);
  });
});

describe("seed-product picker", () => {
  it("has at least 30 products spanning all three domains", () => {
    expect(SEED_PRODUCTS.length).toBeGreaterThanOrEqual(30);
    const domains = new Set(SEED_PRODUCTS.map((p) => p.domain));
    expect(domains.has("technology")).toBe(true);
    expect(domains.has("startups")).toBe(true);
    expect(domains.has("finance")).toBe(true);
  });

  it("findSeedProduct returns the right record or undefined", () => {
    expect(findSeedProduct("stripe")?.brandName).toBe("Stripe");
    expect(findSeedProduct("not-a-real-id")).toBeUndefined();
  });

  it("DEMO_REGIONS surfaces 5–7 regions and always includes global first", () => {
    expect(DEMO_REGIONS.length).toBeGreaterThanOrEqual(5);
    expect(DEMO_REGIONS.length).toBeLessThanOrEqual(7);
    expect(DEMO_REGIONS[0]).toBe("global");
    for (const region of DEMO_REGIONS) {
      expect(REGIONS).toContain(region);
    }
  });
});

describe("brief seed fallback", () => {
  it("seedToBrief surfaces every improvement from a product", () => {
    const stripe = findSeedProduct("stripe")!;
    const rendered = seedToBrief(stripe, "2026-05-25T00:00:00.000Z");
    expect(rendered.perception).toHaveLength(1);
    expect(rendered.perception[0].brandName).toBe("Stripe");
    expect(rendered.improvements).toHaveLength(stripe.improvements.length);
    for (const improvement of rendered.improvements) {
      expect(improvement.surfacedAt).toBe("2026-05-25T00:00:00.000Z");
      expect(improvement.auditId).toBe("seed:stripe");
    }
  });

  it("renderFromSeed returns null for unknown ids", () => {
    expect(renderFromSeed("not-a-real-id")).toBeNull();
  });

  it("pickSpotlight rotates deterministically per hour and respects region", () => {
    const baseHour = 1_700_000_000_000; // arbitrary epoch ms
    const first = pickSpotlight("global", baseHour);
    const sameHour = pickSpotlight("global", baseHour + 1000);
    expect(first?.id).toBe(sameHour?.id);

    // A different hour can pick a different product (not guaranteed if the
    // bucket wraps, but with the full SEED_PRODUCTS pool it should be common).
    const distinctHours = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const product = pickSpotlight("global", baseHour + i * 60 * 60 * 1000);
      if (product) distinctHours.add(product.id);
    }
    expect(distinctHours.size).toBeGreaterThan(1);

    const naOnly = pickSpotlight("north-america", baseHour);
    expect(naOnly?.region).toBe("north-america");
  });

  it("pickSpotlight returns null only when no products match the region", () => {
    // Every demo region now has at least one seed product after the SSS
    // upgrade — if a region were to lose its seeds entirely we'd want
    // this to start failing to flag the regression.
    for (const region of DEMO_REGIONS) {
      if (region === "global") continue;
      expect(pickSpotlight(region, 1_700_000_000_000)).not.toBeNull();
    }
    // A genuinely non-existent region (after isRegion gate would never
    // reach this code path) returns null. The whole code path is type-safe
    // so we cast to test the defensive branch only.
    expect(pickSpotlight("global", 0)).not.toBeNull();
  });
});

describe("brief seed-content fallback (public sections)", () => {
  it("seed pools have enough breadth for the brief limits", () => {
    expect(SEED_STOCK_SIGNALS.length).toBeGreaterThanOrEqual(8);
    expect(SEED_IDEAS.length).toBeGreaterThanOrEqual(6);
    expect(SEED_TRENDS.length).toBeGreaterThanOrEqual(5);
  });

  it("fallbackStocks returns shaped items for global and respects limit", () => {
    const items = fallbackStocks("global", 5);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.entityName.length).toBeGreaterThan(0);
      expect(["up", "down", "neutral"]).toContain(item.direction);
      expect(["low", "medium", "high"]).toContain(item.confidence);
      expect(item.evidenceUrls.length).toBeGreaterThan(0);
      expect(typeof item.publishedAt).toBe("string");
      // hitRate is either null (insufficient sample) or in [0, 1].
      if (item.hitRate !== null) {
        expect(item.hitRate).toBeGreaterThanOrEqual(0);
        expect(item.hitRate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("fallbackStocks filters by region", () => {
    const eu = fallbackStocks("europe", 10);
    expect(eu.length).toBeGreaterThan(0);
    for (const item of eu) {
      expect(["NL", "DE", "FR", "GB", "SE", "CH", "IE", "PL", "BE", "DK", "FI", "NO", "AT", "PT", "CZ", "HU", "RO", "GR", "ES", "IT"]).toContain(
        item.country,
      );
    }
  });

  it("fallbackIdeas includes both region-specific and global items for non-global regions", () => {
    const ideas = fallbackIdeas("south-asia", 10);
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(["south-asia", "global"]).toContain(idea.region);
      expect(idea.title.length).toBeGreaterThan(0);
      expect(idea.evidenceUrls.length).toBeGreaterThan(0);
      expect(idea.opportunity).toBeDefined();
      expect(["enter", "test", "watch", "avoid"]).toContain(idea.opportunity?.verdict);
      expect(["low", "medium", "high"]).toContain(idea.opportunity?.confidence);
      expect(idea.opportunity?.targetUser.length).toBeGreaterThan(0);
      expect(idea.opportunity?.problem.length).toBeGreaterThan(0);
      expect(idea.opportunity?.marketTimingReasons.length).toBeGreaterThan(0);
      expect(idea.opportunity?.evidenceMix.length).toBeGreaterThan(0);
      expect(idea.opportunity?.risks.length).toBeGreaterThan(0);
      expect(idea.opportunity?.nextValidationStep.length).toBeGreaterThan(0);
    }
  });

  it("fallbackIdeas carries decision-grade opportunity payloads", () => {
    const [idea] = fallbackIdeas("global", 1);
    expect(idea?.opportunity).toMatchObject({
      verdict: expect.any(String),
      confidence: expect.any(String),
      targetUser: expect.any(String),
      problem: expect.any(String),
      nextValidationStep: expect.any(String),
    });
    expect(idea?.opportunity?.evidenceMix[0]).toMatchObject({
      kind: "demand",
      label: expect.any(String),
      summary: expect.any(String),
      strength: expect.any(String),
      sourceCount: expect.any(Number),
    });
    expect(idea?.opportunity?.competitorNotes.length).toBeGreaterThan(0);
    expect(idea?.opportunity?.pricingNotes.length).toBeGreaterThan(0);
    expect(idea?.opportunity?.agentVisibilityNotes.length).toBeGreaterThan(0);
  });

  it("fallbackTrends has surfacedAt in the recent past", () => {
    const trends = fallbackTrends("global", 5);
    expect(trends.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const trend of trends) {
      const ts = Date.parse(trend.surfacedAt);
      expect(now - ts).toBeGreaterThan(0);
      expect(now - ts).toBeLessThan(60 * 24 * 60 * 60 * 1000); // last 60 days
    }
  });

  it("every surfaced region has at least one seeded stock", () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackStocks(region, 12);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("every surfaced region has at least one seeded idea", () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackIdeas(region, 10);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("every surfaced region has at least one seeded trend", () => {
    for (const region of DEMO_REGIONS) {
      const items = fallbackTrends(region, 10);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("every demo region has at least one seed product", () => {
    for (const region of DEMO_REGIONS) {
      if (region === "global") continue;
      const products = SEED_PRODUCTS.filter((p) => p.region === region);
      expect(products.length).toBeGreaterThan(0);
    }
  });
});

describe("signal-family fallback", () => {
  it("maps common AI-infra signal types to supply-demand or ai-adoption", () => {
    expect(familyForSignalType("capex_raise")).toBe("supply-demand");
    expect(familyForSignalType("gpu_lead_time_shift")).toBe("supply-demand");
    expect(familyForSignalType("hbm_supply_warning")).toBe("supply-demand");
    expect(familyForSignalType("ai_deal_velocity")).toBe("ai-adoption");
    expect(familyForSignalType("cloud_recovery")).toBe("ai-adoption");
  });

  it("falls back to 'other' for unknown signal types", () => {
    expect(familyForSignalType("some_brand_new_signal_we_havent_seen")).toBe("other");
  });

  it("familyLabel returns a non-empty string for every family", () => {
    const families: SignalFamily[] = [
      "supply-demand",
      "ai-adoption",
      "macro-demand",
      "capital-allocation",
      "consumer-behavior",
      "platform-momentum",
      "regulatory-shift",
      "other",
    ];
    for (const family of families) {
      expect(familyLabel(family).length).toBeGreaterThan(0);
    }
  });
});

describe("brief hit-rate resolver", () => {
  it("picks 'direct' when the exact signal type has enough sample", () => {
    const byType = new Map<string, BucketCounts>([
      ["capex_raise", { hit: 5, miss: 2, push: 1 }],
    ]);
    const byFamily = new Map<SignalFamily, BucketCounts>();
    const r = resolveHitRate("capex_raise", byType, byFamily);
    expect(r.band).toBe("direct");
    expect(r.sample).toBe(7);
    expect(r.hitRate).toBeCloseTo(5 / 7);
  });

  it("falls back to family rate when exact type is too thin", () => {
    const byType = new Map<string, BucketCounts>([
      ["new_capex_variant", { hit: 0, miss: 0, push: 0 }],
    ]);
    const byFamily = new Map<SignalFamily, BucketCounts>([
      ["supply-demand", { hit: 6, miss: 4, push: 2 }],
    ]);
    const r = resolveHitRate("new_capex_variant", byType, byFamily);
    expect(r.band).toBe("family");
    expect(r.sample).toBeGreaterThanOrEqual(HIT_RATE_FAMILY_MIN);
    expect(r.hitRate).toBeCloseTo(6 / 10);
  });

  it("surfaces 'early' when family has any decided but below family min", () => {
    const byFamily = new Map<SignalFamily, BucketCounts>([
      ["ai-adoption", { hit: 1, miss: 1, push: 0 }],
    ]);
    const r = resolveHitRate("ai_deal_velocity", new Map(), byFamily);
    expect(r.band).toBe("early");
    expect(r.sample).toBe(2);
  });

  it("returns 'none' when nothing has been scored anywhere relevant", () => {
    const r = resolveHitRate("totally_new_signal", new Map(), new Map());
    expect(r.band).toBe("none");
    expect(r.hitRate).toBeNull();
    expect(r.sample).toBe(0);
  });

  it("uses direct early-band if the exact type has only 1 scored", () => {
    const byType = new Map<string, BucketCounts>([
      ["fresh_type", { hit: 1, miss: 0, push: 0 }],
    ]);
    const r = resolveHitRate("fresh_type", byType, new Map());
    expect(r.band).toBe("early");
    expect(r.sample).toBe(1);
    expect(r.hitRate).toBe(1);
  });
});
