/**
 * Cross-source convergence — entities hit by ≥N distinct sources in a rolling
 * window. Strongest pre-news pattern in the system: when news + Reddit + EDGAR
 * + IR fire on the same entity within hours, the signal is real.
 *
 * Pure SQL aggregation against the `events` table; no new ingest needed.
 */

import { Hono } from "hono";
import seedEntities from "../lib/seed-entities.json";
import {
  articleFromWikiUrl,
  buildPageviewsUrl,
  summarize,
  type AttentionResult,
} from "./attention";

type Env = { DB: D1Database };

// Bundled name + wiki_url lookup (~275 entities). Used to overlay Wikipedia
// Pageviews on convergence rows without re-querying D1 for the metadata.
const SEED_WIKI_BY_ID = new Map<string, { wiki_url: string | null }>();
for (const e of seedEntities as Array<{ id: string; wiki_url: string | null }>) {
  if (e.id && e.wiki_url) SEED_WIKI_BY_ID.set(e.id, { wiki_url: e.wiki_url });
}

const ATTENTION_USER_AGENT =
  "high-signal-convergence/0.1 " +
  "(+https://github.com/sarthakagrawal927/high-signal; " +
  "contact: sarthak@vaultwealth.com)";

async function fetchAttention(article: string, days = 30): Promise<AttentionResult | null> {
  try {
    const r = await fetch(buildPageviewsUrl(article, days), {
      headers: { "User-Agent": ATTENTION_USER_AGENT, Accept: "application/json" },
      cf: { cacheTtl: 1800, cacheEverything: true } as RequestInitCfProperties,
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { items?: Array<{ timestamp: string; views: number }> };
    return summarize(article, days, body.items ?? []);
  } catch {
    return null;
  }
}

interface ConvergenceRow {
  primary_entity_id: string | null;
  entity_name: string | null;
  entity_ticker: string | null;
  entity_sector: string | null;
  source_count: number;
  event_count: number;
  sources: string;            // comma-separated distinct sources
  latest_at: number;          // unix seconds
  earliest_at: number;        // unix seconds
  first_seen_ever: number | null;  // earliest event for this entity, all-time
}

interface RecentEvent {
  primary_entity_id: string;
  source: string;
  title: string | null;
  source_url: string;
  published_at: number;
}

interface MarketVelocityRow {
  entity_id: string;
  source: string;
  market_id: string;
  question: string;
  prob_now: number;
  fetched_at_now: number;
  prob_prior: number | null;
  fetched_at_prior: number | null;
  market_url: string;
}

export const convergenceRoute = new Hono<{ Bindings: Env }>();

convergenceRoute.get("/", async (c) => {
  // Bound inputs
  const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24), 1), 24 * 30);
  const minSources = Math.min(Math.max(Number(c.req.query("min_sources") ?? 3), 2), 10);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  // Top entities by distinct-source count in the window.
  // `first_seen_ever` = entity's earliest event across all time (correlated
  // subquery), so the UI can distinguish "brand new convergence" from
  // "recurring chatter on a known name."
  const summary = (await c.env.DB.prepare(
    `SELECT
       e.primary_entity_id,
       ent.name      AS entity_name,
       ent.ticker    AS entity_ticker,
       ent.sector    AS entity_sector,
       COUNT(DISTINCT e.source) AS source_count,
       COUNT(*)                 AS event_count,
       GROUP_CONCAT(DISTINCT e.source) AS sources,
       MAX(e.published_at) AS latest_at,
       MIN(e.published_at) AS earliest_at,
       (SELECT MIN(published_at) FROM events e2
        WHERE e2.primary_entity_id = e.primary_entity_id) AS first_seen_ever
     FROM events e
     LEFT JOIN entities ent ON ent.id = e.primary_entity_id
     WHERE e.primary_entity_id IS NOT NULL
       AND e.published_at >= ?
     GROUP BY e.primary_entity_id
     HAVING COUNT(DISTINCT e.source) >= ?
     ORDER BY source_count DESC, event_count DESC, latest_at DESC
     LIMIT ?`,
  )
    .bind(since, minSources, limit)
    .all<ConvergenceRow>())
    .results ?? [];

  // Recent 3 event titles per entity in the window (for the brief callout).
  const entityIds = summary.map((r) => r.primary_entity_id).filter((x): x is string => Boolean(x));
  let recent: RecentEvent[] = [];
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    recent = (await c.env.DB.prepare(
      `SELECT primary_entity_id, source, title, source_url, published_at
       FROM (
         SELECT primary_entity_id, source, title, source_url, published_at,
                ROW_NUMBER() OVER (
                  PARTITION BY primary_entity_id
                  ORDER BY published_at DESC
                ) AS rn
         FROM events
         WHERE primary_entity_id IN (${placeholders})
           AND published_at >= ?
       )
       WHERE rn <= 3
       ORDER BY primary_entity_id, published_at DESC`,
    )
      .bind(...entityIds, since)
      .all<RecentEvent>())
      .results ?? [];
  }

  // Velocity overlay: for each entity in the summary, find the latest
  // prediction-market quote + the immediately prior tick's prob so we can
  // surface 4h drift. LAG() gives us the previous fetch per (entity, source,
  // market). We look back 12h to cover one cron-markets gap (4h cadence).
  let velocity: MarketVelocityRow[] = [];
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    const velocityWindow = Math.floor(Date.now() / 1000) - 12 * 3600;
    velocity = (await c.env.DB.prepare(
      `WITH ranked AS (
         SELECT
           entity_id,
           source,
           market_id,
           question,
           prob,
           fetched_at,
           market_url,
           volume,
           LAG(prob) OVER (
             PARTITION BY entity_id, source, market_id
             ORDER BY fetched_at
           ) AS prob_prior,
           LAG(fetched_at) OVER (
             PARTITION BY entity_id, source, market_id
             ORDER BY fetched_at
           ) AS fetched_at_prior,
           /* Per-entity pick: latest tick of the highest-volume market.
              Volume DESC so we pick the most-liquid market the entity has.
              Tiebreak by recency. */
           ROW_NUMBER() OVER (
             PARTITION BY entity_id
             ORDER BY (volume IS NULL) ASC, volume DESC, fetched_at DESC
           ) AS rn
         FROM market_quotes
         WHERE entity_id IN (${placeholders})
           AND resolved = 0
           AND fetched_at >= ?
       )
       SELECT
         entity_id, source, market_id, question, market_url,
         prob       AS prob_now,
         fetched_at AS fetched_at_now,
         prob_prior,
         fetched_at_prior
       FROM ranked
       WHERE rn = 1`,
    )
      .bind(...entityIds, velocityWindow)
      .all<MarketVelocityRow>())
      .results ?? [];
  }
  const velocityByEntity = new Map<string, MarketVelocityRow>();
  for (const v of velocity) velocityByEntity.set(v.entity_id, v);

  // Attach recent events to each summary row for the response.
  const recentByEntity = new Map<string, RecentEvent[]>();
  for (const ev of recent) {
    const list = recentByEntity.get(ev.primary_entity_id) ?? [];
    list.push(ev);
    recentByEntity.set(ev.primary_entity_id, list);
  }

  // Attention overlay — top-N entities only (limit parallel Wikimedia fetches).
  const ATTENTION_TOP_N = 15;
  const attentionByEntity = new Map<string, AttentionResult | null>();
  const topEntities = summary.slice(0, ATTENTION_TOP_N);
  const attentionResults = await Promise.allSettled(
    topEntities.map(async (row) => {
      const eid = row.primary_entity_id ?? "";
      const wikiUrl = SEED_WIKI_BY_ID.get(eid)?.wiki_url ?? null;
      const article = articleFromWikiUrl(wikiUrl);
      if (!article) return { eid, result: null };
      const result = await fetchAttention(article, 30);
      return { eid, result };
    }),
  );
  for (const r of attentionResults) {
    if (r.status === "fulfilled" && r.value) {
      attentionByEntity.set(r.value.eid, r.value.result);
    }
  }

  console.log(
    JSON.stringify({
      route: "/convergence",
      hours,
      minSources,
      entities: summary.length,
      velocityHits: velocity.length,
      attentionHits: Array.from(attentionByEntity.values()).filter(Boolean).length,
    }),
  );

  return c.json({
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    minSources,
    rows: summary.map((row) => {
      const eid = row.primary_entity_id ?? "";
      const v = velocityByEntity.get(eid);
      const marketQuote = v
        ? {
            source: v.source,
            marketId: v.market_id,
            question: v.question,
            marketUrl: v.market_url,
            probNow: v.prob_now,
            probPrior: v.prob_prior,
            probChange: v.prob_prior != null ? v.prob_now - v.prob_prior : null,
            fetchedAtNow: v.fetched_at_now,
            fetchedAtPrior: v.fetched_at_prior,
          }
        : null;
      const attention = attentionByEntity.get(eid) ?? null;
      const attentionSummary = attention
        ? {
            totalViews: attention.totalViews,
            avgPerDay: Math.round(attention.avgPerDay),
            trendDirection: attention.trend?.direction ?? null,
            trendDeltaPct: attention.trend?.deltaPct ?? null,
          }
        : null;

      // ─── Derived label ─────────────────────────────────────────────────
      // "breakout"   = multi-source convergence + attention surging (≥25%).
      //                Mainstream attention catching up — late but visible.
      // "divergence" = multi-source convergence + attention falling. The
      //                event hasn't crossed into public attention yet. This
      //                is the pre-news lead time slot — most actionable.
      // null otherwise.
      let label: "breakout" | "divergence" | null = null;
      let labelReason: string | null = null;
      const trend = attention?.trend;
      if (trend && row.source_count >= 3) {
        if (trend.direction === "up" && trend.deltaPct >= 25) {
          label = "breakout";
          labelReason = `attention +${trend.deltaPct.toFixed(0)}% over prior 7d while ${row.source_count} sources fire`;
        } else if (trend.direction === "down") {
          label = "divergence";
          labelReason = `${row.source_count} sources fire but attention ${trend.deltaPct.toFixed(0)}% (pre-news lead)`;
        }
      }
      return {
        entityId: row.primary_entity_id,
        name: row.entity_name,
        ticker: row.entity_ticker,
        sector: row.entity_sector,
        sourceCount: row.source_count,
        eventCount: row.event_count,
        sources: (row.sources ?? "").split(",").filter(Boolean),
        latestAt: row.latest_at,
        earliestAt: row.earliest_at,
        firstSeenEver: row.first_seen_ever,
        // Distinguish "new convergence" (entity has been in the system <48h)
        // from "ongoing chatter" (>48h old) so the UI can badge it.
        isNew:
          row.first_seen_ever != null &&
          Math.floor(Date.now() / 1000) - row.first_seen_ever < 48 * 3600,
        recent: recentByEntity.get(eid) ?? [],
        marketQuote,
        attention: attentionSummary,
        label,
        labelReason,
      };
    }),
  });
});
