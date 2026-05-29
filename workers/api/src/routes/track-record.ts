import { Hono } from "hono";

type Env = { DB: D1Database };

type Outcome = "hit" | "miss" | "push" | "pending";
type Cohort = "all" | "live" | "backfill";
type ActionBand = "compound" | "usable" | "watch" | "retire";
type RecommendedAction = "promote" | "keep-testing" | "tighten-thesis" | "retire-or-rewrite";

interface WorkbenchRow {
  id: string;
  slug: string;
  title: string | null;
  signalType: string;
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  publishedAt: number;
  evidenceCount: number;
  outcome: Outcome;
  forwardReturn: number | null;
  windowDays: number;
  isBackfill: number;
}

export interface WorkbenchExample extends WorkbenchRow {
  actionScore: number | null;
  actionBand: ActionBand | "pending";
}

export interface WorkbenchBucket {
  signalType: string;
  count: number;
  matured: number;
  pending: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number | null;
  avgActionScore: number | null;
  evidenceReadyRate: number;
  recommendedAction: RecommendedAction;
  examples: WorkbenchExample[];
}

export const trackRecordRoute = new Hono<{ Bindings: Env }>();

function cohortFilter(cohort: Cohort): string {
  if (cohort === "live") return "AND s.slug NOT LIKE 'bf-%'";
  if (cohort === "backfill") return "AND s.slug LIKE 'bf-%'";
  return "";
}

trackRecordRoute.get("/", async (c) => {
  const cohort = (c.req.query("cohort") ?? "all") as Cohort;
  const filter = cohortFilter(cohort);
  const rows = (await c.env.DB.prepare(
    `SELECT s.signal_type as signalType,
            s.confidence,
            sr.outcome,
            sr.window_days as windowDays,
            sr.forward_return as forwardReturn,
            CASE WHEN s.slug LIKE 'bf-%' THEN 1 ELSE 0 END as is_backfill
     FROM score_runs sr
     JOIN signals s ON s.id = sr.signal_id
     WHERE 1=1 ${filter}`,
  ).all()) as {
    results: Array<{
      signalType: string;
      confidence: string;
      outcome: Outcome;
      windowDays: number;
      forwardReturn: number | null;
      is_backfill: number;
    }>;
  };

  const buckets = new Map<
    string,
    { hit: number; miss: number; push: number; pending: number; total: number }
  >();
  for (const r of rows.results ?? []) {
    const b = buckets.get(r.signalType) ?? { hit: 0, miss: 0, push: 0, pending: 0, total: 0 };
    b[r.outcome] += 1;
    b.total += 1;
    buckets.set(r.signalType, b);
  }

  const out = Array.from(buckets.entries()).map(([signalType, b]) => ({
    signalType,
    ...b,
    hitRate: b.hit + b.miss > 0 ? b.hit / (b.hit + b.miss) : null,
  }));

  return c.json({ cohort, buckets: out });
});

trackRecordRoute.get("/cohorts", async (c) => {
  // Return all three at once for the web split UI to render in one round-trip
  const baseQuery = `SELECT s.signal_type as signalType,
                            sr.outcome,
                            sr.window_days as windowDays,
                            CASE WHEN s.slug LIKE 'bf-%'
                              THEN 'backfill'
                              ELSE 'live'
                            END as cohort
                     FROM score_runs sr
                     JOIN signals s ON s.id = sr.signal_id`;
  const rows = (await c.env.DB.prepare(baseQuery).all()) as {
    results: Array<{
      signalType: string;
      outcome: Outcome;
      windowDays: number;
      cohort: "live" | "backfill";
    }>;
  };

  const acc: Record<
    "live" | "backfill" | "all",
    Map<string, { hit: number; miss: number; push: number; pending: number; total: number }>
  > = {
    live: new Map(),
    backfill: new Map(),
    all: new Map(),
  };
  for (const r of rows.results ?? []) {
    for (const k of [r.cohort, "all" as const]) {
      const m = acc[k];
      const b = m.get(r.signalType) ?? { hit: 0, miss: 0, push: 0, pending: 0, total: 0 };
      b[r.outcome] += 1;
      b.total += 1;
      m.set(r.signalType, b);
    }
  }
  const toBuckets = (m: typeof acc.live) =>
    Array.from(m.entries()).map(([signalType, b]) => ({
      signalType,
      ...b,
      hitRate: b.hit + b.miss > 0 ? b.hit / (b.hit + b.miss) : null,
    }));
  return c.json({
    live: toBuckets(acc.live),
    backfill: toBuckets(acc.backfill),
    all: toBuckets(acc.all),
  });
});

