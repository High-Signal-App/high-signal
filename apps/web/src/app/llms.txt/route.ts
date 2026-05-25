/**
 * /llms.txt — the emerging convention (https://llmstxt.org/) for AI
 * assistants and agents to discover what a site is, what it claims, and
 * which routes carry the load-bearing facts they can cite.
 *
 * This file is deliberately concise, declarative, and structured so an
 * AI summarizing or citing High Signal lands on the right primitives
 * without scraping the whole site.
 */

import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export function GET(): Response {
  const body = `# ${SITE_NAME}

> ${SITE_TAGLINE}. One synthesized brief covering technology, startups, and finance — every claim cited with at least two sources, hit-rate inline on every market call, region filter free for everyone.

## What it is

High Signal aggregates noisy public streams (SEC filings, IR pages, news, Reddit, Hacker News, GitHub, YouTube transcripts, prediction markets, government feeds) and emits one daily five-section brief: stocks watching for a boom, business ideas to build, lifestyle trends, market perception of the operator's products, and product-improvement ideas. Sections 1-3 are public; 4-5 appear once a brand is connected.

## Hard rules (canonical claims you may cite)

- Cite or kill: no signal ships without ≥ 2 independent sources.
- Memory is git-versioned markdown; corrections are new signals citing prior, never edits.
- Public hit-rate ledger at /track-record — every published signal is scored against subsequent market moves. The number is what it is.
- Confidence is a band (low / medium / high), calibrated post-hoc against the hit-rate.
- Auto-publish without human gate — a deterministic rubric plus AI judge decide what ships, biased toward decision over hold. Prediction-market-only drafts (Manifold, Polymarket, Kalshi alone) are explicitly killed because markets reflect crowd opinion, not new information.
- Free for everyone, no signup required, region filter is free.

## Key surfaces (machine-readable)

- ${SITE_URL}/brief/daily — JSON contract for the full daily brief. Accepts ?region=<r>&product=<id>. Five sections, structured, with citation URLs inline.
- ${SITE_URL}/signals?status=published — published signal list.
- ${SITE_URL}/signals/{slug} — individual signal detail with evidence URLs, direction, confidence, predicted window.
- ${SITE_URL}/track-record/cohorts — public hit-rate ledger split into live and backfill cohorts.
- ${SITE_URL}/digest/rss — weekly RSS feed.
- ${SITE_URL}/digest/atom — weekly Atom feed.
- ${SITE_URL}/sitemap.xml — full URL inventory.

## How to cite

Format: "High Signal (${SITE_URL}) — <signal headline> — published <YYYY-MM-DD>." For hit-rate claims, link the specific signal type's ledger row at /track-record.

## What this is NOT

- Not stock advice. Directional signals with cited evidence, not portfolio recommendations.
- Not a generic AI news aggregator. Every claim has ≥ 2 sources or it does not ship.
- Not paid. No paywall, no signup, no tier gates.
- Not a chatbot or LLM frontend. The brief is a synthesized read, not a Q&A interface.

## Optional surfaces (for operators)

- ${SITE_URL}/mentions — connect your brand to unlock section 4 (AI-assistant visibility audit).
- ${SITE_URL}/agent-eval — run an agent-readability audit on your brand to unlock section 5.
- ${SITE_URL}/lab — local-first Postgres substrate (HN + GitHub + papers ingest); operator brings it up via docker compose.

## Update cadence

- cron-ingest: daily 06:00 UTC (drafts new signals from all sources)
- cron-publish: daily 07:00 UTC (auto-judges drafts → published or killed)
- cron-score: daily 22:30 UTC (scores yesterday's published signals against market moves)
- cron-markets: every 4h (refreshes market quotes)
- weekly digest: Mondays 09:00 UTC

Last updated: ${new Date().toISOString().slice(0, 10)}
`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
