# High Signal

**Product:** [highsignal.app](https://highsignal.app)


> Current scope and day-to-day status live in [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) (authoritative). This README is setup, architecture, and pipeline reference.

High Signal is **one product**: a synthesized **Daily Brief** assembled from noisy public sources across **technology, startups, and finance**. The public edition contains three evidence-qualified sections: markets and companies, business opportunities, and behavior and culture.

Readers start with today or yesterday, open each signal to inspect its proof, and use Sources, Company Universe, and Track Record for context. Older records live in the chronological Signals surface behind a Turnstile human check. There are no reader accounts or personalized editions.

Markets, Communities, Entities, Sectors, and Convergence are supporting inputs or research indexes. They are not separate products. Brand intelligence lives in Mentionpilot. The former personal brief, D2C pipeline, Agent Eval implementation, and Lab have been retired from this repository.

Pricing: free. No paid tier, no billing. Region is a free filter.

## What it does today
- Ingests SEC filings, IR pages, AI-infra news/blogs, Reddit, GitHub, government feeds, YouTube transcripts, HKEX announcements, GDELT, and prediction markets
- Extracts source observations (`Event` / D1 `events`) + entities + relationships;
  reviewed actionable conclusions live in `signals`
- Turns supported world-level changes and repeated community demand into Daily Brief opportunities
- Drafts daily signal candidates across low / medium / high confidence bands, each with cited proof
- Predicts direction + 2nd-order spillover via supplier/customer/peer graph
- Publishes reviewed signal cards and one Daily Brief
- Auto-backtests every signal — public hit-rate ledger updated continuously

## Why the first market wedge still matters
- Small entity graph (~150 names) — tractable solo
- News-dense, retail-attentive, spillover-dominant alpha pattern (TSMC capex → ASML → HBM → cloud capex → power names)
- Existing incumbents (AlphaSense, Brightwave, Daloopa) own enterprise research workflows; nobody ships a directed spillover graph + public hit-rate
- Source layer is fully covered by OSS — no licensed feeds required for v0

## Product status

The final acceptance contract is [`docs/product/prd.md`](docs/product/prd.md).
Current implementation and release evidence lives in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
For day-to-day stack and conventions, read [`agents.md`](agents.md).

## Integrations & companion tools

- **drank** (Web Authority / Domain Signals): a parked data adapter consumed from public GitHub-backed JSON. It has no public High Signal route.

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
- [x] **Hacker News** — `python/ingest/src/high_signal_ingest/sources/hackernews.py` (daily keyless Algolia source; title, points, comments, outbound link)
- [x] **Digg attention overlay** — `python/ingest/src/high_signal_ingest/digg.py`; five documented feeds, 30-minute snapshots, immediate original-source verification for material crossings, and evidence/confidence contribution fixed to none. Released with D1 migrations `0022`–`0023`.
- [x] **Reddit daily archive** *(99 curated technology, business, markets and national India communities)* — one OAuth collection writes Zstd-22 posts, relevant comment trees and a versioned event export to private R2; scheduled High Signal ingestion and approved sibling products consume that shared export rather than scraping again. Reddit is attention, not proof. `scripts/reddit-daily-archive.mjs`, `python/ingest/src/high_signal_ingest/sources/reddit.py`
- [x] **YouTube discovery + transcripts** *(15 hardware/macro/founder/operator channels; transcript access remains best-effort and separate from official API coverage)* — `python/ingest/sources/youtube.py`
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
- [x] **Wayback Machine CDX** *(moved out of general aggregation per product boundary; belongs to Mentionpilot, not the High Signal public-source brief)* — Mentionpilot backlog

### Security
- [x] **NVD CVE API** *(curated keyword queries for tracked security/devtool products; CISA KEV remains the exploited-in-wild source)* — `python/ingest/sources/nvd.py`
- [x] **CISA KEV catalog** *(known exploited vulnerabilities only; structured security-risk candidates, not a broad CVE firehose)* — `python/ingest/sources/cisa_kev.py`

---

**Naming convention**: ingest sources live under `python/ingest/src/high_signal_ingest/sources/`; sources that produce a web surface own a route under `apps/web/src/app/`; cron workflows live in `.github/workflows/cron-*.yml`. Each new pipeline gets a row in this list — keep it the canonical status board.

## Work tracking

The PRD and locked product direction define scope. Planned, deferred, and
blocked work lives in this repository's GitHub Issues rather than in a second
README roadmap.

## Architecture
```
apps/web              Next.js 16 + Tailwind v4 — futurist + clean UI, fully public
workers/api           Hono on Cloudflare Workers + D1 binding + cron
packages/db           Drizzle schema + migrations (sqlite/D1) — signals, mentions,
                      communities, market quotes
packages/shared       Cross-package types + deterministic news/market helpers
python/ingest         uv-managed: edgartools, Trafilatura, GLiNER, FinBERT, yfinance
  └ GitHub Actions runs daily ingest, markets polling, and scoring
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
pnpm market:refresh                      # derive grouped market context from the equities snapshot
pnpm market:snapshot                     # build the web market-history artifact

# 4. Env (dedicated Infisical project; production defaults to `prod`)
#   ADMIN_TOKEN, AI_BASE_URL, AI_API_KEY, AI_MODEL
#   Modal's manual-backfill Secret remains named `high-signal`.
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

```

## Code health

Install the repository's check-only tooling, then run the same aggregate gate as CI:

```bash
pnpm install --frozen-lockfile
uv sync --project python/ingest --only-group dev
pnpm quality
```

`pnpm quality` covers formatting, lint, types, tests, API coverage, unused code and
dependencies, Python dead code, complexity, duplication, dependency advisories,
cycles, inline suppressions, and documentation integrity. Existing measured debt
is held to checked-in no-regression baselines in `scripts/check-code-health.mjs`;
lower a baseline when cleanup improves it, and link any accepted debt to a GitHub
issue rather than refreshing a number automatically. The ingest Python surface
also runs its native checks in CI.

## Quick links
- Product requirements: `docs/product/prd.md`
- Spec: `SPEC.md`
- Commercial handoff: `docs/product/handoff.md`
- Consolidation plan: `plans/0004-platform-consolidation.md`
- Plan: `plans/0001-research-artifact-first.md`
- Research: `research/market-and-oss.md`
- Stack + conventions: `agents.md`
- Seed corpus: `python/ingest/src/high_signal_ingest/seed/`
- Example signal: `signals/2026-04-25/example-nvda-h100-lead-time.md`
- Ingest runbook: `docs/operations/runbooks/ingest.md`
- Source coverage / launch scope: `docs/operations/source-coverage.md`
- Data ownership boundary: `docs/architecture/data-service-boundary.md`
- Seeding guide: `docs/development/seeding.md`

## Machine access

- Remote MCP: `https://api.highsignal.app/mcp` (public, read-only, Streamable HTTP)
- Daily JSON: `https://api.highsignal.app/data/daily`
- Agent catalog: `https://highsignal.app/api/ai`
- OpenAPI: `https://highsignal.app/openapi.json`

The MCP contract exposes eight stable read-only tools: `get_daily_brief`,
`get_signal`, `get_daily_dump`, `get_source_coverage`, `search_signals`,
`browse_source`, `get_track_record`, and `get_entity`. They reuse the same
cached public API reads and Today/Yesterday history boundary as the website.

## Deploy
- Web → Cloudflare Workers via OpenNext (`.github/workflows/deploy-web.yml`)
- API → Cloudflare Workers (`.github/workflows/deploy-api.yml`)
- Ingest / markets / scoring → GitHub Actions cron
- Modal remains for manual long backfills (`cd python/ingest && uv run modal run modal_app.py::manual_backfill ...`)

## Naming
Codename `high-signal` collides with High Signal Labs / High Signal HQ. Final brand TBD post-traction.

<!-- ACTIVE-AI-TASK-LOG:START -->
## Historical AI Task Log

These historical task receipts are context, not a current acceptance checklist.

- Business lane: Core/status context
- Rule: do not create another broad "improve the UI" task unless the acceptance criteria differ materially from the tasks listed here.
- Current work is tracked in this repository’s GitHub Issues; the SaaS Maker task board is retired.

- No current Active-AI product/design task from the 2026-05-25/26 loop. Treat this as watch/status unless new evidence appears.
<!-- ACTIVE-AI-TASK-LOG:END -->

<!-- portfolio-retained-work:2026-09-07 -->
## Retained work from the portfolio review

These are unresolved requirements retained at the owner’s request. They are not completed features. Work should follow a concrete need and fresh evidence.

### Harden daily freshness, Digg verification, and publishability

Verify current daily coverage, original sources including Digg, and publishability; remove evidence-strength claims unsupported by the underlying samples.

Original requirements and discussion: [#133](https://github.com/High-Signal-App/high-signal/issues/133).

## Market cron failure — 2026-09-07

[Run 34101952108](https://github.com/High-Signal-App/high-signal/actions/runs/34101952108)
persisted 391 source events, then failed its sole AI generation request across
four clusters. The existing outage guard returned exit code 3; this was not a
market-ingestion failure or a native abort. The historical log does not expose
the provider failure category, so its root cause remains unverified.

The pipeline now reports bounded generation failure categories in its summary,
audit notes and outage annotation: timeout, network, HTTP client/server/rate
limit, invalid JSON/response, or unknown/unexpected. Arbitrary exception text
and provider URLs are excluded from these categories. Tests retain exit code 3
for a total outage and allow intentional model declines or partial recovery.
No retry limits, generation/publication rules, provider config or cron schedules
changed. The cron was not rerun and no production writes or paid calls ran.

Local fixture verification: `uv run --project python/ingest --no-sync pytest
python/ingest/tests/test_generator_resilience.py
python/ingest/tests/test_pipeline_contracts.py
python/ingest/tests/test_markets_kalshi.py -q` (58 tests).
The sole open issue remains [#133](https://github.com/High-Signal-App/high-signal/issues/133),
including provider recovery evidence, scheduled-chain/Digg latency acceptance,
and claim/baseline calibration. No open issue was closed; no PR was open.

### Review-only claim qualification (2026-09-07)

The web release at `ddefa8dd` separates review observations from generated surge/adoption
hypotheses on the web. Original evidence remains inspectable, and the numeric
pipeline score no longer acts as a confidence badge. [Local and hosted release evidence](docs/operations/2026-09-07-review-sample-qualification.md).
Ordinary desktop/mobile acceptance passed, including the previously stale edge cache.
Broader API/MCP/Brief claim calibration remains in
[issue #133](https://github.com/High-Signal-App/high-signal/issues/133); this does
not make the corpus shareable. No published content or existing stash was changed.