trackRecordRoute.get("/series", async (c) => {
  const cohort = (c.req.query("cohort") ?? "all") as Cohort;
  const filter = cohortFilter(cohort);
  const rows = (await c.env.DB.prepare(
    `SELECT date(sr.run_at, 'unixepoch') as d, sr.outcome, count(*) as n
     FROM score_runs sr JOIN signals s ON s.id = sr.signal_id
     WHERE sr.outcome != 'pending' ${filter}
     GROUP BY d, sr.outcome ORDER BY d`,
  ).all()) as { results: Array<{ d: string; outcome: string; n: number }> };
  return c.json({ cohort, series: rows.results ?? [] });
});

trackRecordRoute.get("/workbench", async (c) => {
  const cohort = (c.req.query("cohort") ?? "live") as Cohort;
  const filter = cohortFilter(cohort);
  const rows = (await c.env.DB.prepare(
    `SELECT s.id,
            s.slug,
            nullif(
              trim(
                replace(
                  substr(s.body_md, 1, instr(s.body_md || char(10), char(10)) - 1),
                  '#',
                  ''
                )
              ),
              ''
            ) as title,
            s.signal_type as signalType,
            s.direction,
            s.confidence,
            s.predicted_window_days as predictedWindowDays,
            s.published_at as publishedAt,
            json_array_length(s.evidence_urls) as evidenceCount,
            sr.outcome,
            sr.forward_return as forwardReturn,
            sr.window_days as windowDays,
            CASE WHEN s.slug LIKE 'bf-%' THEN 1 ELSE 0 END as isBackfill
     FROM score_runs sr
     JOIN signals s ON s.id = sr.signal_id
     WHERE 1=1 ${filter}
     ORDER BY sr.run_at DESC, s.published_at DESC
     LIMIT 500`,
  ).all()) as { results: WorkbenchRow[] };

  return c.json({ cohort, ...buildActionWorkbench(rows.results ?? []) });
});

