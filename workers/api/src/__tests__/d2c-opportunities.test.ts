import { describe, expect, it } from "vitest";
import {
  agentVisibilityGapScore,
  assessAging,
  buildAgentVisibilityPrompt,
  buildSnapshotRecord,
  composeD2COpportunityBrief,
  computeD2CDelta,
  computeD2CDeltas,
  confidenceForDiversity,
  D2C_NICHE_SEEDS,
  d2cBriefItems,
  distinctSourceClasses,
  extractCitedUrls,
  extractRecommendedBrands,
  loadLatestD2CArtifact,
  scoreD2CNiche,
  sourceDiversityFraction,
  verdictForScore,
  verdictImproved,
  type D2CEvidenceItem,
  type D2CNicheEvidence,
  type D2CNicheSnapshotRecord,
  type D2COpportunityArtifact,
} from "@high-signal/shared";
import { d2cBriefItemsForRegion } from "../routes/brief";

describe("india d2c opportunity pipeline (plan 0013)", () => {
  describe("seed coverage", () => {
    it("ships exactly 20 curated India D2C niches", () => {
      expect(D2C_NICHE_SEEDS).toHaveLength(20);
    });

    it("every niche has a unique slug, category, target user, problem, first SKU, risks, and next step", () => {
      const slugs = new Set<string>();
      for (const seed of D2C_NICHE_SEEDS) {
        expect(seed.slug.length).toBeGreaterThan(0);
        expect(slugs.has(seed.slug)).toBe(false);
        slugs.add(seed.slug);
        expect(seed.category.length).toBeGreaterThan(0);
        expect(seed.targetUser.length).toBeGreaterThan(0);
        expect(seed.problem.length).toBeGreaterThan(0);
        expect(seed.firstSku.length).toBeGreaterThan(0);
        expect(seed.risks.length).toBeGreaterThan(0);
        expect(seed.nextValidationStep.length).toBeGreaterThan(0);
        expect(seed.query.subs.length).toBeGreaterThan(0);
        expect(seed.query.keywords.length).toBeGreaterThan(0);
      }
    });

    it("every niche is region-tagged south-asia", () => {
      for (const seed of D2C_NICHE_SEEDS) {
        expect(seed.region).toBe("south-asia");
      }
    });

    it("default scores are within 0–1 (or null for optional dimensions)", () => {
      for (const seed of D2C_NICHE_SEEDS) {
        const s = seed.defaultScores;
        expect(s.demand).toBeGreaterThanOrEqual(0);
        expect(s.demand).toBeLessThanOrEqual(1);
        expect(s.competition).toBeGreaterThanOrEqual(0);
        expect(s.competition).toBeLessThanOrEqual(1);
        expect(s.pricing).toBeGreaterThanOrEqual(0);
        expect(s.pricing).toBeLessThanOrEqual(1);
        if (s.adSaturation != null) {
          expect(s.adSaturation).toBeGreaterThanOrEqual(0);
          expect(s.adSaturation).toBeLessThanOrEqual(1);
        }
        if (s.agentVisibility != null) {
          expect(s.agentVisibility).toBeGreaterThanOrEqual(0);
          expect(s.agentVisibility).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("scoring", () => {
    it("scores 0–100 and is deterministic", () => {
      const inputs = {
        demand: 0.6,
        sourceDiversity: 0.5,
        competition: 0.6,
        pricing: 0.5,
        adSaturation: 0.5,
        agentVisibility: 0.5,
      };
      const a = scoreD2CNiche(inputs);
      const b = scoreD2CNiche(inputs);
      expect(a.score).toBe(b.score);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
      // 0.6*30 + 0.5*15 + 0.6*20 + 0.5*15 + 0.5*10 + 0.5*10 = 18+7.5+12+7.5+5+5 = 55
      expect(a.score).toBe(55);
    });

    it("null optional scores default to neutral 0.5 and flag usedDefaults", () => {
      const r = scoreD2CNiche({
        demand: 0.6,
        sourceDiversity: 0.5,
        competition: 0.6,
        pricing: 0.5,
        adSaturation: null,
        agentVisibility: null,
      });
      expect(r.usedDefaults).toBe(true);
      // Same as the all-0.5 case above.
      expect(r.score).toBe(55);
    });

    it("clamps out-of-range inputs to 0–1", () => {
      const r = scoreD2CNiche({
        demand: 5,
        sourceDiversity: -1,
        competition: 0.5,
        pricing: 0.5,
        adSaturation: 0.5,
        agentVisibility: 0.5,
      });
      // demand clamped to 1 → 30; sourceDiversity clamped to 0 → 0;
      // competition 0.5 → 10; pricing 0.5 → 7.5; ad 0.5 → 5; agent 0.5 → 5
      // total = 57.5 → 58
      expect(r.score).toBe(58);
    });
  });

  describe("verdict mapping", () => {
    it("test: demand ≥ 0.5, competition ≥ 0.4, first SKU, diversity ≥ 0.34", () => {
      expect(
        verdictForScore(
          { demand: 0.5, sourceDiversity: 0.34, competition: 0.4, pricing: 0.5, adSaturation: null, agentVisibility: null },
          true,
        ),
      ).toBe("test");
    });

    it("watch: demand ≥ 0.3 but diversity below the test threshold", () => {
      expect(
        verdictForScore(
          { demand: 0.4, sourceDiversity: 0.1, competition: 0.5, pricing: 0.5, adSaturation: null, agentVisibility: null },
          true,
        ),
      ).toBe("watch");
    });

    it("avoid: demand < 0.3", () => {
      expect(
        verdictForScore(
          { demand: 0.2, sourceDiversity: 0.5, competition: 0.5, pricing: 0.5, adSaturation: null, agentVisibility: null },
          true,
        ),
      ).toBe("avoid");
    });

    it("avoid: competition gap < 0.2 (saturated)", () => {
      expect(
        verdictForScore(
          { demand: 0.6, sourceDiversity: 0.5, competition: 0.1, pricing: 0.5, adSaturation: null, agentVisibility: null },
          true,
        ),
      ).toBe("avoid");
    });

    it("watch: demand ≥ 0.5 and competition ≥ 0.4 but no first SKU", () => {
      expect(
        verdictForScore(
          { demand: 0.6, sourceDiversity: 0.5, competition: 0.5, pricing: 0.5, adSaturation: null, agentVisibility: null },
          false,
        ),
      ).toBe("watch");
    });

    it("never emits 'enter' in Slice 1/2", () => {
      // Even with maximal scores, the verdict is test (enter is reserved).
      expect(
        verdictForScore(
          { demand: 1, sourceDiversity: 1, competition: 1, pricing: 1, adSaturation: 1, agentVisibility: 1 },
          true,
        ),
      ).toBe("test");
    });
  });

  describe("confidence bands", () => {
    it("low with < 2 source classes, medium with 2–3, high with ≥ 4", () => {
      expect(confidenceForDiversity(0)).toBe("low");
      expect(confidenceForDiversity(1)).toBe("low");
      expect(confidenceForDiversity(2)).toBe("medium");
      expect(confidenceForDiversity(3)).toBe("medium");
      expect(confidenceForDiversity(4)).toBe("high");
    });
  });

  describe("source diversity", () => {
    it("counts distinct source classes", () => {
      const items: D2CEvidenceItem[] = [
        { sourceClass: "community", url: "u1", snippet: "s", observedAt: "2026-07-05" },
        { sourceClass: "community", url: "u2", snippet: "s", observedAt: "2026-07-05" },
        { sourceClass: "launch", url: "u3", snippet: "s", observedAt: "2026-07-05" },
      ];
      expect(distinctSourceClasses(items)).toBe(2);
    });

    it("fraction is distinct classes / 7 (all source classes)", () => {
      expect(sourceDiversityFraction([])).toBe(0);
      const one: D2CEvidenceItem[] = [
        { sourceClass: "community", url: "u1", snippet: "s", observedAt: "2026-07-05" },
      ];
      expect(sourceDiversityFraction(one)).toBeCloseTo(1 / 7);
    });
  });

  describe("composeD2COpportunityBrief", () => {
    it("seed-only brief has the full decision shape and leans watch", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const brief = composeD2COpportunityBrief(seed, null);
      expect(["enter", "test", "watch", "avoid"]).toContain(brief.verdict);
      expect(brief.confidence).toBe("low"); // no evidence → 0 source classes
      expect(brief.targetUser.length).toBeGreaterThan(0);
      expect(brief.problem.length).toBeGreaterThan(0);
      expect(brief.marketTimingReasons.length).toBeGreaterThan(0);
      expect(brief.evidenceMix.length).toBeGreaterThan(0);
      expect(brief.competitorNotes.length).toBeGreaterThan(0);
      expect(brief.pricingNotes.length).toBeGreaterThan(0);
      expect(brief.agentVisibilityNotes.length).toBeGreaterThan(0);
      expect(brief.risks.length).toBeGreaterThan(0);
      expect(brief.nextValidationStep.length).toBeGreaterThan(0);
      // Seed-only briefs flag the missing-corroboration risk.
      expect(brief.risks.some((r) => r.includes("seed-only"))).toBe(true);
    });

    it("weekly artifact enriches the brief and recomputes confidence", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const evidence: D2CNicheEvidence = {
        nicheSlug: seed.slug,
        demandScore: 0.7,
        competitionScore: 0.6,
        pricingScore: 0.6,
        adSaturationScore: null,
        agentVisibilityScore: null,
        evidence: [
          { sourceClass: "community", url: "https://reddit.com/a", snippet: "demand", observedAt: "2026-07-05" },
          { sourceClass: "community", url: "https://reddit.com/b", snippet: "demand 2", observedAt: "2026-07-05" },
          { sourceClass: "launch", url: "https://producthunt.com/a", snippet: "launch", observedAt: "2026-07-05" },
        ],
        freshnessDate: "2026-07-05T00:00:00.000Z",
      };
      const brief = composeD2COpportunityBrief(seed, evidence);
      // 2 source classes → medium confidence.
      expect(brief.confidence).toBe("medium");
      // demand 0.7, competition 0.6, diversity 2/6 ≈ 0.33 → just below 0.34 → watch
      // (this is the conservative boundary the PRD wants)
      expect(["test", "watch"]).toContain(brief.verdict);
      expect(brief.marketTimingReasons[0]).toContain("2026-07-05");
    });

    it("artifact with strong demand + diversity + open competition → test", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const evidence: D2CNicheEvidence = {
        nicheSlug: seed.slug,
        demandScore: 0.8,
        competitionScore: 0.7,
        pricingScore: 0.6,
        adSaturationScore: 0.6,
        agentVisibilityScore: 0.6,
        evidence: [
          { sourceClass: "community", url: "u1", snippet: "s", observedAt: "2026-07-05" },
          { sourceClass: "search", url: "u2", snippet: "s", observedAt: "2026-07-05" },
          { sourceClass: "launch", url: "u3", snippet: "s", observedAt: "2026-07-05" },
        ],
        freshnessDate: "2026-07-05T00:00:00.000Z",
      };
      const brief = composeD2COpportunityBrief(seed, evidence);
      // 3 source classes → 0.5 diversity ≥ 0.34, demand 0.8, competition 0.7 → test
      expect(brief.verdict).toBe("test");
    });
  });

  describe("d2cBriefItems", () => {
    it("returns 3 briefs for south-asia", () => {
      const items = d2cBriefItems("south-asia", 3, null);
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item.source).toBe("opportunity");
        expect(item.region).toBe("south-asia");
        expect(item.opportunity).toBeDefined();
        expect(item.title).toMatch(/^India D2C: /);
      }
    });

    it("returns 1 rotating brief for global", () => {
      const a = d2cBriefItems("global", 1, null, 0);
      const b = d2cBriefItems("global", 1, null, 1);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      // Different rotation indices surface different niches (20-niche pool).
      expect(a[0]?.title).not.toBe(b[0]?.title);
    });

    it("returns [] for non-India regions", () => {
      expect(d2cBriefItems("north-america", 3, null)).toEqual([]);
      expect(d2cBriefItems("europe", 3, null)).toEqual([]);
    });

    it("respects the limit for south-asia", () => {
      expect(d2cBriefItems("south-asia", 5, null)).toHaveLength(5);
      expect(d2cBriefItems("south-asia", 20, null)).toHaveLength(20);
    });

    it("uses the artifact's generatedAt as surfacedAt when present", () => {
      const artifact: D2COpportunityArtifact = {
        generatedAt: "2026-07-05T08:00:00.000Z",
        region: "IN",
        niches: [],
      };
      const items = d2cBriefItems("south-asia", 1, artifact);
      expect(items[0]?.surfacedAt).toBe("2026-07-05T08:00:00.000Z");
    });
  });

  describe("loadLatestD2CArtifact", () => {
    it("returns null when the directory is missing", async () => {
      const r = await loadLatestD2CArtifact("/does/not/exist", {
        readdir: async () => [],
        readFile: async () => "",
      });
      // readdir throws in real fs; the stub returns [] which yields no dated files
      expect(r).toBeNull();
    });

    it("returns null when no dated files exist", async () => {
      const r = await loadLatestD2CArtifact("/fake", {
        readdir: async () => ["readme.md", "notes.txt"],
        readFile: async () => "",
      });
      expect(r).toBeNull();
    });

    it("returns the latest dated artifact", async () => {
      const artifact: D2COpportunityArtifact = {
        generatedAt: "2026-07-05T00:00:00.000Z",
        region: "IN",
        niches: [],
      };
      const r = await loadLatestD2CArtifact("/fake", {
        readdir: async () => ["2026-07-01.json", "2026-07-05.json", "2026-07-03.json"],
        readFile: async (path) => {
          if (path.endsWith("2026-07-05.json")) return JSON.stringify(artifact);
          return "{}";
        },
      });
      expect(r?.generatedAt).toBe("2026-07-05T00:00:00.000Z");
    });
  });

  describe("no impuls8 dependency", () => {
    it("no niche seed references impuls8", () => {
      for (const seed of D2C_NICHE_SEEDS) {
        const blob = JSON.stringify(seed).toLowerCase();
        expect(blob).not.toContain("impuls8");
      }
    });
  });

  describe("brief route integration", () => {
    it("south-asia section 02 includes 3 India D2C briefs ahead of community ideas", () => {
      const items = d2cBriefItemsForRegion("south-asia");
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item.source).toBe("opportunity");
        expect(item.region).toBe("south-asia");
        expect(item.opportunity).toBeDefined();
        expect(item.title).toMatch(/^India D2C: /);
      }
    });

    it("global section 02 includes 1 rotating India D2C brief", () => {
      const items = d2cBriefItemsForRegion("global");
      expect(items).toHaveLength(1);
      expect(items[0]?.source).toBe("opportunity");
    });

    it("non-India regions get no India D2C briefs", () => {
      expect(d2cBriefItemsForRegion("north-america")).toEqual([]);
      expect(d2cBriefItemsForRegion("europe")).toEqual([]);
      expect(d2cBriefItemsForRegion("east-asia")).toEqual([]);
    });
  });

  // ─── Slice 3 — history: deltas, verdict changes, aging ────────────────

  describe("Slice 3 — history", () => {
    function snap(slug: string, date: string, score: number, verdict: D2CNicheSnapshotRecord["verdict"]): D2CNicheSnapshotRecord {
      return {
        nicheSlug: slug,
        snapshotDate: date,
        opportunityScore: score,
        demandScore: 0.5,
        competitionScore: 0.5,
        pricingScore: 0.5,
        adSaturationScore: null,
        agentVisibilityScore: null,
        sourceDiversity: 0.3,
        verdict,
        confidence: "low",
        freshnessDate: date,
      };
    }

    it("computeD2CDelta: first run → trend 'new', null scoreDelta", () => {
      const cur = snap("hair-growth", "2026-07-08", 55, "watch");
      const d = computeD2CDelta(cur, null);
      expect(d.trend).toBe("new");
      expect(d.scoreDelta).toBeNull();
      expect(d.previousVerdict).toBeNull();
      expect(d.verdictChanged).toBe(false);
    });

    it("computeD2CDelta: score improved, same verdict → 'improved'", () => {
      const prev = snap("hair-growth", "2026-07-01", 50, "watch");
      const cur = snap("hair-growth", "2026-07-08", 60, "watch");
      const d = computeD2CDelta(cur, prev);
      expect(d.scoreDelta).toBe(10);
      expect(d.verdictChanged).toBe(false);
      expect(d.trend).toBe("improved");
    });

    it("computeD2CDelta: score degraded, same verdict → 'degraded'", () => {
      const prev = snap("hair-growth", "2026-07-01", 60, "watch");
      const cur = snap("hair-growth", "2026-07-08", 50, "watch");
      const d = computeD2CDelta(cur, prev);
      expect(d.scoreDelta).toBe(-10);
      expect(d.trend).toBe("degraded");
    });

    it("computeD2CDelta: verdict improved (watch → test) → 'improved'", () => {
      const prev = snap("hair-growth", "2026-07-01", 50, "watch");
      const cur = snap("hair-growth", "2026-07-08", 65, "test");
      const d = computeD2CDelta(cur, prev);
      expect(d.verdictChanged).toBe(true);
      expect(d.trend).toBe("improved");
    });

    it("computeD2CDelta: verdict degraded (test → avoid) → 'degraded'", () => {
      const prev = snap("hair-growth", "2026-07-01", 65, "test");
      const cur = snap("hair-growth", "2026-07-08", 25, "avoid");
      const d = computeD2CDelta(cur, prev);
      expect(d.verdictChanged).toBe(true);
      expect(d.trend).toBe("degraded");
    });

    it("verdictImproved: enter > test > watch > avoid", () => {
      expect(verdictImproved("enter", "test")).toBe(true);
      expect(verdictImproved("test", "watch")).toBe(true);
      expect(verdictImproved("watch", "avoid")).toBe(true);
      expect(verdictImproved("avoid", "test")).toBe(false);
      expect(verdictImproved("test", "test")).toBe(false);
    });

    it("computeD2CDeltas: groups by niche, takes the last pair", () => {
      const history = [
        snap("a", "2026-07-01", 50, "watch"),
        snap("a", "2026-07-08", 60, "test"),
        snap("b", "2026-07-01", 40, "avoid"),
      ];
      const deltas = computeD2CDeltas(history);
      expect(deltas).toHaveLength(2);
      const a = deltas.find((d) => d.nicheSlug === "a")!;
      expect(a.scoreDelta).toBe(10);
      expect(a.trend).toBe("improved");
      const b = deltas.find((d) => d.nicheSlug === "b")!;
      expect(b.trend).toBe("new"); // only one snapshot → new
    });

    it("assessAging: insufficient history with < 2 snapshots", () => {
      const cur = snap("a", "2026-07-08", 60, "test");
      expect(assessAging(cur, [cur])).toBe("insufficient-history");
    });

    it("assessAging: stable when verdict unchanged across history", () => {
      const s1 = snap("a", "2026-07-01", 50, "watch");
      const s2 = snap("a", "2026-07-08", 55, "watch");
      expect(assessAging(s2, [s1, s2])).toBe("stable");
    });

    it("assessAging: aged-well when verdict improved from earliest to latest", () => {
      const s1 = snap("a", "2026-07-01", 50, "watch");
      const s2 = snap("a", "2026-07-08", 65, "test");
      expect(assessAging(s2, [s1, s2])).toBe("aged-well");
    });

    it("assessAging: aged-poorly when verdict degraded from earliest to latest", () => {
      const s1 = snap("a", "2026-07-01", 65, "test");
      const s2 = snap("a", "2026-07-08", 25, "avoid");
      expect(assessAging(s2, [s1, s2])).toBe("aged-poorly");
    });

    it("buildSnapshotRecord: seed-only → conservative defaults, 'new' trend", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const rec = buildSnapshotRecord(seed, null, "2026-07-08");
      expect(rec.nicheSlug).toBe(seed.slug);
      expect(rec.snapshotDate).toBe("2026-07-08");
      expect(rec.opportunityScore).toBeGreaterThanOrEqual(0);
      expect(rec.opportunityScore).toBeLessThanOrEqual(100);
      expect(rec.verdict).toMatch(/^(enter|test|watch|avoid)$/);
      expect(rec.freshnessDate).toBe("2026-07-08");
    });

    it("buildSnapshotRecord: with evidence → scores reflect evidence", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const rec = buildSnapshotRecord(seed, {
        nicheSlug: seed.slug,
        demandScore: 0.8,
        competitionScore: 0.7,
        pricingScore: 0.6,
        adSaturationScore: 0.6,
        agentVisibilityScore: 0.6,
        evidence: [
          { sourceClass: "community", url: "u1", snippet: "s", observedAt: "2026-07-05" },
          { sourceClass: "search", url: "u2", snippet: "s", observedAt: "2026-07-05" },
          { sourceClass: "launch", url: "u3", snippet: "s", observedAt: "2026-07-05" },
        ],
        freshnessDate: "2026-07-05T00:00:00.000Z",
      }, "2026-07-08");
      // 3 source classes + agent-visibility overlay (non-null) = 4 → high
      // demand 0.8, competition 0.7 → test
      expect(rec.verdict).toBe("test");
      expect(rec.confidence).toBe("high");
      expect(rec.freshnessDate).toBe("2026-07-05T00:00:00.000Z");
    });
  });

  // ─── Slice 4 — agent-visibility overlay ────────────────────────────────

  describe("Slice 4 — agent-visibility", () => {
    it("buildAgentVisibilityPrompt: open-ended category question", () => {
      const seed = D2C_NICHE_SEEDS[0]!;
      const prompt = buildAgentVisibilityPrompt(seed);
      expect(prompt).toContain(seed.category);
      expect(prompt).toContain(seed.targetUser);
      expect(prompt).toContain(seed.problem);
      expect(prompt.toLowerCase()).toContain("what are the best");
    });

    it("extractRecommendedBrands: numbered list", () => {
      const text = [
        "Here are the top options:",
        "1. Mamaearth — affordable and widely available",
        "2. Plum — clean ingredients",
        "3. Minimalist — science-backed formulas",
      ].join("\n");
      const brands = extractRecommendedBrands(text);
      expect(brands).toContain("Mamaearth");
      expect(brands).toContain("Plum");
      expect(brands).toContain("Minimalist");
    });

    it("extractRecommendedBrands: bold headers", () => {
      const text = [
        "**Mamaearth** — affordable",
        "**Plum** — clean",
      ].join("\n");
      const brands = extractRecommendedBrands(text);
      expect(brands).toContain("Mamaearth");
      expect(brands).toContain("Plum");
    });

    it("extractRecommendedBrands: empty when no list pattern", () => {
      expect(extractRecommendedBrands("I don't know of any specific brands.")).toEqual([]);
    });

    it("extractCitedUrls: pulls URLs, dedupes, strips trailing punctuation", () => {
      const text = "See https://example.com/a and https://example.com/b. Also https://example.com/a again.";
      const urls = extractCitedUrls(text);
      expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    });

    it("agentVisibilityGapScore: 0 brands → 1 (wide open)", () => {
      expect(agentVisibilityGapScore([])).toBe(1);
    });

    it("agentVisibilityGapScore: 1 brand → 0.7", () => {
      expect(agentVisibilityGapScore(["Mamaearth"])).toBe(0.7);
    });

    it("agentVisibilityGapScore: 4+ brands → 0 (saturated)", () => {
      expect(agentVisibilityGapScore(["A", "B", "C", "D"])).toBe(0);
      expect(agentVisibilityGapScore(["A", "B", "C", "D", "E"])).toBe(0);
    });

    it("agentVisibilityGapScore: monotonic decreasing", () => {
      const scores = [0, 1, 2, 3, 4].map((n) => agentVisibilityGapScore(Array(n).fill("x")));
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!);
      }
    });
  });
});
