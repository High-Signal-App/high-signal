/**
 * Wikipedia Pageviews — per-article attention signal.
 *
 *   GET /attention/{article}?days=30
 *
 * Returns the daily-pageview series for an English-Wikipedia article over
 * the requested window, plus a 7-vs-prior-7-day trend so callers can show a
 * single "attention up/down N%" indicator. The /convergence route uses this
 * to overlay attention on each converging entity.
 *
 * Source: https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...
 * The Wikimedia Foundation tolerates this from cloud IPs as long as the
 * User-Agent follows their policy (tool + repo + contact email).
 */

import { Hono } from "hono";

type Env = Record<string, never>;

const USER_AGENT =
  "high-signal-attention/0.1 " +
  "(+https://github.com/High-Signal-App/high-signal; " +
  "contact: sarthak@vaultwealth.com)";

const PAGEVIEWS_BASE =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/" +
  "en.wikipedia/all-access/all-agents";

export interface AttentionPoint {
  date: string;   // YYYY-MM-DD
  views: number;
}

export interface AttentionResult {
  article: string;
  days: number;
  series: AttentionPoint[];
  totalViews: number;
  avgPerDay: number;
  // Trend = (last 7-day avg) vs (prior 7-day avg).
  // Null when there isn't 14 days of data yet.
  trend: {
    recentAvg: number;
    priorAvg: number;
    deltaPct: number; // (recent - prior) / prior * 100
    direction: "up" | "down" | "flat";
  } | null;
}

/** Parse Wikipedia's `2026051000` timestamp → `2026-05-10`. */
export function parseTimestamp(ts: string): string {
  // First 8 chars are the date in YYYYMMDD form; the trailing 2 are always "00"
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

/** Aggregate a raw pageviews response into the AttentionResult shape. */
export function summarize(article: string, days: number, items: Array<{ timestamp: string; views: number }>): AttentionResult {
  const series: AttentionPoint[] = items.map((i) => ({
    date: parseTimestamp(i.timestamp),
    views: Number(i.views) || 0,
  }));
  const totalViews = series.reduce((s, p) => s + p.views, 0);
  const avgPerDay = series.length > 0 ? totalViews / series.length : 0;

  let trend: AttentionResult["trend"] = null;
  if (series.length >= 14) {
    const recent = series.slice(-7);
    const prior = series.slice(-14, -7);
    const recentAvg = recent.reduce((s, p) => s + p.views, 0) / recent.length;
    const priorAvg = prior.reduce((s, p) => s + p.views, 0) / prior.length;
    const deltaPct = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
    const direction: "up" | "down" | "flat" =
      Math.abs(deltaPct) < 5 ? "flat" : deltaPct > 0 ? "up" : "down";
    trend = { recentAvg, priorAvg, deltaPct, direction };
  }

  return { article, days, series, totalViews, avgPerDay, trend };
}

function fmtDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}`
  );
}

export function buildPageviewsUrl(article: string, days: number, end = new Date()): string {
  const start = new Date(end.getTime() - days * 86_400_000);
  return `${PAGEVIEWS_BASE}/${encodeURIComponent(article)}/daily/${fmtDate(start)}/${fmtDate(end)}`;
}

/** Extract a Wikipedia article slug from a wiki URL — `…/wiki/Nvidia` → `Nvidia`. */
export function articleFromWikiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/wiki\/([^?#]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export const attentionRoute = new Hono<{ Bindings: Env }>();

attentionRoute.get("/:article", async (c) => {
  const articleParam = decodeURIComponent(c.req.param("article") ?? "").trim();
  if (!articleParam) return c.json({ error: "missing article" }, 400);
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 7), 90);

  try {
    const r = await fetch(buildPageviewsUrl(articleParam, days), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      // Cache for 30 min — pageviews update daily, not by the hour.
      cf: { cacheTtl: 1800, cacheEverything: true } as RequestInitCfProperties,
    });
    if (!r.ok) {
      console.log(
        JSON.stringify({ route: "/attention", article: articleParam, status: r.status }),
      );
      return c.json({ error: `wikimedia_${r.status}`, article: articleParam }, 502);
    }
    const body = (await r.json()) as { items?: Array<{ timestamp: string; views: number }> };
    const result = summarize(articleParam, days, body.items ?? []);
    return c.json(result);
  } catch (err) {
    console.log(
      JSON.stringify({ route: "/attention", article: articleParam, error: String(err) }),
    );
    return c.json({ error: "fetch_failed", article: articleParam }, 502);
  }
});