export function actionQualityScore(row: WorkbenchRow): number | null {
  if (row.outcome === "pending") return null;

  let score = row.outcome === "hit" ? 50 : row.outcome === "push" ? 28 : 8;
  score += row.evidenceCount >= 2 ? 18 : 6;
  score += row.direction === "neutral" ? 0 : 8;
  score += row.predictedWindowDays <= 14 ? 8 : row.predictedWindowDays <= 45 ? 5 : 1;

  if (row.confidence === "high") {
    score += row.outcome === "hit" ? 14 : row.outcome === "miss" ? -16 : 4;
  }
  if (row.confidence === "medium") {
    score += row.outcome === "hit" ? 9 : row.outcome === "miss" ? -6 : 3;
  }
  if (row.confidence === "low") score += row.outcome === "miss" ? 5 : 0;

  const magnitude = Math.abs(row.forwardReturn ?? 0);
  if (row.outcome === "hit" && magnitude >= 0.05) score += 4;
  if (row.outcome === "miss" && magnitude >= 0.05) score -= 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function actionBand(score: number | null): ActionBand | "pending" {
  if (score == null) return "pending";
  if (score >= 75) return "compound";
  if (score >= 55) return "usable";
  if (score >= 35) return "watch";
  return "retire";
}

function recommendedAction(bucket: {
  matured: number;
  hitRate: number | null;
  avgActionScore: number | null;
}): RecommendedAction {
  if (bucket.matured < 3) return "keep-testing";
  if ((bucket.avgActionScore ?? 0) >= 70 && (bucket.hitRate ?? 0) >= 0.55) return "promote";
  if ((bucket.avgActionScore ?? 0) >= 52) return "keep-testing";
  if ((bucket.avgActionScore ?? 0) >= 35) return "tighten-thesis";
  return "retire-or-rewrite";
}

export function buildActionWorkbench(rows: WorkbenchRow[]): {
  summary: {
    signals: number;
    matured: number;
    pending: number;
    avgActionScore: number | null;
    evidenceReadyRate: number;
    promoteTypes: number;
    rewriteTypes: number;
  };
  buckets: WorkbenchBucket[];
  examples: WorkbenchExample[];
} {
  const examples = rows.map((row) => {
    const actionScore = actionQualityScore(row);
    return { ...row, actionScore, actionBand: actionBand(actionScore) };
  });

  const grouped = new Map<string, WorkbenchExample[]>();
  for (const row of examples) {
    const group = grouped.get(row.signalType) ?? [];
    group.push(row);
    grouped.set(row.signalType, group);
  }

  const buckets = Array.from(grouped.entries()).map(([signalType, group]) => {
    const maturedRows = group.filter((row) => row.outcome !== "pending");
    const hits = group.filter((row) => row.outcome === "hit").length;
    const misses = group.filter((row) => row.outcome === "miss").length;
    const pushes = group.filter((row) => row.outcome === "push").length;
    const pending = group.filter((row) => row.outcome === "pending").length;
    const scores = maturedRows
      .map((row) => row.actionScore)
      .filter((score): score is number => score != null);
    const avgActionScore =
      scores.length > 0
        ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
        : null;
    const hitRate = hits + misses > 0 ? hits / (hits + misses) : null;
    const evidenceReadyRate =
      group.length > 0 ? group.filter((row) => row.evidenceCount >= 2).length / group.length : 0;
    const bucket = {
      signalType,
      count: group.length,
      matured: maturedRows.length,
      pending,
      hits,
      misses,
      pushes,
      hitRate,
      avgActionScore,
      evidenceReadyRate,
      recommendedAction: "keep-testing" as RecommendedAction,
      examples: group
        .slice()
        .sort((a, b) => (b.actionScore ?? -1) - (a.actionScore ?? -1))
        .slice(0, 3),
    };
    return { ...bucket, recommendedAction: recommendedAction(bucket) };
  });

  buckets.sort((a, b) => (b.avgActionScore ?? -1) - (a.avgActionScore ?? -1));

  const scored = examples.filter((row) => row.actionScore != null);
  const avgActionScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, row) => sum + (row.actionScore ?? 0), 0) / scored.length)
      : null;

  return {
    summary: {
      signals: rows.length,
      matured: scored.length,
      pending: examples.length - scored.length,
      avgActionScore,
      evidenceReadyRate:
        examples.length > 0
          ? examples.filter((row) => row.evidenceCount >= 2).length / examples.length
          : 0,
      promoteTypes: buckets.filter((bucket) => bucket.recommendedAction === "promote").length,
      rewriteTypes: buckets.filter((bucket) => bucket.recommendedAction === "retire-or-rewrite")
        .length,
    },
    buckets,
    examples: examples
      .slice()
      .sort((a, b) => (b.actionScore ?? -1) - (a.actionScore ?? -1))
      .slice(0, 12),
  };
}

// ─── /track-record/labels ─────────────────────────────────────────────────
// Backtest-based hit-rate ledger for the breakout/divergence labels on
// /convergence. The numbers are regenerated by
//   uv run --project python/ingest python scripts/backtest-convergence-labels.py
// and committed as workers/api/src/lib/label-backtest.json — this route
// just exposes that bundled JSON. Cite-or-kill principle: every label in
// the UI should be able to point at this surface for its track record.

import labelBacktest from "../lib/label-backtest.json";

trackRecordRoute.get("/labels", (c) => c.json(labelBacktest));

export default trackRecordRoute;
