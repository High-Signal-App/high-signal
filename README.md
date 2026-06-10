# High Signal

High Signal is **one product**: a synthesized **Daily Brief** assembled from many noisy public sources. It covers three knowledge domains — **technology, startups, finance** — globally by default and filtered to any region a user picks.

The brief has five sections. The first three are public; the last two appear once the user connects a brand.

1. **Stocks watching for a boom** — hit-rate inline on every claim.
2. **Business ideas to build** — surfaced from community demand.
3. **New lifestyle trends** — community + cultural drift.
4. **How the market perceives your products** — mention intelligence.
5. **Ideas to improve your products** — agent-readiness gaps.

Everything else in the repo (Markets, Communities, Mentions, Agent Eval, Lab) is a **lens** — an intelligence helper that feeds the brief. They remain explorable as deep views but are no longer the product's headline.

Pricing: free. No paid tier, no billing. Region is a free filter.

## What it does today
- Ingests SEC filings, IR pages, AI-infra news/blogs, Reddit, GitHub, government feeds, YouTube transcripts, HKEX announcements, GDELT, and prediction markets
- Extracts events + entities + relationships
- Turns world-level changes and repeated app complaints into product opportunities under `/opportunities`
- Maps those opportunities onto the personal product graph under `/personal`
- Drafts daily signal candidates across low / medium / high confidence bands
- Predicts direction + 2nd-order spillover via supplier/customer/peer graph
- Publishes reviewed signal cards + weekly digest
- Auto-backtests every signal — public hit-rate ledger updated continuously

## Why the first market wedge still matters
- Small entity graph (~150 names) — tractable solo
- News-dense, retail-attentive, spillover-dominant alpha pattern (TSMC capex → ASML → HBM → cloud capex → power names)
- Existing incumbents (AlphaSense, Brightwave, Daloopa) own enterprise research workflows; nobody ships a directed spillover graph + public hit-rate
- Source layer is fully covered by OSS — no licensed feeds required for v0

## Status (2026-05-30)

- **Daily Brief** — primary surface at `/` and `/brief`. Worker route `/brief/daily?region=&owner=` composes the five sections from the lenses below. Region filter free for everyone; default global.
- **Markets lens** — functional. Ingest + signal log + review queue + public hit-rate ledger at `/track-record`. Feeds brief section 1 with inline hit-rate per signal type.
- **Communities lens** — functional. Tracked-subreddit CRUD, periodic digest generation (LLM summary when `HIGH_SIGNAL_AI_API_KEY` is set, deterministic fallback otherwise). Feeds brief sections 2 and 3.
- **Mentions lens** — UI + worker wired at `/mentions`. Real LLM checks fail-closed without `HIGH_SIGNAL_AI_API_KEY`; the local preview analyzer panel works regardless. Feeds brief section 4 (per connected brand).
- **Agent Eval lens** — deterministic 8-area evidence scorer + reel briefs at `/agent-eval`. Real-AI prompt execution overlays when the same key is set. Feeds brief section 5 (per connected brand).
- **Cross-source convergence** — `/convergence` page + `GET /convergence?hours=24&min_sources=3` API route. Lists entities hit by ≥ N distinct sources in a rolling window — the strongest pre-news pattern in the system. SQL aggregation against the `events` table; no new ingest. Now also overlays the latest prediction-market quote per entity with 4h prob drift, and a "Watching closely" callout sits above the brief composer pulling the same data. Breakout/divergence labels carry an inline next-24h hit-rate from a backtest replayed weekly by `cron-backtest.yml`; full ledger at `/track-record/labels` and `GET /track-record/labels`.
- **Gazetteer candidates** — `/unmapped` page + `GET /unmapped?hours=24` API route. Three candidate streams from the same unmapped-events query: (1) **$TICKER** mentions, (2) **bare tickers** — UPPERCASE 3–5 char tokens matched against a 2,502-symbol allowlist derived from the equities universe, (3) **bare entities** — open-world capitalized 1–3 word phrases that survive a stoplist (countries, common nouns, market platforms) + a leading-word stripper ("Will Harvey Weinstein" → "Harvey Weinstein") + corporate-suffix normalization ("Anthropic PBC" → "Anthropic") + a seed-entities dedupe. Each candidate has a "copy CSV row" button that calls `/enrich/ticker?token=$NVDA`, fetches Wikidata SPARQL for company name + country + industry + Wikipedia URL + CIK, and copies a fully-shaped seed-CSV row to the clipboard. Closes the loop: the more sources you ingest → the more candidates surface → one-click promote → next ingest run picks the new entity up.
- **Lab substrate** (plan `0007`) — Phase 1 expanded: docker-compose Postgres+pgvector, schema, HN ingest with outbound-link extraction, one-hop materialization, GitHub trending scraper, 4-factor scorer (HN + recency + velocity + GitHub-momentum placeholder), union-find story clustering, local sentence-transformer embeddings + semantic search, GLiNER entity extraction, local-LLM summarization (Ollama / vLLM), FastAPI feed at `/lab` with cluster-collapse toggle. Still pending from plan 0007: 14k-repo DB import, GitHub API enrichment for repos, GitHub-momentum factor in scorer.

For day-to-day stack and conventions, read `agents.md` (canonical).

## Integrations & companion tools

- **drank** (Web Authority / Domain Signals): A companion tool and data source for tracking high-signal websites via Ahrefs Domain Rating. The live leaderboard and community nominations are surfaced at `/domains` in this app. Full interactive predictions and personal tracking live at the standalone [drank app](https://drank-sand.vercel.app). Data is shared via public GitHub-backed JSON.

## Data pipelines

Status of every public-source ingest that feeds the brief.
**Tick the box when wired.** Items left unticked are either deferred or
partially landed (notes call out *which* part remains).

Legend used in the notes:
- **wired** — ingest runs in the daily cron and writes to D1 / git markdown / artifact.
- **partial** — some of the source's surface is in, but the canonical scope (forms, sub-feeds, sub-tier columns) isn't complete yet.
- **deferred** — wiring exists but not on the daily path (e.g., a v2 of the source).

### Capital, filings, money
- [x] **SEC EDGAR — 8-K / 10-Q / 10-K** — `python/ingest/sources/edgar.py`
- [x] **SEC EDGAR — Form D** *(curated private-company search via `efts.sec.gov/LATEST/search-index`, 15-day filing lag, wider-window runs only)* — `python/ingest/sources/edgar.py`
- [x] **SEC EDGAR — S-1** *(IPO prospectuses for tracked public tickers, wider-window runs only)* — `python/ingest/sources/edgar.py`
- [x] **SEC EDGAR — Form 4** *(insider transactions for tracked public tickers, wider-window runs only; cluster scoring still belongs downstream)* — `python/ingest/sources/edgar.py`
- [x] **SEC EDGAR — 13F-HR** *(institutional holdings for tracked public tickers, wider-window runs only)* — `python/ingest/sources/edgar.py`
- [x] **USPTO PatentsView API** *(curated assignee grants for 12–24mo product-lookahead evidence; adapter is wired, but the live API is currently in USPTO ODP transition and returns no events)* — `python/ingest/sources/patents.py`
- [x] **Companies House (UK)** *(optional `COMPANIES_HOUSE_API_KEY`; UK entity enrichment for tracked companies, skipped without a key)* — `python/ingest/sources/companies_house.py`
- [x] **HKEX issuer announcements** — `python/ingest/sources/hkex.py`
- [x] **IR pages** — `python/ingest/sources/ir.py`
- [x] **GLEIF LEI** *(enrichment / entity resolution)* — *(planned: bulk download + cross-source join key)*

### Equities snapshot pipeline (`/equities`)
- **Stock-price source of truth** — all public equity / ETF / index / crypto EOD prices enter through `python/ingest/src/high_signal_ingest/equities_daily.py`, which uses the shared yfinance adapter and writes `data/equities-snapshot.jsonl`. Do **not** add direct quote fetchers in web scripts, personal workflows, signal scoring, or source adapters; consume this artifact or the D1 `closes` / `ticker_snapshot` tables once that migration is active.
- **Derived artifacts only** — `apps/web/src/data/equities-snapshot.json`, `apps/web/src/data/price-context.json`, `apps/web/src/data/market-refreshes.json`, and `workers/api/src/lib/known-tickers.json` are build outputs derived from `data/equities-snapshot.jsonl`, not independent market-data sources.
- **Prediction markets are separate** — `market_quotes` means Polymarket / Manifold / Kalshi probabilities, not stock quotes. Never use that table as equity-price evidence.
- [x] **Universe build** — S&P 500 + Russell 1000 + S&P 400 + S&P 600 + Wikipedia international + ai_infra_entities + curated ETFs/indices + crypto top 100 → **3,226 unique tickers** — `python/ingest/sources/equities/universe.py`
- [x] **yfinance closes** — daily EOD via batched download — `python/ingest/sources/equities/yf.py`
- [x] **Tier 1 derivations** — ret_1d/30d/90d/1y/5y (local + USD), volatility, 52-week, SMA50/200, golden/death cross, beta vs SPY — `python/ingest/sources/equities/snapshot.py`
- [x] **Page** — sortable / filterable table at `/equities`
- [x] **Cron** — `cron-equities.yml`, 21:30 UTC weekdays; bot auto-commits refresh
- [x] **Tier 2 macro/context** — ECB FX daily + optional-key FRED DGS3MO/DGS10; Wikipedia pageviews and Wikidata enrichment are already wired. Dividend yield remains intentionally out until the single market-data service owns it. — `python/ingest/sources/macro_rates.py`
- [x] **Tier 3 foundations** — SEC XBRL fundamentals (US), wider-window Form 4 / 13F raw filings, and mention-count inputs from existing events. Market cap must be derived by joining XBRL shares/fundamentals to the single equities snapshot source; FINRA short interest and holder summaries remain downstream analytics, not new source fetchers. — `python/ingest/sources/sec_xbrl.py`, `python/ingest/sources/edgar.py`

### Jobs (leading capital indicator)
- [x] **Greenhouse + Lever + Ashby public job boards** *(curated first batch; expand board-slug list toward ~2k startup companies)* — `python/ingest/sources/jobs.py`

### Builder activity
- [x] **GitHub releases** *(11 AI-infra repos)* — `python/ingest/sources/github.py`
- [x] **GitHub trending** *(5 languages × daily/weekly/monthly)* — `python/ingest/lab/github_trending.py`
- [x] **GitHub stars (personal + ≥ 5k-star repos)** — `../starboard`
- [x] **GitHub Archive** *(bounded public hourly archive reader over already tracked repos; avoids ingesting the unrelated firehose)* — `python/ingest/sources/github_archive.py`
- [x] **Hugging Face Hub** *(recent/trending models + datasets via public Hub API; download trend deltas still pending)* — `python/ingest/sources/huggingface.py`
- [x] **PyPI** *(curated package releases + OSV-linked vulnerability advisories; download trends still pending)* — `python/ingest/sources/package_registries.py`
- [x] **npm registry** *(curated package releases + OSV-linked vulnerability advisories; download trends still pending)* — `python/ingest/sources/package_registries.py`
- [x] **OSV.dev** *(package-ecosystem vulnerability advisories for curated npm/PyPI package set)* — `python/ingest/sources/package_registries.py`

### Research
- [x] **arXiv** — `../researchPapers/arxiv.py` (top-10k CS papers, URL extraction)
- [x] **OpenAlex** — `../researchPapers/openalex.py` (citation graph)
- [x] **Semantic Scholar Graph API** *(curated recent research-paper search; no-key public mode with optional API key for rate limits)* — `python/ingest/sources/semantic_scholar.py`

### Discourse
- [x] **Hacker News** — `python/ingest/lab/ingest.py` (Firebase API + outbound-link extraction)
- [x] **Reddit** *(13 subs — hardware/semi-heavy + startup/dev/operator)* — `python/ingest/sources/reddit.py`
- [x] **YouTube transcripts** *(15 hardware/macro/founder/operator channels)* — `python/ingest/sources/youtube.py`
- [x] **Bluesky AT Protocol** *(optional-auth search lane for real founder/researcher presence; full Relay firehose can replace it later if volume justifies it)* — `python/ingest/sources/bluesky.py`
- [x] **Lobste.rs** *(small technical RSS weak-signal source; curated alternative to broad social firehose)* — `python/ingest/sources/lobsters.py`
- [x] **Substack RSS pool** *(curated first batch — Pragmatic Engineer, Lenny's, Latent Space, Import AI; expand toward ~200 tech/startup writers)* — `python/ingest/sources/substack.py`
- [x] **Techmeme RSS** *(meta-curation / corroboration source, not primary evidence)* — `python/ingest/sources/techmeme.py`
- [x] **Podcast Index → transcript lane** *(optional Podcast Index metadata fetch for Acquired / 20VC / Latent Space; Whisper transcription is a downstream processor, not a daily fetcher concern)* — `python/ingest/sources/podcast_index.py`

### Policy & standards
- [x] **Federal Register** *(BIS, Commerce, FTC, SEC, FCC, DHS/USCIS, FAA, FDA rulemaking feeds)* — `python/ingest/sources/gov.py`
- [x] **Regulations.gov** *(optional `REGULATIONS_GOV_API_KEY`; dockets/documents after Federal Register notice)* — `python/ingest/sources/regulations.py`
- [x] **SAM.gov + SBIR.gov + USAspending** *(SBIR public awards, no-key USAspending awards, plus optional-key SAM.gov opportunity search for AI / semiconductor / datacenter / cybersecurity demand signals)* — `python/ingest/sources/gov_contracts.py`

### Markets / prediction
- Scope note: this lane is for forecast/probability markets only. It must not fetch or store equity prices; equity movement context belongs to the equities snapshot pipeline above.
- [x] **Prediction markets — Polymarket + Manifold** *(10 AI-infra keywords)* — `python/ingest/sources/markets.py`
  - [x] Add **Kalshi** *(US-regulated real-money exchange — cursor-paginated, no-auth read)*
  - [x] **Broaden Polymarket coverage** beyond keyword filter — top-N by 24h volume firehose ("new kinds of gambling people do")
  - [x] Add **Metaculus** *(optional `METACULUS_TOKEN`; reputation-based long-horizon forecasts, context only because the API requires auth and terms review)* — `python/ingest/sources/metaculus.py`

### News
- [x] **GDELT 2.0 DOC API** *(39 themed queries, semi-focused)* — `python/ingest/sources/gdelt.py`
- [x] **News + blog RSS pool** *(50+ tiered feeds)* — `python/ingest/sources/news.py` + `seed/sources.yaml`
- [x] **The Guardian Open Platform** *(optional `GUARDIAN_API_KEY`; mainstream corroboration/full-text news lane, skipped cleanly without a key)* — `python/ingest/sources/guardian.py`

### Attention
- [x] **Wikipedia Pageviews API** — `GET /attention/:article?days=30` returns daily series + 7-vs-prior-7 trend. Overlaid on `/convergence` for the top 15 entities (avg/day + ±%). 275-entity seed JSON bundled in the Worker; no D1 round-trip.
- [x] **Wikidata enrichment** *(bounded explicit enrichment adapter plus `/enrich/ticker` SPARQL lookup for candidate promotion; not part of daily `--source all` signal generation)* — `python/ingest/sources/wikidata.py`, `workers/api/src/routes/enrich.ts`

### Competitor / product intelligence
- [x] **Wayback Machine CDX** *(moved out of general aggregation per product boundary; belongs to Mention / Agent Eval product-diff lane, not the High Signal public-source brief)* — other product backlog

### Security
- [x] **NVD CVE API** *(curated keyword queries for tracked security/devtool products; CISA KEV remains the exploited-in-wild source)* — `python/ingest/sources/nvd.py`
- [x] **CISA KEV catalog** *(known exploited vulnerabilities only; structured security-risk candidates, not a broad CVE firehose)* — `python/ingest/sources/cisa_kev.py`

---

**Naming convention**: ingest sources live under `python/ingest/src/high_signal_ingest/sources/`; sources that produce a web surface own a route under `apps/web/src/app/`; cron workflows live in `.github/workflows/cron-*.yml`. Each new pipeline gets a row in this list — keep it the canonical status board.

## Roadmap — next up (priority order)

Pending work, in the order it's expected to ship. Items move into the
sections above (with their pipeline / route / cron) as they land.

1. **Apply the pending remote D1 migration when approved** — `wrangler d1 migrations list high-signal-db --remote --config workers/api/wrangler.toml` currently reports `0008_source_document_keys.sql` pending. The app and API are deployed and serving, but do not treat remote source-document dedupe semantics as current until this migration is applied.
2. **Review the source-quality report after the next full ingest** — `pnpm source:quality -- --json` measures fetched events, mapped entities, duplicate-ish source families, and unmapped samples for Reddit / YouTube / Bluesky / CISA KEV / Lobste.rs / Techmeme / Substack / package registries / jobs / GitHub Archive / Hugging Face / NVD / Guardian / patents / government contracts / Wikidata / Semantic Scholar / Regulations.gov / Companies House / Metaculus / Podcast Index / macro rates / SEC XBRL without writing signals.
3. **Promote candidates from `/unmapped` to seed** — keep walking recurring high-signal entities into `ai_infra_entities.csv` so they get mapped on the next ingest. The first security/devtool batch is in: Palo Alto Networks, Trend Micro, Drupal, Langflow, Nx, TanStack, and LiteSpeed.
4. **Monitor the loosened breakout threshold** — breakout now triggers at +15% week-over-week pageview delta. Let the daily backtest build enough observations before retuning again.
5. **Expand curated lists inside wired adapters** — job-board slugs, Substack feeds, npm/PyPI packages, Bluesky searches, Podcast Index feeds, and Form D private-company queries are adapter configuration now; scale those lists before adding another broad firehose.
6. **Provision optional source credentials** — set only the sources you want live: `GUARDIAN_API_KEY`, `SAM_API_KEY`, `REGULATIONS_GOV_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `METACULUS_TOKEN`, `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD`, `PODCAST_INDEX_KEY` / `PODCAST_INDEX_SECRET`, `FRED_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`.

## Will discuss: Signal Studio and playgrounds
**Signal Studio** is the recommended first playground: a visual content lab that turns High Signal findings into polished marketing assets. It should feel like a futuristic marketing command center, not a boring dashboard. It can be playground-quality visually while still producing assets useful for selling High Signal.

Inputs:
- Company URL
- Product positioning
- Competitor names
- High Signal audit findings
- One target buyer persona

Outputs:
- AI visibility audit snapshot
- Competitor comparison page
- LinkedIn carousel
- Short-form reel script
- Landing page teardown
- "Why we lose to competitor X" brief
- Launch announcement
- Weekly founder update

Other playgrounds worth adding:
- **AI SERP Theater** — show simulated buyer-agent searches visually: prompts enter, AI assistants answer, competitors appear/disappear, and citations light up. Strong demo surface for High Signal.
- **Competitor Roast Machine** — enter two SaaS sites and generate a brutal but useful comparison across positioning, trust, AI visibility, homepage clarity, pricing clarity, and content gaps. Fun, shareable, lead-gen friendly.
- **Launch Page Forge** — given a product idea, generate five landing page angles, a pricing page, comparison page, demo script, outbound emails, and social posts. Useful for the fleet and visually attractive.
- **Market Pulse Wall** — a live wall of signals: Reddit complaints, AI search mentions, GitHub trends, news, pricing changes, and founder posts. Potential High Signal "wow" screen.
- **Prompt-to-Campaign** — type a goal like "sell High Signal to devtool founders" and generate the campaign: ICP, message, landing section, posts, cold emails, ad concepts, and demo flow.

Worth folding into core High Signal:
- AI fact-checker / source surfacer
- Hyperlocal/community intelligence
- Market pulse / geo heatmap
- AI visibility / recommendation tracking
- Competitor monitoring

Worth playgrounding as marketing tools:
- Prompt-to-campaign generator
- Competitor roast/comparison machine
- AI SERP theater
- Launch page forge
- Signal-to-reel/carousel generator
- "Put in an idea, get the go/no-go brief"

## Architecture
```
apps/web              Next.js 16 + Tailwind v4 — futurist + clean UI, Clerk auth
workers/api           Hono on Cloudflare Workers + D1 binding + cron
packages/db           Drizzle schema + migrations (sqlite/D1) — signals, mentions,
                      communities, agent-eval, market quotes
packages/shared       Cross-package types + deterministic Agent-Eval scorer
python/ingest         uv-managed: edgartools, Trafilatura, GLiNER, FinBERT, yfinance
  └ GitHub Actions runs daily ingest, markets polling, and scoring
python/lab            Local-first Postgres substrate (plan 0007): pgvector,
                      HN ingest, GitHub trending, scorer, FastAPI feed
signals/              Git-versioned, append-only signal markdown
scripts/              CSV→D1 + signals.md→D1 sync
```

## Quickstart
```bash
# 1. Node deps
pnpm install

# 2. Python deps
cd python/ingest && uv sync && cd -

# 3. Cloudflare D1
wrangler d1 create high-signal-db        # paste the id into workers/api/wrangler.toml
pnpm db:migrate:local
pnpm db:seed:local                       # loads 274 entities + 175 relationships
pnpm product-flow:seed:local             # loads reviewed product-flow evidence for /ideas
pnpm personal:brief                      # prints the personal build/change/watch brief
pnpm personal:brief refresh-sources      # refreshes public product-flow evidence from tracked communities
pnpm personal:brief feedback high-signal-agent-evaluation build build "core direction"
pnpm personal:brief decide high-signal-agent-evaluation accepted build "turn this into next work"
pnpm personal:brief tasks                # prints SaaS Maker-ready task drafts from accepted actions
pnpm personal:brief sync-tasks           # dry-runs idempotent SaaS Maker task creation
pnpm personal:brief sync-tasks --apply   # creates missing accepted-action tasks via SaaS Maker
pnpm personal:brief report               # writes reports/personal/YYYY-MM-DD.md for weekly review

# 4. Env (.dev.vars + Modal Secret named `high-signal`)
#   AI_BASE_URL, AI_API_KEY, AI_MODEL
#   SEC_USER_AGENT="your-name your@email"

# 5. Dev
pnpm dev                                 # web (3000) + worker (8787)

# 6. Draft signals
cd python/ingest && uv run python -m high_signal_ingest.pipeline --source news --days 1

# 7. Review + publish
#   - open signals/<date>/<slug>.md
#   - flip review_status: published
#   - git commit
pnpm signals:sync:local

# 8. Optional: bring up the Lab substrate (plan 0007)
docker compose -f python/lab/docker-compose.yml up -d
cd python/lab && uv sync
uv run python -m high_signal_lab.ingest --limit 30           # HN + page text + outbound links
uv run python -m high_signal_lab.materialize --limit 50      # fetch one-hop linked pages
uv run python -m high_signal_lab.github_trending             # github.com/trending into repos
# Optional enrichment passes (each downloads its own model on first run):
uv sync --extra embeddings && uv run python -m high_signal_lab.embed
uv sync --extra entities && uv run python -m high_signal_lab.extract_entities
# Optional: point at any OpenAI-compatible endpoint (Ollama localhost:11434/v1 default):
uv run python -m high_signal_lab.summarize
uv run python -m high_signal_lab.cluster                     # story grouping (union-find)
uv run python -m high_signal_lab.score                       # 4-factor scoring
uv run python -m high_signal_lab.server                      # http://localhost:8765
# Then in the web app shell:
export LAB_API_URL=http://localhost:8765 && pnpm dev
```

## Quick links
- Spec: `SPEC.md`
- Commercial handoff: `docs/high-signal-handoff.md`
- Consolidation plan: `plans/0004-platform-consolidation.md`
- Plan: `plans/0001-research-artifact-first.md`
- Agent Evaluation plan: `plans/0006-agent-evaluation-attention-layer.md`
- Lab substrate plan: `plans/0007-highsignal-lab-substrate.md`
- Lab bring-up: `python/lab/README.md`
- Product opportunity radar: `/opportunities`
- Personal command brief: `/personal`
- Research: `research/market-and-oss.md`
- Stack + conventions: `agents.md`
- Seed corpus: `python/ingest/src/high_signal_ingest/seed/`
- Example signal: `signals/2026-04-25/example-nvda-h100-lead-time.md`
- Ingest runbook: `docs/ingest-runbook.md`
- Source coverage / launch scope: `docs/source-coverage.md`
- Data ownership boundary: `docs/data-service-boundary.md`
- Seeding guide: `docs/seeding.md`

## Deploy
- Web → Cloudflare Workers via OpenNext (`.github/workflows/deploy-web.yml`)
- API → Cloudflare Workers (`.github/workflows/deploy-api.yml`)
- Ingest / markets / scoring → GitHub Actions cron
- Modal remains for manual long backfills (`cd python/ingest && uv run modal run modal_app.py::manual_backfill ...`)

## Naming
Codename `high-signal` collides with High Signal Labs / High Signal HQ. Final brand TBD post-traction.

<!-- ACTIVE-AI-TASK-LOG:START -->
## Active AI Task Log

This section is maintained by the SaaS Maker Active-AI product/design loop so future agents do not reopen duplicate UI tasks.

- Business lane: Core/status context
- Rule: do not create another broad "improve the UI" task unless the acceptance criteria differ materially from the tasks listed here.
- Source of truth for task status: SaaS Maker task board. README entries are durable context only.

- No current Active-AI product/design task from the 2026-05-25/26 loop. Treat this as watch/status unless new evidence appears.
<!-- ACTIVE-AI-TASK-LOG:END -->
