# high-signal — PROJECT STATUS

Last updated: 2026-08-28

## Why/What

**Thesis:** One product — a synthesized **Daily Brief** from many noisy public sources across technology, startups, and finance. Global by default; region is a free filter. The public edition has three evidence-qualified categories: (1) markets and companies, (2) business opportunities, and (3) behavior and culture. `/` is the non-personalized default; Signals, Sources, Company Universe, and Track Record provide the proof and research path. Free; no billing.

**In scope:** Daily Brief (`/` `/brief`), chronological Signals and proof pages, Sources, Company Universe, Track Record, source ingest pipeline, Markets context, Communities input, Entities, Sectors, Convergence, Unmapped gazetteer, and operator review/admin.

**Out / parked:** standalone Ideas, Opportunities, Teardowns, Featured, Personal Brief, weekly digest and cadenced publication pages; Agent Eval and Domains public surfaces; Lab UI; standalone equities, communities, and connected-brand products; broad source expansion without quality gates; paid tiers; Knowledgebase integration/dependency. High Signal's current evidence is already queryable through its Git signal store and D1 APIs; revisit only for a concrete retrieval use case those stores cannot serve.

## Dependencies

### External

- **Auth:** none for readers — the product is fully public. Cloudflare Access
  protects the bounded operator paths with the reusable `Allow Sarthak only`
  policy, and the web Worker verifies the Access JWT again before the admin
  proxy injects `ADMIN_TOKEN`. The dedicated High Signal Infisical project is
  the production secret source of truth. See ADR-014 and the Access runbook.
- **Deploy:** Cloudflare Workers — `high-signal-web`, `high-signal-api`, D1 `high-signal-db`; annotation runs in-process.
- **Email:** Cloudflare `send_email` binding (`SEND_EMAIL`) for brief delivery (plan 0009).
- **AI:** OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `HIGH_SIGNAL_AI_API_KEY`.
- **Ingest sources:** SEC EDGAR, HKEX, yfinance, Polymarket/Manifold/Kalshi/Metaculus, GDELT, RSS, Guardian, FRED, Semantic Scholar, Bluesky, Podcast Index, NVD, CISA KEV, and other adapters (see ingest pipeline). The generated catalog contains 55 source families; current stored-row and adapter-run status comes from `/data/sources` rather than a hard-coded snapshot here.
- **Optional source keys:** Guardian, SAM, Companies House, Metaculus, Bluesky, Podcast Index, FRED, Semantic Scholar, Etherscan, Token Unlocks, Artificial Analysis, OpenRouter, Libraries.io, Replicate.
- **Active source keys (set in GitHub Secrets):** `EIA_API_KEY`, `OPENSTATES_API_KEY`, `FDA_API_KEY`, `CONGRESS_API_KEY`, `FEC_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`, `LDA_API_KEY`, `USDA_NASS_API_KEY`, `REGULATIONS_GOV_API_KEY` — all via a single api.data.gov key (registered autonomously via AgentMail + Playwright).
- **Manual backfill escape hatch:** `python/ingest/modal_app.py` via `modal run`;
  it has no schedule or web trigger.
- **Env (representative):** `SEC_USER_AGENT`, `EMAIL_FROM`, `API_BASE` (brief delivery).

### Internal fleet

- **drank:** Parked Web Authority data adapter via public GitHub JSON + `pnpm drank:sync`; no public High Signal surface.
- **starboard / researchPapers:** Cross-repo ingest adapters referenced from README pipeline list.
- **Fleet AI visibility package:** High Signal consumes the reviewed
  `@saas-maker/ai-visibility` packed artifact while retaining ownership of its
  providers, D1 data, auth, schedules, routes, Daily Brief, reports, and UI.
- **SaaS Maker:** Personal command brief scripts sync tasks via `pnpm personal:brief sync-tasks --apply`.

- Next.js web app and Cloudflare Worker API monorepo are in place.
- Digg attention snapshots, Daily Brief overlays, the simplified daily/evidence
  API, and guarded public API edge caching are live. Migration `0021` is applied;
  the 30-minute collector has populated all five documented feeds; API and web
  deployment smokes passed; cold-to-warm probes returned `API-MISS` then
  `API-HIT` for both `/data/daily` and `/brief/daily`.
- Reliability hardening for issue #133 is deployed: the IST pipeline is 08:00
  ingest → 09:00 publish → 09:30
  freshness validation → 10:00 delivery; material Digg crossings trigger
  immediate original-source verification with latency receipts; one shared
  `publishability()` gate rejects future dates, prediction-only evidence,
  contradictions, impossible directions, and same-event direction conflicts;
  claim corroboration records normalized tuples and evidentiary origins; and
  observed events are stored separately from direct, supply-chain, and business
  inference fields. Migrations `0022` and `0023` are applied; API and web are
  deployed from `c228760` at 100% traffic. Production cache probes confirmed an
  API cold `MISS` followed by `HIT`, and a web cold `MISS` followed by `HIT`.
  The same release fixed the public `/signals` query's D1 parameter overflow;
  it now returns HTTP 200. The 2026-08-25 retry correctly killed all 42 weak or
  unsupported candidates, leaving the current brief empty, and the 09:30
  freshness validator initially failed because the daily dump contained no
  timestamped material evidence. On 2026-08-28, a fresh full ingest produced a
  story-pure Anthropic/Pentagon candidate with verified CNBC primary proof and
  distinct verified Axios corroboration. Auto-publish released it, and the
  current-IST validator passed with evidence five minutes old. That acceptance
  sequence was manually dispatched because GitHub's scheduled ingest did not
  arrive at 08:00 IST. Issue #133 therefore remains open for an on-time
  scheduled sequence and a genuine Digg first-seen-to-verified sample below 90
  minutes; issue #138 is closed from this positive-path receipt.
- Newspaper mode now produces a visible typography change on mobile, and the
  primary Sources navigation opens the data-source audit rather than the signal
  taxonomy. The 2026-08-25 operator-source refresh attempted all 69 configured
  sources and recorded 37 accepted plus 32 explicit no-fresh-item rejections in
  web data commit `204f16f`. The web build now copies the JSONL history into the
  Worker's asset bundle, and the deploy smoke fails if that history is missing.
- Data-directory reliability work for issue #134 and source-cadence work for
  issue #135 shipped in the 2026-08-25 source-layer release. The generated
  55-family catalog now distinguishes 21 Daily Brief sources, 3 context, 14
  weekly, 3 monthly, 5 on-demand, 2 manual, and 7 parked adapters;
  `vc-portfolios` is no longer advertised as a working adapter while its
  implementation is an empty placeholder. The daily `--source all` selector is
  bounded to the 21-source core, with separate context/weekly/monthly schedules.
  `/data/sources` separates stored history, ingestion time, non-future observed
  time, future-effective rows, and per-adapter run outcome; direct source pages
  resolve to the latest stored source day. Representative samples are opt-in,
  and the catalog summary uses a one-hour shared-cache TTL. Isolated D1 smoke
  checks proved 55-family completeness, future-date separation, exact-day data,
  invalid-date rejection, and `API-MISS` → `API-HIT` caching.
  The same cadence pass fixed NVD's rejected timestamp format, ECB/FRED CSV
  newline handling, and future-effective Legistar/OpenStates dates before those
  sources move to weekly collection.
- Operator admin session gates `/review`, `/backtest-workbench`, and community curation.
- Primary nav follows the public reading path: Brief, Signals, Sources, and Track Record. `/explore` lists only the core product, supporting research indexes, and trust/docs surfaces.
- Public/support pages include About, Methodology, Editorial Policy, API docs, Privacy, and Terms.
- The footer groups Product / Research / Operator / Legal. Review is the only operator surface linked publicly and remains protected by Cloudflare Access.
- Removed `@saas-maker/ops`, `@saas-maker/ai`, `@saas-maker/analytics-sdk`, and shared eslint/tsconfig npm deps (2026-06-20). Workers use local `ai-client.ts`; root lint uses Biome.

### Stack & commands

| Layer | Technology | Deploy target |
| --- | --- | --- |
| Web | Next.js 16, Tailwind v4, OpenNext | Cloudflare Worker `high-signal-web` |
| API | Hono, D1 binding | Cloudflare Worker `high-signal-api` |
| DB | Drizzle + D1 (`packages/db`, migrations 0000–0023; remote ledger current) | `high-signal-db` |
| Shared | `@high-signal/shared` types, scorers, composers | — |
| Ingest | Python `uv`, edgartools, yfinance, GLiNER, etc. | GitHub Actions cron + optional Modal |
| Lab (parked) | Postgres/pgvector, FastAPI (`python/lab`) | Local docker-compose only |
| Signals store | Git markdown `signals/YYYY-MM-DD/` | Sync scripts → D1 |

```
apps/web          Next.js 16 — brief, lenses, review, settings, legal
workers/api       Hono + D1 — public JSON API, admin ingest hooks, cron delivery
packages/db       Drizzle schema + SQL migrations
packages/shared   Agent-eval scorer, claim provenance, watchlist impact, OpenLens helpers
python/ingest     Daily source adapters → events/entities → signal candidates
python/lab        Local Postgres substrate (plan 0007, parked)
signals/          Append-only markdown signal cards
scripts/          D1 seed, sync, snapshots, auto-publish, test harnesses
.github/workflows cron-ingest, cron-score, cron-markets, cron-equities, cron-backtest, cron-publish, cron-validate-brief, personal-brief
```

**Data ownership:** D1 is canonical for signals, evidence, entities, mentions, agent-eval, markets, delivery, watchlists, cited URLs. Git markdown under `signals/` is human-readable source synced into D1. JSON bundles (`equities-snapshot`, `price-context`, `market-refreshes`, `known-tickers`) are derived artifacts from `data/equities-snapshot.jsonl` — not independent market-data sources. Prediction markets (`market_quotes`) are separate from equity prices.

```bash
pnpm install
pnpm dev                    # web :3000 + api :8787
pnpm dev:web | pnpm dev:api
pnpm build | pnpm typecheck | pnpm lint
pnpm test                   # all package + script test suites
pnpm db:migrate:local | pnpm db:migrate:remote
pnpm db:seed:local | pnpm db:seed:remote
pnpm product-flow:seed:local | pnpm product-flow:seed:remote
pnpm signals:sync:local | pnpm signals:sync:remote
pnpm signals:publish-drafts:* | pnpm signals:auto-publish:*
pnpm daily:snapshot | pnpm market:snapshot | pnpm price:snapshot
pnpm equities:snapshot | pnpm tickers:bundle | pnpm drank:sync
pnpm personal:brief [refresh-sources|feedback|decide|tasks|sync-tasks|report]
pnpm ingest:local | pnpm source:diagnose | pnpm source:quality | pnpm ingest:preflight
cd python/ingest && uv sync && uv run python -m high_signal_ingest.pipeline --source all --days 1
wrangler d1 migrations list high-signal-db --remote --config workers/api/wrangler.toml
```

**Deploy workflows:** `.github/workflows/deploy-web.yml`, `deploy-api.yml`. (The former standalone annotation worker was decommissioned; annotation runs in-process via `annotateLightweightNlp`.)

## Timeline

- **2026-08-28 — Canonical Reddit archive activated for High Signal and sibling products:**
  release `68a9b4c` reduced the reviewed roster to 99 communities, removed the
  remaining consumer-PC community, and made one private R2 collection the
  scheduled production source instead of running a second Reddit scrape in the
  main ingest. The versioned v2 partition stores Zstd-22 posts, relevant comment
  trees, a subreddit index, manifest, and a bounded `events.jsonl.zst` consumer
  export; `reddit/v2/latest.json` advances only after a complete full-roster run
  and byte-for-byte remote verification. The first full run completed 99/99
  communities with 2,605 posts, 50,270 comments observed, 31,569 retained, zero
  retries, and 1,140 qualified attention events. All compressed data streams
  totalled 5,381,724 bytes. Current-main CI passed, and a production Reddit-only
  ingest downloaded and hash-verified that exact export, persisted all 1,140
  events, produced zero Reddit-only signals, and finished with zero errors. An
  independent Infisical-backed consumer read also retrieved the shared
  `latest.json` pointer using the dedicated least-privilege R2 token.

- **2026-08-28 — Reddit archive recovery and removal controls completed:** the
  collector now persists a stable half-open window watermark, global stable-ID
  deduplication totals, decoded per-community line/byte ranges, and resumable
  Actions artifacts. A recovery run reuses complete communities and recollects
  only partial/failed ones on the original window. The operator-only redaction
  workflow rewrites explicitly named posts/comments, removes affected derived
  events, rebuilds hashes/indexes and conditionally advances the current
  pointer. The independent verifier reconciled the live 99-community partition:
  2,605 unique posts, 31,569 unique retained comments and 1,140 unique events;
  a no-fetch recovery reused all 99 communities and preserved those counts.
  Reddit Insights independently hash-verified the live event object, imported
  all 1,140 events across 82 represented communities, and generated a
  source-linked `r/technology` sample render without copying the raw archive.

- **2026-08-28 — Daily Reddit R2 archive canary verified end to end:** the
  scheduled archive workflow was qualified at 00:17 UTC (05:47 IST) against the
  then-planned 200-community roster. A live 10-community GitHub-hosted canary
  completed all communities with 497 posts and 11,720 comments in 455 API
  requests, with zero retries, unresolved comment continuations, or partial
  communities. Zstandard level 22 compressed the post and comment streams to
  1,223,089 bytes. GitHub Actions uploaded both streams and the manifest to the
  private `high-signal-reddit-archive` R2 bucket, downloaded the remote manifest,
  and passed a byte-for-byte comparison. The later 99-community full-run receipt
  above supersedes this rollout estimate.

- **2026-08-28 — Digg verification now fails closed on semantic mismatch:**
  threshold crossings are queued newest-first with rank, velocity, and distinct
  voices as tie-breakers, then matched against retained High Signal evidence
  before bounded GDELT discovery. Publisher retrieval uses HTML negotiation and
  transport retries, but GDELT, Digg, Reddit, Hacker News, and other social or
  attention hosts never count as proof. Broad discovery matches now require
  strong title agreement, redirected social URLs are rejected, and the Digg
  path cannot turn a deterministic review fallback into a verified candidate.
  A live audit caught and killed one draft that paired an unrelated CNBC story
  with its Reddit repost; the hardened rerun withheld all three tested clusters
  as insufficient evidence and created no replacement draft. Scheduled Digg
  verification now has the configured proof-judge credentials and balances
  fresh requests with the active feed leader instead of stale historical rank
  leaders. API release `c708b07` passed CI, deployment smoke, and a live run
  that selected the current Microduck rank leader and correctly withheld it for
  insufficient independent evidence.

- **2026-08-28 — Proof-first extraction cleared production acceptance:** a
  one-day full ingest fetched 1,268 events, collapsed 99 exact duplicates, and
  persisted one idempotent Anthropic/Pentagon candidate. Its normalized claim
  ledger has a verified CNBC primary origin and a distinct verified Axios
  corroborating origin, with no unusable support. The shared gate published the
  signal, the public daily dump exposes one signal plus two evidence events,
  the proof page resolves, and the current-IST validation passed with newest
  material evidence five minutes old. Issue #138 is closed.

- **2026-08-27 — Signal-only homepage and cost-safe agent delivery released:**
  the homepage now renders only evidence-qualified Today or Yesterday signals,
  with every card opening its proof page. Digg remains an internal attention
  and source-discovery input; its cluster feed, summaries, and attention-gap
  sections are no longer rendered as reader-facing signals. Agent discovery
  now publishes a stable MCP Server Card, Agent Skills and ARD manifests while
  preserving the three-tool read-only MCP contract. Anonymous API GETs enter a
  cached `PublicApi` entrypoint before Worker execution, while the uncached
  default gateway excludes cookies, authorization, admin, health, mutations,
  errors, and `Set-Cookie` responses. The Cloudflare zone now respects origin
  cache headers instead of overriding the API's one-minute browser TTL.

- **2026-08-26 — Public MCP released:** the API
  Worker now has a stateless Streamable HTTP endpoint at `/mcp` with exactly
  three stable read-only tools: Daily Brief for Today/Yesterday, one signal with
  complete proofs, and the canonical daily dump. Tool reads reuse the existing
  in-process Hono routes and Cloudflare Cache API, preserve the public history
  boundary, and include schema/freshness metadata. No Durable Object, database
  migration, authentication, user state, or second data path was added.

- **2026-08-26 — Public product cleanup released:**
  Company Universe remains first-class. Explore and the footer now follow the
  core Brief → Signals/proofs → Sources → Company Universe → Track Record path.
  Standalone Ideas, Opportunities, Teardowns, Featured, Personal Brief, Daily
  cockpit/history/tasks/source diagnostics, weekly digest, cadenced publication,
  Agent Eval, Domains, and Lab web routes were removed. Community curation
  remains an operator input, supported opportunities remain inside the Daily
  Brief, signal RSS remains public, and Review remains footer-only behind
  Cloudflare Access. API and web deployment smokes passed, and both Cloudflare
  Workers serve the release at 100% traffic.

- **2026-08-26 — Public reading hierarchy released:** the homepage now
  exposes Today and Yesterday directly; older Daily Briefs live in the
  chronological Signals surface rather than a separate archive. Older brief
  and signal-proof pages require a server-validated Turnstile check and a
  12-hour HTTP-only grant, while public signal APIs default to the same bounded
  two-day window. Brief signals continue to open canonical proof pages, which
  now surface observed event, direct impact, supply-chain impact, business
  inference, inference strength, claim roles, and source data when present.
  `/data` is now the Sources directory only, with every configured family and
  its latest retained rows; hit-rate remains under Track Record. Primary
  navigation is Brief, Signals, Sources, and Track Record.

- **2026-08-27 — Daily publication reliability hardened in source:** daily
  dates and dump windows now share the IST operator-day boundary; global D2C
  rotation excludes niches without collected citations; recoverable literal
  control characters in free-model JSON no longer discard structured proofs;
  and the ingest path refuses to emit a generated draft without two aligned,
  independently identified origins. `cron-publish` now requests an
  authenticated brief rebuild immediately after judging and runs the same
  public non-empty/freshness check as the 09:30 validator, so a green publish
  run proves the reader-facing edition instead of merely proving that the
  draft queue was processed. Live acceptance remains tracked in issue #131.

- **2026-08-26 — Proof-bearing signal generation completed in source:** entity
  buckets are now split into deterministic stories before generation, and
  single-origin stories remain retained as events without becoming drafts.
  Generated claims carry normalized event/amount/date fields plus per-citation
  document keys, semantic alignment, origin IDs, roles, and supported claim
  fields through Markdown, local D1 sync, and the admin sync API. The claim
  ledger only credits an origin as verified when its retained source document
  resolves and the citation is aligned primary/corroboration evidence; brief
  ranking now prefers verified independent origins and quality over direction.
  The first live replay exposed structured proofs being lost when model prose
  omitted their long URLs. Generation now retains only positively aligned proof
  URLs that exactly match supplied events and renders any missing links in a
  deterministic Proofs section; hallucinated or unaligned URLs remain excluded.
  The same replay exposed the free-AI gateway rejecting model output in JSON
  mode and a batch prompt that asked for an array under a JSON-object contract.
  Batch output now uses a `signals` object and gateway JSON-validation failures
  receive one bounded retry without response-format enforcement before the
  publication gates take over. When an AI reviewer is configured, a model
  rejection or exhausted provider call now retains the underlying events but
  cannot manufacture a generic fallback signal; deterministic fallback drafts
  remain available only for explicitly keyless/local review runs.
  Release and live acceptance receipts are tracked in issue #138; issue #133
  still requires live freshness acceptance before closure.

- **2026-08-26 — Scheduled-data credential boundary released:** the convergence
  backtest and D2C snapshot jobs now use bounded, operator-authenticated API
  routes instead of direct Cloudflare account/D1 access. Manual runs
  `32900065496` and `32900065523` completed end-to-end; D2C persisted 20 niches
  and 20 agent-visibility entries without a Cloudflare account token. Live-read
  verification then exposed legacy millisecond values in Drizzle timestamp
  columns; sync now writes epoch seconds, rejects millisecond input, and removes
  only impossible post-2100 legacy rows before idempotent replacement.

- **2026-08-25 — Daily freshness, Digg verification, and publication semantics
  released:** moved the operator-day
  sequence to 08:00/09:00/09:30/10:00 IST and added a public validator for the
  IST edition date plus a two-hour evidence ceiling. Digg rank ≤20, velocity ≥5,
  or three contributors now creates a durable verification request; the same
  collector run searches for semantically matching original publisher pages,
  retains the documents, and emits only an evidence-gated draft. A shared
  `publishability()` policy now backs signal APIs, the Daily Brief, admin
  publishing, and auto-publish. Claims carry entity/event/amount/date/direction
  tuples plus semantic alignment and originating-evidence IDs, so syndicated
  repeats can share one origin. Signal records now separate observed event,
  direct impact, supply-chain impact, business inference, strength, and the URLs
  supporting that inference. Migrations `0022` and `0023` are applied to
  production; API and web release workflows and deployment smokes passed from
  `c228760`, and direct Worker status showed that version at 100% traffic. A
  targeted same-day retry evaluated 42 candidates and published none: the
  candidates were prediction-only, single-origin, conflated, irrelevant, or
  otherwise below the shared gate. The freshness validator then failed because
  the daily dump had no qualifying timestamped evidence, so issue #133 remains
  open even though the release machinery and fail-closed behavior are working.

- **2026-08-23 — Corroboration was decided by an independent-publisher
  test:** `buildHistoricalClaimBackfill` promotes the first later evidence link
  to `corroboration` when it clears `isIndependentCorroboration` — a different
  publisher host from the primary, HTTP(S), and not one of the four
  prediction-market domains. Same-host links, market links and non-citations
  stay `context`, and only one link is promoted so the count reflects a decision
  rather than a source tally. Promoted links record
  `basis: 'independent_publisher'` on their timeline event, because this asserts
  source independence and not a read-and-confirmed semantic match; a judge that
  reads the text, or an operator demotion, can still override. This unblocks the
  deadlock that kept the brief empty: the backfill previously assigned only
  `primary` + `context` while the per-item gate required
  `corroborationCount >= 1`, so no backfilled claim could publish. The gate
  itself is unchanged. `POST /admin/claims/backfill` still has to be run per
  signal against the 3,038-row signal table to populate `claim_records`.
  **Superseded 2026-08-25:** host diversity no longer promotes corroboration;
  semantic alignment and distinct originating-evidence IDs are mandatory.

- **2026-08-22 — Twelve-day silent brief outage diagnosed; publish gate now
  withholds items, not editions:** the global edition published nothing from
  2026-08-11 to 2026-08-22 and rendered as "no qualifying items", which reads as
  a quiet day rather than an outage. Cause: `buildBriefEditionReceipt` is
  all-or-nothing (`publishable = issues.length === 0`), so one failing item
  silenced the edition, `precomputeBriefSnapshots` wrote no row at
  `console.warn`, and `/brief/daily` 404'd. `pruneUnpublishableBriefItems` now
  withholds failing items at full gate strength while publishing the rest;
  section-level failures (fixture content, unavailable category) stay fatal, and
  a category emptied by pruning records `items_withheld_by_publish_gate` so
  "withheld" stays distinguishable from "found nothing". Rejections log at
  `console.error`, and `scripts/verify-daily-brief.mjs` fails `cron-validate-brief`
  when a reader would get an empty brief. **Still empty in production:**
  `claim_records` and `claim_evidence_links` hold 0 rows against 3,038 signals,
  so every stock item is dropped for want of provenance. `POST
  /admin/claims/backfill` populates them per signal, but
  `buildHistoricalClaimBackfill` assigns roles `primary` + `context` and never
  `corroboration`, while the per-item gate requires `corroborationCount >= 1` —
  so backfilled claims still cannot publish. Promoting a second aligned source
  (operator review or an automated independence judge) is the open decision.
- **2026-08-22 — Cloudflare Access operator gate released:** replaced the
  password-session implementation with
  cryptographically verified Access JWTs, made `CF_Authorization` a shared-cache
  bypass, disabled both Workers' `workers.dev` and preview hostnames in tracked
  config, and moved the public API to `api.highsignal.app`. The `High Signal
  Operator` Access application protects four bounded path families with the
  reusable operator-only policy and a 12-hour session; the Worker tracks the
  public AUD/team identifiers and validates the origin assertion. ADR-014 and
  the Access runbook are current. The dedicated Infisical project now owns the
  production API/source/AI values, `ADMIN_TOKEN` was rotated across both
  Workers, GitHub Actions, and Modal, and the obsolete password/session/Clerk
  Worker secrets were removed. A bounded Modal replay persisted production
  audit row `b9bb1c6d00e7d9dd` with zero errors.

- **2026-08-22 — Per-user surface removed; one public product, one operator gate
  (shipped and deployed):** deleted Mentions, Watchlists, email brief delivery,
  and saved Agent Eval history, and removed Clerk entirely. Every readable
  surface is now anonymous and cacheable; the only gate is a single operator
  session (password → signed httpOnly cookie) fronting the `/api/admin` proxy,
  which injects `ADMIN_TOKEN` server-side so it never reaches the browser.
  Migration `0020` drops 18 tables. Kept: the community lens (its
  `tracked_communities` registry is operator curation the public brief's
  Behavior & Culture section reads, so its CRUD moved behind `ADMIN_TOKEN` in
  `routes/admin.ts`), and Agent Eval as a stateless public tool. `/personal` is
  now gated and `noindex`; `/track-record` stays public. `?owner=` no longer
  fragments the brief's edge cache, and `hs_admin` is registered as a
  cache-bypass cookie. Rationale: ADR-013. Migration `0020` was applied to
  remote D1 with all 18 removed tables confirmed empty, and both Workers were
  deployed at `7f6c683`. The password gate was superseded and removed by the
  ADR-014 release above.

- **2026-08-11 — Cadenced feeds and public-data parity (local, not deployed):**
  added exactly four public feed definitions with honest supported cadences: The
  Brief and Markets & Companies at daily/weekly/monthly, Opportunity Radar and
  Behavior & Culture at weekly/monthly. New `/brief/feeds/*` API and `/feeds/*`
  reader routes compose bounded UTC periods only from accepted daily snapshots,
  de-duplicate stable items, retain contributing daily provenance, and expose
  configured-versus-contributing evidence coverage plus material gaps. Anonymous
  feed JSON and HTML use matching five-minute browser, one-hour shared, and
  one-day stale-while-revalidate policies; authenticated HTML bypasses the edge
  cache. Brief and Newspaper are local-only presentation modes over identical
  content and cache identity. `/methodology/data-parity` maps implemented public
  capabilities to seven discussed reference tools and explicitly excludes
  premium/licensed and restricted-social claims. Focused shared/parity/API
  tests, typechecks, browser checks, and design review pass; production is unchanged.
- **2026-08-11 — Daily Brief becomes the public starting point:** `/` now renders
  the current evidence-qualified edition and `/brief` permanently redirects to
  it, with archive and dated routes preserved. Public composition contains only
  the three market/company, opportunity, and behavior/culture categories; it
  fails closed to explicit empty or unavailable states instead of using seed or
  personalized fallback content. Structured primary-plus-independent-
  corroboration evidence, complete inline editorial summaries, and an edition-
  level receipt gate new archive writes. The primary navigation now follows
  Brief → Signals → Track record → Sources, and anonymous root HTML uses a
  versioned five-minute edge cache so the retired landing page cannot survive a
  deploy. The production bundle no longer overlays the retired Astro index,
  the `/brief` compatibility redirect bypasses legacy HTML cache entries, and
  browser responses revalidate while the five-minute shared edge cache remains
  warm.
- **2026-08-09 — Shared lint baseline:** Adopted the Fleet Ultracite baseline
  for core TypeScript, React, Next.js, and test code. Explicit compatibility
  exceptions preserve current behavior while 377 files pass with zero
  diagnostics; generated data, artifacts, Astro, Python, signals, migrations,
  and other existing non-application surfaces remain outside the check.
- **2026-08-06 — Worker CPU cache hardening:** anonymous dynamic company
  profiles, History, sitemap XML, and the daily-range JSON now enter the
  guarded edge cache after the first successful render. Authenticated and
  `Set-Cookie` responses still bypass storage, cached responses stream without
  whole-body buffering, and bundled company profiles no longer pay for a D1
  lookup before rendering.
- **2026-08-05 — Agent Markdown crawl capacity:** canonical anonymous `.md`
  responses now enter Cloudflare's edge cache after the first successful
  OpenNext render, while authenticated, query-bearing, HEAD, noindex, and error
  responses keep their prior uncached behavior. Cache hits preserve the public
  five-minute browser and one-hour shared freshness contract. Production
  verification covered 35/35 catalog surfaces and a deterministic 250/250
  sample across 5,504 sitemap routes with zero failures.
- **2026-08-05 — Entity-month discovery parity:** entity-month pages now load
  their published, evidence-qualified signals through the same bounded
  entity-and-date query used by the public signal API. Older eligible archives
  no longer become noindex/agent-404 pages merely because they fall outside an
  entity endpoint's latest-20 response.
- **2026-08-05 — Public intelligence intent cluster:** added four evidence-led
  guides for daily briefs, startup intelligence platforms, founder market
  intelligence, and technology-trend intelligence; expanded the existing SEO
  agent audit with a clearer readiness-versus-awareness explanation. All five
  surfaces retain the incumbent High Signal shell, expose visible evidence
  receipts and page-matched structured data, and participate in the canonical
  sitemap, Markdown alternates, agent catalog, homepage, and Explore directory.
- **2026-07-31 — Public landing search semantics tightened:** shortened the
  homepage title and description to crawler-safe lengths, promoted the visible
  brief label into the page heading hierarchy, and clarified the verification
  promise without changing the landing layout or product scope.
- **2026-07-31 — Public agent boundary corrected:** removed the sign-in-only
  Mentions lens from the public sitemap and agent catalog while retaining the
  authenticated product route.
- **2026-07-31 — Daily Brief read-time quality gate:** legacy published stock
  rows now need two unique citations and cannot rely only on prediction-market
  evidence; live community ideas and trends need a valid HTTP(S) source thread.
  Weak rows are skipped and the existing cited seed fallback preserves section
  completeness. Existing direct/family/early hit-rate context remains inline.
  No schema, migration, remote data mutation, or deployment was performed.
- **2026-07-31 — Curated source promotion:** promoted nine recurring unmapped
  consumer/software entities into the seed gazetteer, made Apple and Google
  review events carry explicit entity IDs, and added Gemini and Copilot to
  those bounded existing adapters. Generic `cursor` prose remains unmapped to
  avoid a broad false-positive alias. No new source, dependency, migration,
  remote sync, or deployment was added.
- **2026-07-31 — Event semantics contract:** documented the existing Python
  `Event` type and D1 `events` table as normalized source observations, with
  actionable conclusions beginning at `SignalCandidate` and `signals`.
  `normalized_events` remains reserved for a future separately specified model;
  no schema, migration, or runtime behavior changed.
- **2026-07-31 — Bounded web Worker routing:** verified immutable Next.js,
  Astro, docs, discovery, and icon assets now bypass Worker-first execution,
  while application, authenticated, personalized, API, and write routes remain
  on the OpenNext Worker. The request-independent `/history` route is
  prerendered, and the focused routing contract plus Cloudflare build guard the
  boundary. No application deployment was performed.
- **2026-07-31 — Public SEO/GEO route contract:** centralized the 32
  canonical static reader routes and seven large-corpus route templates used by
  the sitemap and Worker. Every canonical public HTML route now supports a
  `.md` alternate and `Accept: text/markdown` by rendering the same
  server-side product output as the human page. The compact `/api/ai` catalog
  separates static surfaces, dynamic templates, and feeds/data resources;
  review, admin, auth, personal, delivery, search, and non-HTML endpoints fail
  closed outside the public Markdown boundary. Source checks, local Worker
  probes, the OpenNext/Cloudflare build, and Wrangler dry-run pass. Production
  remains unchanged until a manual deploy.
- **2026-07-29 — Owned product changelog:** added a same-origin
  `/changelog` that turns verified shipped milestones into concise,
  user-visible outcomes. The site footer now makes it discoverable and routes
  Roadmap to GitHub Issues and Source to the canonical repository; no runtime,
  data, or deployment behavior changed.
- **2026-07-25** — Cancelled the deferred Knowledgebase integration plan. High
  Signal does not currently need private-corpus search: its public evidence,
  signals, and Daily Brief already use the product-owned Git + D1 path.
  Read-only production verification found successful ingest and publish
  workflows on each of the last 12 days, 25–33 publishable signals per day over
  the latest eight-day window, and a populated five-section Daily Brief. The
  same audit found one future-dated row and prediction-market-only rows entering
  through publishing paths outside the daily draft judge; that bounded quality
  follow-up is tracked in `STATUS.md`. No deploy, migration, or production
  change was made.
- **2026-07-25** — Replaced High Signal's duplicated AI-visibility analysis,
  judge, aggregation, and reporting internals with the framework-independent
  Fleet package. Product-owned D1, auth, providers, schedules, APIs, Daily
  Brief, reports, and customer UI remain in High Signal. Adapter/Mention parity,
  TypeScript, docs, web build, and CI passed; no deploy, migration, credential,
  or production-config change was made.
- **2026-07-25** — Cancelled the unimplemented public AI Evidence Report
  proposal. High Signal remains focused on its existing private monitoring,
  Mentions, briefs, and evidence surfaces rather than adding a public report
  product.
- **2026-07-13** — Applied and verified remote D1 migrations `0014_intent_opportunities.sql` and `0019_delivery_retry_schedule.sql`. The migration ledger reports no pending migrations; the intent table and three indexes, retry-schedule index, and `delivery_log.next_attempt_at` column are present. No Worker deploy, provider/DNS setup, secret, production config, or mail send was performed.
- **2026-07-13** — Completed plan 0012's remaining local acceptance: open buyer/community intent now enriches Daily Brief section 4 with each brand's strongest source-linked finding and section 5 with deduplicated, reviewable actions. Intent loading fails independently. Web and delivery output retain stage, platform, score, action, and source. Migration 0014 was verified locally and is now applied to remote D1.
- **2026-07-13** — Closed plan 0009's remaining local acceptance gaps. Failed email rows are now owner-scoped and manually retryable from `/settings/delivery` through a conditional failed→queued claim; RSS preferences issue stable opaque tokens for private daily-brief RSS/Atom feeds; signed-in users can read the versioned compact daily-brief JSON contract; and automatic failures persist exact retry eligibility at 15 minutes, 1 hour, and 4 hours before the fourth total attempt becomes terminal. Existing public weekly feeds remain unchanged without a token. Additive migration `0019_delivery_retry_schedule.sql` is applied to remote D1; the Worker change has not been deployed.
- **2026-07-13** — Completed the remaining local-code follow-ups for plans 0008 and 0010. Auto-publish now prefers structured claim links with an explicit legacy fallback; `/review` lazily and idempotently backfills historical claims; stock items expose compact “why this is here” provenance; and signed-in briefs compose up to five suppression-aware direct/one-hop watch impacts, omitting any item without evidence-backed claim linkage. No migration, production config, or deploy was run.
- **2026-07-13** — Added the versioned public `GET /learning/daily` feed for the Fleet unified-learning pipeline. It reuses the canonical Daily Brief composer in-process, emits only compact stock/idea/trend learning items with citations, and deliberately excludes owner-specific perception and improvement sections. Focused API typecheck and full worker test suite pass.
- **2026-07-05** — Added **India D2C Opportunity Pipeline** (plan 0013, Slices 1 + 2). 20 hand-curated India D2C niches → deterministic 0–100 opportunity score → `test / watch / avoid` verdict → `OpportunityBriefPayload` rendered in `/opportunities` (new "India D2C Opportunity Briefs" section) and Daily Brief section 02 (3 briefs for `south-asia`, 1 rotating for `global`). Reuses the existing Opportunity Brief contract — no new component, no D1 migration (JSON artifacts first per the PRD). New `packages/shared/src/content/d2c-opportunities.ts` (seed + `scoreD2CNiche` + `verdictForScore` + `composeD2COpportunityBrief` + `d2cBriefItems`); weekly Python collector `python/ingest/.../d2c_opportunities.py` pulls Reddit/HN/Product-Hunt samples for the 20 niches and writes cited JSON artifacts under `data/d2c-opportunities/`; `scripts/d2c-opportunities-bundle.ts` bundles the latest artifact into the shared package so the worker renders cited evidence without a runtime fs read. Fragile sources (Google Trends, Meta Ad Library, marketplace pages) degrade to `null` with a `freshnessDate`. No impuls8 data read or redistributed; no paid source dependency. Tests: `d2c-opportunities` (TS, 32) + `test_d2c_opportunities.py` (10). Run: `pnpm d2c:collect` then `pnpm d2c:bundle`. Slices 3 (scoring history + D1 persistence) and 4 (agent-visibility overlay) deferred.
- **2026-07-13** — Completed plan 0011's remaining local-code follow-ups: `/mentions` now uses topic/prompt product language, completed mention checks rebuild cited-source evidence independently from intent-opportunity refresh, and visibility reports support owner access or a deterministic brand-scoped HMAC share token. Token creation is owner-gated and token reads fail closed without the existing server signing secret. Migration `0012_cited_url_index.sql` remains an operator apply step; no migration, secret, config, or production change was performed.
- **2026-07-08** — Added **India D2C Opportunity Pipeline Slices 3 + 4** (plan 0013). **Slice 3 — D1 persistence + history:** migration `0016_d2c_opportunities.sql` adds `d2c_niches`, `d2c_niche_snapshots`, and `d2c_agent_visibility` tables (additive, no changes to existing rows). Drizzle schema added in `packages/db/src/schema.ts`. New pure functions in `@high-signal/shared`: `computeD2CDelta` / `computeD2CDeltas` (score delta + verdict-change trend: new/improved/degraded/stable), `assessAging` (aged-well / aged-poorly / stable / insufficient-history), `verdictImproved`, `buildSnapshotRecord`. `scripts/sync-d2c-opportunities.ts` loads the latest JSON artifact into D1 (idempotent upsert by niche + snapshot_date). New `GET /d2c/opportunities` and `GET /d2c/opportunities/:slug` routes read from D1 with seed-fallback. `/opportunities` page now fetches the live API and renders score deltas (±N wk), verdict shifts, and aging. `.github/workflows/cron-d2c-opportunities.yml` runs the weekly Monday 07:00 UTC pipeline: collect → bundle → sync → commit. **Slice 4 — agent-visibility overlay:** `python/ingest/.../d2c_agent_visibility.py` asks each configured AI assistant "What are the best <category> brands in India for <target user>?" for all 20 niches, extracts recommended brands + cited URLs, computes a 0–1 gap score (0 = saturated, 1 = wide-open), and writes `data/d2c-agent-visibility/<YYYY-MM-DD>.json`. `scripts/sync-d2c-agent-visibility.ts` persists the overlay into D1. `GET /d2c/agent-visibility` returns the latest run. The Opportunity Brief now overrides the weekly snapshot's `agentVisibilityScore` with the more-recent overlay gap when available, and `/opportunities` renders "AI recommends: <brands>" or "no brand named — wide-open" per niche. New pnpm scripts: `d2c:agent-visibility`, `d2c:sync`, `d2c:sync:remote`, `d2c:sync-av`, `d2c:sync-av:remote`. Tests: +22 TS (d2c-opportunities now 54) + 10 Python (`test_d2c_agent_visibility.py`). Full `pnpm typecheck` + `pnpm test` + `pnpm lint` + `uv run pytest` + `uv run ruff` green.
- **2026-07-05** — Added **Opportunity Briefs** to Daily Brief section 02. Business ideas now carry a decision-grade payload with `enter/test/watch/avoid` verdict, confidence, target user, problem, market-timing reasons, evidence mix, competitor/pricing/agent-visibility notes, risks, next validation step, and prior hit-rate context when available. Seed fallback ideas demonstrate the full workflow in empty-D1/anonymous views; live community-digest ideas receive conservative validation-oriented defaults until deeper source extraction is added. No migrations, new dependencies, or provider keys.
- **2026-07-09** — Added `/case-studies` as a generated High Signal company-universe surface with individual pages at `/case-studies/[slug]` and paginated index pages at `/case-studies/page/[page]` (50 companies/page). The initial artifact contained **2,181 companies** from a16z, Bessemer, Sequoia, and VCBacked sources. Added D1 persistence in migration `0017_company_universe.sql` plus `pnpm company-universe:sync` / `pnpm company-universe:sync:remote`; API reads are exposed at `/company-universe` and `/company-universe/:slug`. The static JSON remains a build/cache artifact, not the long-term source of record.
- **2026-07-15** — Rebuilt and released the company universe around the requested quality boundary: **only official YC, Antler, a16z, and Techstars directories**. Removed VCBacked, Sequoia, and Bessemer inputs and the 2,200-row cap. Current artifact: **12,964 unique companies** from 13,485 first-party evidence records — YC 6,043, Antler 1,237, a16z 1,099, Techstars 5,106; 397 companies retain multiple selected affiliations. YC and Techstars counts reconcile exactly with provider-reported totals. Added source-level coverage metadata and fail-closed validation, preserved cohort/program/location evidence, and replaced quadratic competitor matching with bounded deterministic indexes; all 12,964 companies have at least one mapped competitor. Added server-rendered search across company descriptions, categories, source affiliations (including YC/a16z aliases), cohort/program/location, and extracted product facets, with the exact UTC last-updated time and an explicitly manual refresh model. A manual local GLiNER pass now extracts **42,669 product/use-case/customer/industry/technology facets across 11,959 companies**; company pages expose those facets and local similar-company clusters with descriptions and deterministic match reasons. The post-enrichment materializer now stores **34,248 reciprocal similarity edges** across every company with a six-peer cap: every displayed A → B recommendation is guaranteed to appear as B → A with identical score/reason metadata. Weak cross-category matches and matches supported only by generic descriptive prose are rejected. Screenpipe is present from official YC evidence and now links reciprocally to Airweave rather than generic cohort or in-memory-database peers. Production D1 stores the full 12,964-company evidence graph and 68,496 directed reciprocal rows; the web build consumes a generated **19.6 MB** runtime snapshot that retains search metadata, NER facets, scores, and reasons while full source evidence is read from D1. This keeps the OpenNext handler at **42.8 MB**, below Cloudflare's 64 MiB uncompressed Worker limit.
- **2026-07-15** — Search now returns **20 companies per page in global match-score order** rather than a fixed top slice. Query-aware previous, next, and numbered links retain the search terms; invalid pages normalize and stale out-of-range pages clamp to the last ranked page. Search submission and page navigation use visible spinner/status pending states with accessible announcements while retaining native GET URLs as fallbacks. Production search runs through the existing API service binding and D1 system of record: token-AND filtering and weighted name/description/category/affiliation/evidence ranking happen in SQL, only the current 20 companies and their three materialized peers cross into the web Worker, and the search route no longer deserializes the 19.6 MB profile artifact. Remote-preview measurements were 0.5–0.6 seconds for narrow/institution queries and 1.4 seconds for the broad 6,305-match `AI` query. Static directory/detail pages retain the generated artifact; full materialized-cluster resolution there uses a lightweight cached slug map and dropped from 224 ms to 1.6 ms locally.
- **2026-07-09** — Added **company lookup/create** for `/case-studies`. Migration `0018_company_lookup_create.sql` adds on-demand metadata (`status`, `domain`, `requested_by`, `requested_at`, `last_enriched_at`) to `company_universe_companies`. `POST /company-universe/lookup` now normalizes a submitted company name/domain, returns an existing D1 company when matched, or creates a `pending_enrichment` company with operator-submitted provenance and deterministic first-pass competitor edges from the D1 company universe. `/case-studies` includes a lookup form, and `/case-studies/[slug]` falls back to live D1 data for lookup-created companies while still serving generated artifact companies. Production migration/sync not run in this session.
- **2026-07-04** — **AI Visibility (GEO) upgrade** to close the gap vs pure-play GEO tools (Value AI Labs, Peekaboo). Turned the Mentions lens from a single-endpoint, regex-graded check into a real GEO product: (1) **multi-model fan-out** — `resolvePlatforms` runs each prompt across every configured provider (ChatGPT/Gemini/Perplexity/Claude via OpenAI-compatible endpoints), tagging real platforms instead of one `custom` bucket; single-endpoint fallback preserved; (2) **LLM-judge analysis** — `mention-judge` grades each answer (negation-aware sentiment, prose ranking, real recommendation, citations) with the deterministic analyzer as fallback; (3) **persona segmentation** — migration `0015_mention_personas.sql` adds `persona` + `brand_recommended` + `judge_reasoning`; visibility sliceable by buyer persona; (4) **packaged AI Visibility Report** — `composeVisibilityReport` returns a 0–100 score + grade, per-model × per-persona breakdown, share-of-voice vs competitors, citation gaps ("sources AI trusts that aren't you"), and prioritized recommendations, on `GET /products/mentions/:brandId/report`. Also fixed a latent bug: competitor share-of-voice keyed on `[object Object]` because `toMentionRows` cast competitor objects to strings. New suite `ai-visibility` (30 tests); 16 → 17 suites. **Operator step to light up multi-model:** set `OPENAI_API_KEY` / `GEMINI_API_KEY` / `PERPLEXITY_API_KEY` / `ANTHROPIC_API_KEY` on `high-signal-api`; without them it runs single-endpoint as before. Agent-Eval multi-model fan-out deferred (Mentions powers the report).
- **2026-07-04** — Completed plan 0009 brief email delivery (wired the sweep into the `*/30` `scheduled()` cron, live-brief compose, HMAC one-click unsubscribe, 3-strike auto-disable; fixed 3 typecheck errors that left the feature non-compiling). Added `rankEvidenceUrls` to fix a credibility-critical defect: brief citations were leading with off-entity/low-authority sources (Bajaj article under HCL, crates.io under Alphabet, Manifold markets under Intel). Then fixed the root cause upstream in the Python generator: title-weighted attribution with a min-strength floor + a conservative evidence-relevance filter, so off-entity events are no longer attributed or cited (Planned #14, DONE). Then two ranking/guard follow-ups: prediction markets are demoted below all non-market evidence in `rankEvidenceUrls` (crowd opinion never leads), and `buildStocks` drops prediction-market-only signals at read time (canonical `isPredictionMarketOnly` lifted into `@high-signal/shared`, shared with `auto-publish-rules.ts`). **Merged (PRs #34/#35/#36) and deployed to production** (`high-signal-api` + `high-signal-web` Workers); verified live: the market-only Intel signal is gone, Alphabet/HCL lead with on-topic sources, 0 market-only signals in the brief. Test suites 15 → 16 (TS) + `test_entity_attribution.py` (11, Python); `evidence-ranking` 19.
- **2026-07-02** — Added `app.onError()` global error handler to API worker (`workers/api/src/index.ts`).
- **2026-06-09:** Production deploy verified (web + api Workers).
- **Migrations 0000–0007:** Applied; canonical D1 schema for signals, evidence, entities, markets, etc.
- **Migrations 0008–0013:** Applied to remote D1 (2026-06-28). 0008 was manually applied earlier (column + index existed); marked as applied and 0009–0013 applied via `wrangler d1 migrations apply --remote`.
- **Plan 0007:** Lab substrate — partial (local docker Postgres, HN ingest, scorer, FastAPI feed); parked as product infrastructure.
- **Plans 0008–0011:** Claim provenance, brief delivery, watchlists, and OpenLens visibility are wired. Plans 0008, 0010, and 0011 local-code follow-ups are complete; remaining external/operator work is tracked separately.
- **2026-06-30:** Added and scaffolded plan 0012 after reviewing Octolens, Peekaboo, and Subreddit Signals. Decision: beat them by combining AI visibility, citation/source gaps, community buyer intent, proof tasks, and Daily Brief/report outputs instead of copying separate social-listening, GEO, or Reddit-lead dashboards.
- **2026-07-02:** Revamped `/` and `/brief` first viewport around the product loop: market change, buyer intent, AI visibility, and proof gaps. The UI now uses a sharper Aceternity-inspired dark grid treatment while keeping the app surface evidence-first and dense.
- **2026-07-03:** Collapsed the active product shell around data, signals, history, and evals. `/` now renders the signals feed, with Global / US / China / India scopes, default company/idea focus lists, and a fixed sidebar. `/data` is a compact clickable source directory: only sources with stored events open, and they open the latest available source-day view. Signal detail pages link cited evidence back to source-day data when the evidence source maps to the catalog.
- **README status date (2026-05-30)** lags this file for day-to-day scope; `PROJECT_STATUS.md` + `package.json` scripts are authoritative.

## Products

| Product surface | Route / entry | Role |
| --- | --- | --- |
| Daily Brief | `/`, `/brief` | Today and yesterday across three evidence-qualified categories |
| Signals & proofs | `/signals`, `/signals/[slug]` | Chronological record and detailed source-backed proof pages |
| Sources | `/data`, `/data/[source]` | Source inventory, cadence, health, and latest retained data |
| Company Universe | `/case-studies` | Source-backed company directory and profiles |
| Track Record | `/track-record` | Public ledger of matured directional calls |
| Intelligence guides | `/daily-intelligence-brief`, `/startup-intelligence-platform`, `/market-intelligence-for-founders`, `/technology-trend-intelligence` | Evidence-led public explanations for core search intents |
| Markets context | `/markets` | Prediction-market context (not equity prices) feeding the brief |
| Communities input | operator-only | Tracked-subreddit digests → brief sections 2–3 |
| Convergence | `/convergence` | Multi-source entity aggregation + market overlay |
| Unmapped gazetteer | `/unmapped` | Ticker/bare-entity candidates for enrichment |
| Operator / admin | `/review`, `/admin/*` | Review queue, ingest hooks, delivery admin |
| Legal & docs | `/about`, `/methodology`, `/methodology/data-parity`, `/privacy`, `/terms`, `/api-docs` | Public trust and data-parity surfaces |

## Features (shipped)

### Product shell & navigation

- Primary nav is Brief, Signals, Sources, and Track Record.
- `/explore` contains only the core product, research indexes, and trust/docs surfaces.
- Footer is grouped Product / Research / Operator / Legal; Review is footer-only and Access-protected.
- Public pages: `/about`, `/methodology`, `/editorial-policy`, `/api-docs`, `/privacy`, `/terms`.
- Agent-readable public corpus: 28 static surfaces plus dated briefs, signals,
  signal taxonomies, entities, entity-month archives, case studies, and
  company-universe pagination share the same server-rendered source as HTML;
  private/operator and non-HTML routes are excluded by tested route rules.
- Successful anonymous canonical Markdown responses are cached at the edge
  before repeated OpenNext work; public content, eligibility, and TTL remain
  identical on misses and hits.
- Four public intelligence guides use one typed content registry and reusable
  renderer, with visible evidence receipts, breadcrumbs, contextual product
  links, page-matched JSON-LD, canonical metadata, and Markdown parity.
- Region picker and seed product pickers on brief; no sign-in anywhere.
- SEO JSON-LD tests (`pnpm seo:test`).

### Daily Brief

- `/` and `/brief` render five sections with hit-rate inline on stock claims.
- Public stock cards enforce two unique citations at read time and reject
  prediction-market-only evidence; live community ideas and trends require a
  valid source thread before entering the brief.
- Worker `GET /brief/daily?region=&owner=` composes from D1 with seed fallback.
- Worker `GET /learning/daily` publishes a compact versioned learning feed derived from public brief sections only.
- Section 02 ideas now render Opportunity Brief context: verdict, confidence, target user/problem, evidence mix, why-now, risk, next validation step, and prior hit-rate where present.
- Today and yesterday are selected on the homepage; earlier records live under Signals. Signal RSS/Atom and the complete daily JSON API remain available.
- Convergence callout above composer pulls multi-source entity hits + prediction-market drift.

### Signals, evidence, track record

- D1 tables: `signals`, `evidence`, `score_runs`, `entities`, `relationships`, `events`, `source_documents`.
- Git-versioned markdown store; `pnpm signals:sync:*` scripts.
- Public routes: `/signals`, `/signals/[slug]`, `/signals/types`, `/signals/types/[type]`, `/embed/[slug]`.
- `/signals` supports Global / US / China / India scopes plus company/idea focus lists. Signed-out users get a default watchlist for immediate testing; signed-in users can replace it with configured mention brands.
- `/signals/[slug]` shows confidence score, confidence band, source-class reasons, quotes/excerpts, and source-day links back into `/data/:source?date=YYYY-MM-DD` when the evidence maps to the catalog.
- Worker: `GET /signals`, `/signals/facets`, `/signals/:slug`, `/signals/by-entity/:entityId`.
- Review queue `/review`; auto-publish rules (`scripts/auto-publish-drafts.ts`, 29+ rule tests).
- Track record: `/track-record`, `/track-record/labels`, `/backtest-workbench`.
- Worker: `GET /track-record`, `/cohorts`, `/series`, `/workbench`, `/labels`.
- Label backtest replayed weekly by `cron-backtest.yml`.

### Plan 0008 — Signal provenance editor

- Migration `0009_claim_provenance.sql` — **Applied to remote D1** (2026-06-28).
- Tables (local schema): `claim_records`, `claim_evidence_links`, `claim_timeline_events`.
- Shared helpers: `packages/shared/src/claim-provenance.ts`.
- Read routes: `GET /claims/:id`, `GET /claims/by-signal/:slug`.
- Admin write routes: POST/DELETE claim evidence, status, corrections.
- Web: inline provenance editor on `/review`; public provenance section on `/signals/[slug]`.
- Auto-publish consumes structured evidence when claims exist; `/review` lazily backfills historical signals through an authenticated idempotent route; stock brief cards expose compact provenance.
- Tests: `scripts/claim-provenance.test.ts` (36 unit tests) plus structured auto-publish coverage.

### Plan 0009 — Brief distribution (local surfaces complete; gates below)

- Migration `0010_brief_delivery.sql` — **Applied to remote D1** (2026-06-28).
- Migration `0019_delivery_retry_schedule.sql` — **Applied to remote D1** (2026-07-13); adds nullable `delivery_log.next_attempt_at` plus its retry-schedule index.
- Tables: `delivery_preferences`, `delivery_log`, `delivery_snapshots`.
- Worker `/delivery/*`: preferences, log, test, owner-scoped manual retry, compact JSON, cron `POST /delivery/internal/run`; automatic failures persist and enforce the 15m/1h/4h retry schedule, with attempt four terminal.
- Email: Cloudflare `send_email` binding; MIME in `workers/api/src/lib/email.ts`.
- Next.js proxy: `/api/delivery/[...path]`.
- Private feeds: stable opaque per-user RSS token; token-authenticated daily-brief RSS/Atom while no-token requests retain the public weekly digest.
- Web: `/settings/delivery` with failed-row retry and private-feed controls, `/admin/delivery`; admin summary `GET /admin/delivery/summary`.
- Tests: `scripts/brief-delivery.test.ts` (54 assertions) plus worker delivery-completion contract/auth/feed/schedule coverage (214 worker tests total).

### Plan 0010 — Entity watchlists & impact chains

- Migration `0011_watchlists.sql` — **Applied to remote D1** (2026-06-28).
- Tables: `watchlists`, `watchlist_entities`, `watchlist_suppressions`, `watchlist_delta_log`.
- Worker `/watchlists/*`: list/create, add/remove entities, suppressions CRUD, `GET /:id/impact`.
- Next.js proxy: `/api/watchlists/[...path]`.
- Web: `/watchlist/entities`, `/watchlist` hub; "Watch" on `/entities/[id]`.
- Shared impact composer: `packages/shared/src/watchlist-impact.ts`.
- Signed-in `/brief/daily?owner=...` responses include a fault-isolated `watching` block; every surfaced item is linked to an evidence-backed claim and renders relationship/provenance context in `/brief`.
- Tests: `scripts/watchlist-impact.test.ts` (22 unit tests).

### Plan 0011 — OpenLens visibility (scaffolded)

- Migration `0012_cited_url_index.sql` — **Applied to remote D1** (2026-06-28).
- Table: `cited_url_index`.
- Worker under `/products/mentions/:brandId/*`: visibility-matrix, share-of-voice, cited-sources, trends, report.
- Worker: `GET /products/agent-eval/:auditId/attributes`.
- Shared: `packages/shared/src/openlens-visibility.ts`.
- Web: `/mentions/[brandId]` (visibility, sources, trends, report tabs); `/agent-eval/[auditId]/attributes`.
- Tests: `scripts/openlens-visibility.test.ts` (32 focused assertions).

### Plan 0012 — AI visibility and Reddit intent response (local acceptance complete)

- Competitor references: Octolens (broad social listening, API/webhooks/MCP, Slack/email), Peekaboo (AI visibility score, AI-engine tracking, citations/content pickup, GSC/Looker/GA/CMS integrations), Subreddit Signals (Reddit buyer-intent classification, subreddit discovery, reply guidance, managed service).
- Product decision: do not create three standalone products and do not reopen a broad "steal list." Most primitives already exist in Mentions, Agent Eval, plan 0011, `opportunities.py`, and brief sections 4/5.
- Migration `0014_intent_opportunities.sql` — **Applied to remote D1** (2026-07-13; additive table + indexes, no existing-row changes).
- Worker routes under `/products/mentions/:brandId/intent-opportunities`: list, refresh from recent D1 community events, best-effort Agent Eval evidence-task linking, status update, and optional AI reply-draft generation. Mention checks also trigger a defensive background intent refresh.
- Web: `/mentions/[brandId]?tab=intent` renders the brand intent inbox with refresh, draft, done, and dismiss actions; linked evidence tasks are indicated inline; report tab includes top open intent items.
- Daily Brief: owner-scoped sections 4 and 5 now include source-linked intent context and deduplicated next actions; intent query failure preserves existing personal sections.
- Local D1: migration 0014 verified on 2026-07-13 against isolated storage (table + all three indexes).
- Remote verification: `intent_opportunities` and all three expected indexes are present; the migration ledger has no pending entries.
- Plan file: `plans/0012-ai-visibility-and-reddit-intent-response.md`.

### Source ingest pipeline

The Python `Event` type and D1 `events` table are normalized source
observations, not actionable product conclusions. `SignalCandidate` and
`signals` own the actionable interpretation boundary; no `normalized_events`
model exists.

- The seed gazetteer includes recurring `/unmapped` and source-quality
  candidates for Notion, Cursor/Anysphere, Figma, Arc Search, Coinbase,
  Robinhood, Duolingo, Reddit, and Roblox. Curated App Store and Play Store
  reviews assign their known entity IDs directly; Gemini and Copilot extend
  those existing bounded lists without introducing another firehose.

Python adapters under `python/ingest/src/high_signal_ingest/sources/` — all wired on daily or wider-window cron unless noted:

- **Capital/filings:** SEC EDGAR (8-K, 10-Q/K, Form D/S-1/4/13F), HKEX, IR pages, SEC XBRL fundamentals, Companies House (optional key), USPTO PatentsView (API transition — may return empty).
- **Equities:** Universe 3,226 tickers; yfinance EOD via `equities_daily.py`; `/equities` page; `cron-equities.yml` 21:30 UTC weekdays; tier-1 derivations + tier-2 macro (ECB FX, optional FRED).
- **Jobs:** Greenhouse, Lever, Ashby public boards (curated slugs).
- **Builder:** GitHub releases/trending/archive, Hugging Face Hub, npm/PyPI + OSV, starboard stars.
- **Research:** Semantic Scholar (the papers source). A dedicated arXiv adapter was built and then removed — papers are already covered by Semantic Scholar, no second firehose wanted. OpenAlex remains **not implemented** (was previously over-claimed here).
- **Litigation:** **CourtListener** (`courtlistener.py`, keyless Free Law Project API) — antitrust / IP / M&A opinions; queries scoped to tech/finance and deliberately low-volume/high-precision (case captions like "Brandt v. nVidia" map to entities; the downstream entity gate drops the rest). Corroboration role, classified `official`.
- **Discourse:** **Hacker News** (`hackernews.py`, keyless Algolia API — direct pipeline source, ~10 domain queries × 2 pages, points floor; was previously Lab-only), **Stack Overflow** (`stackexchange.py`, keyless — 15 AI-infra tags, tech-adoption signal; thin post-LLM but functional), Reddit (13 subs), YouTube discovery + transcripts, Bluesky (optional auth), Lobste.rs, Substack RSS, Techmeme, Podcast Index.
- **YouTube brand-awareness probe (2026-07-09):** `YOUTUBE_API_KEY` is stored in Infisical (`dev`) and unlocks official YouTube Data API search/view-count ranking for `scripts/youtube-brand-awareness-probe.py` / `pnpm youtube:brand-probe`. Probe learning: official API is useful for discovery and `>10k views` filtering; it does **not** provide arbitrary third-party transcripts. No-key transcript extraction via `youtube-transcript-api`/`yt-dlp` worked briefly on sample brands (Perplexity, Cursor, Lovable) but then hit IP blocks / HTTP 429, so production transcript coverage needs a provider/proxy-backed lane. Treat YouTube as brand-awareness/perception weak evidence, not cite-or-kill primary evidence.
- **Energy:** **EIA** (`eia.py`) — monthly industrial electricity price for 14 states; numeric-series-as-events. **LIVE** (2026-06-26): key obtained autonomously (Playwright drives the signup form + AgentMail receives verification + key emails), stored in Infisical (Fleet/`dev`) + GitHub repo secret + wired into `cron-ingest`. 56 events.
- **Startups / demand:** **Product Hunt** (`producthunt.py`, keyless RSS — new launches; avoids the OAuth API), **Google Trends** (`google_trends.py`, keyless daily-trends RSS — demand-side signal for new-ideas; noisy, curated downstream), **Apple App Store** (`appstore.py`, keyless top-free chart RSS — consumer *traction*, distinct from PH *launches*). 35 / 20 / 50 events.
- **Reviews / perception (§4 + idea-mining):** **App Store reviews** (`appstore_reviews.py`, keyless iTunes RSS — resolves brand→app-id via the free Search API) and **Google Play reviews** (`playstore_reviews.py`, free `google-play-scraper` lib, lazy-imported optional dep, seeded package names). Real user reviews (1★ complaints = pain-points/idea fuel) for a curated app set + `APPSTORE_REVIEW_APPS`/`PLAYSTORE_REVIEW_APPS` override (point at a connected brand for §4). 95 / 180 events. **SaaS web review sites (Trustpilot/G2) have no free API** — Cloudflare-walled; the only free path is *headed* Playwright (works, but needs xvfb on CI + is anti-bot-fragile), deferred until §4 perception is a priority.
- **Policy:** Federal Register, Regulations.gov (optional), SAM/SBIR/USAspending; **OpenStates** (`openstates.py`) — state-legislature bills (federal→state→municipal policy stack). **LIVE** (2026-06-26): key provided by operator, stored in Infisical + GitHub repo secret + cron-wired. 71 events (Virginia data-center bills: site assessment, sound profile, water use). Classified `official`.
- **Municipal land-use (GatherGov-style):** `legistar.py` — free, key-less Legistar/Granicus Web API across ~18 city/county councils, biased to data-center/fab corridors verified reachable on the API (Phoenix, Mesa, Goodyear, **Maricopa County**, San Jose, Santa Clara, San Antonio, Columbus, Atlanta, **Mecklenburg/Charlotte**, **Racine County** = Microsoft Mount Pleasant; `LEGISTAR_CLIENTS`-overridable). Keyword-filters recent `Matters` to data-center / rezoning / power-purchase / development-agreement items (procedural minutes/communications dropped); classified `official` (counts toward cite-or-kill). **Role = corroboration, not standalone signal** (decided 2026-06-26): municipal records are overwhelmingly entity-less (parcels, local LLCs, thematic items) — verified true entity-map rate ≈1/48 in a 30-day window — so they publish only when they name a tracked data-center operator (5C, QTS, Compass, Vantage — added to the seed; common in NoVA campus filings) or corroborate an existing signal as an official 2nd source. A thematic `data_center_buildout` signal type exists in `signal_types.yaml` and is offered to the LLM for entity-mapped clusters; **standalone entity-less municipal signals are deferred** (would require generator changes to the publish path — see Planned #10). **Tier C (meeting-video transcription, GatherGov's actual moat) is out of scope** — company-sized ASR effort; reopen only if a watchlisted data-center jurisdiction publishes *only* video and its signal is proven valuable. The highest-value region (NoVA Data Center Alley — Loudoun/Prince William/Fairfax/Henrico) and marquee fab towns (Intel Ohio/Oregon, Samsung Taylor, Micron Syracuse) are **not** on Legistar; reaching them needs per-jurisdiction agenda/PDF scraping (CivicPlus/self-hosted), also deferred under the corroboration-only decision.
- **Markets:** Polymarket, Manifold, Kalshi, Metaculus (optional token) — probabilities only, not equity prices; **CoinGecko** (`coingecko.py`, keyless) — crypto trending coins + 24h movers (fills the zero crypto-coverage gap), **DeFiLlama** (`defillama.py`, keyless) — on-chain protocol TVL + 1d moves (capital flows, non-redundant with CoinGecko prices). 15 / ~5 events.
- **Macro:** ECB FX + FRED (`macro_rates.py`); **BLS** (`bls.py`, keyless v1 API, optional `BLS_API_KEY` for v2 limits) — latest CPI / core CPI / unemployment / nonfarm payrolls / earnings / PPI prints as dated events (release-timing gap that FRED's series don't give). 6 events. **SEC Form D** (private fundraising / "who just raised") is already ingested by `edgar` — surfacing it as a startups funding feed is a brief-composition task, not a new source.
- **News:** GDELT, 50+ RSS feeds, Guardian (optional key).
- **US government RSS:** `us_gov_rss.py` — SEC litigation, FTC, DOJ, CFTC, GAO, Nasdaq halts (keyless RSS, 42 events). Historical temporal — enforcement actions and halts have lasting relevance.
- **US government APIs:** `us_gov_api.py` — CFTC COT, Treasury, BEA, Census, Congress, FEC, LDA, CFPB, FDA, NIH, NSF, USGS, NOAA, USDA (1,524 events). Series temporal — macro indicators, legislative tracking, grants. Keyed via api.data.gov.
- **India government:** `india_gov.py` — SEBI, RBI, MOSPI, BSE, NSE, AMFI, NPCI, data.gov.in (11 events). Series temporal. Keyless except data.gov.in.
- **Global macro:** `global_macro.py` — IMF, World Bank, BIS, UN Comtrade (39 events). Series temporal. Keyless.
- **Crypto on-chain:** `crypto_onchain.py` — mempool.space, L2Beat, CoinMetrics, Etherscan, Token Unlocks (4 events). Series temporal. 3 of 5 sub-sources keyless.
- **AI benchmarks:** `ai_benchmarks.py` — LMSYS Arena (keyless), Artificial Analysis, OpenRouter (1 event). Series temporal. LMSYS works keyless; other two need keys.
- **Developer ecosystems:** `dev_ecosystems.py` — Papers with Code, GitLab, Docker Hub, dev.to, libraries.io, Replicate (90 events). 4 of 6 sub-sources keyless.
- **Attention:** Wikipedia pageviews API `GET /attention/:article`; Wikidata enrichment `/enrich/ticker`. The live Digg technology-cluster overlay under issue #130 polls five documented feeds every 30 minutes, preserves dedicated raw snapshots, associates attention with signals, and powers three Daily Brief sections. Its schema hard-codes derived attention with no evidence/confidence contribution.
- **Security:** NVD CVE, CISA KEV.
- **Temporal relevance classification (2026-06-28):** Each source tagged `recent` (29 sources — news, social, RSS, stale after days), `historical` (14 — patents, filings, court cases, full archive has value), or `series` (9 — macro, rates, benchmarks, on-chain, both recent prints and historical trends matter). Surfaced in the data directory UI with icons (● ▤ ∿) and contextual notes on source detail pages.

**Operator tooling:** `pnpm source:diagnose`, `pnpm source:quality -- --json`, `docs/operations/runbooks/ingest.md`, `docs/operations/source-coverage.md`. Source document dedupe by `document_key` (migration `0008_source_document_keys.sql` — **applied to remote D1** 2026-06-28: column + unique index + backfill). `/admin/events` preserves rich payloads with error logging.

**Data catalog, directory & grouping (2026-06-26 — "get all data and group them, no RAG"):**
- **Storage model** — *extract info and keep the link*: events persist `source_url` + a short extracted `title`/`content` summary (cap 20 KB, usually <2 KB) + dedup hash; raw HTML/PDF/JSON that's one query away is **not** stored. Footprint ≈ KB/day of new signals, low-MB total in D1.
- **`docs/operations/source-catalog.md`** — the data-source table (provider, access/auth, history depth, official-class, role, temporal relevance, extracted fields). Single source of truth `source_catalog.py` (CATALOG), regenerated via `python -m high_signal_ingest.source_catalog`; a test asserts it matches the pipeline `Source` list (no drift). 52 sources.
- **`data_directory.py`** — `python -m high_signal_ingest.data_directory` runs the parallel `fetch('all')`, buckets by source, and writes `data-directory/` (git-ignored, regenerable): `INDEX.md` + one JSON of recent samples per source. Verified live: **180,537 events across 43 source families** in D1 (2026-06-28).
- **`grouping.py`** — deterministic, no-vector grouping of *all* events (incl. entity-less, which the generator drops) by entity + theme (keyword buckets) + source family + day, with a **convergence view** ranking groups by distinct-source corroboration (the cite-or-kill precursor).
- **`dedupe.py`** — deterministic cross-source de-duplication (no embeddings): union-find over **shared canonical URL** (scheme/www/query/fragment stripped; HN's embedded article link extracted) + **title token-Jaccard** (≥0.6, guarded by same-day or shared entity). Collapses the same story from HN/Reddit/Techmeme/news into one, **keeping the distinct-source count as corroboration** (dedup ≠ discard the signal). Wired into `opportunities.py` (no duplicate opportunities) and `data_directory.py` (INDEX reports raw→unique + corroborated count).
- **`opportunities.py`** — RedShip-style (redship.io) monitored, scored inbox over the community sources (Reddit/HN/Stack Overflow/Lobsters/Substack): each item scored 0-100 by brand-keyword relevance + buying/pain intent (reuses `analysis.lightweight_nlp`) + recency, ranked. Deterministic; LLM reply-drafts/alerts/SEO-ranking deferred (map to the existing **Mentions**/**Communities** lenses — see below).

### Lenses & intelligence helpers

- **Markets:** `/markets`, `/markets/history`; prediction-market quotes with auto-publish guardrails; worker `/markets/*`.
- **Communities:** Tracked-subreddit CRUD and digest generation remain operator-only inputs feeding brief sections 2–3; worker `/products/communities/*` remains for composition.
- **Convergence:** `/convergence`; `GET /convergence?hours=&min_sources=` — multi-source entity aggregation + market overlay.
- **Unmapped:** `/unmapped`; `GET /unmapped?hours=` — ticker/bare-entity candidates with one-click CSV row via `/enrich/ticker`.
- **Entities & graph:** `/entities`, `/entities/[id]`, `/entities/[id]/[period]`, `/sectors`.
- **Company Universe:** `/case-studies` and company detail/pagination routes from official directory evidence.
- **Parked internals:** Mentions, Agent Eval, Domains/drank, equities UI, and the Lab substrate may retain code or data adapters but have no public product route.

### Operator, automation & CI

- Shared Ultracite lint baseline with a clean 377-file check.
- Admin worker routes: sync, scores, events, quotes, ingest-runs, llm-runs, audit summary, pending-scores, backfill-entities.
- GitHub Actions: `ci.yml`, `cron-ingest.yml`, `cron-score.yml`, `cron-markets.yml`, `cron-equities.yml`, `cron-backtest.yml`, `cron-publish.yml`, `personal-brief.yml`, `weekly.yml`, `backfill.yml`.
- Personal command brief scripts → SaaS Maker task sync (`pnpm personal:brief sync-tasks --apply`).
- In-process lightweight annotation with contract tests (`pnpm annotation:test`).
- Static asset requests bypass the OpenNext Worker only through the verified
  `assets.run_worker_first` exclusions; all application routes remain
  Worker-first by default, with a focused routing regression test.
- **Automation readiness (2026-07-19):** machine-readable job inventory
  (`docs/operations/jobs.json`), data durability registry
  (`docs/operations/data-durability.md`), Foundry safe-actions registry
  (`scripts/foundry-safe-actions.json`), coverage audit
  (`pnpm automation-coverage` → `reports/automation-coverage/<date>.{json,md}`),
  sanitized Foundry evidence snapshot (`pnpm foundry-evidence` →
  `reports/foundry-evidence/<date>.json`), and idempotency-guard tests
  (`pnpm idempotency-guards:test`). No data migration, rate-limit change,
  credential change, or production deploy. Closes the `automate-high-signal`
  OpenSpec change.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/High-Signal-App/high-signal/issues).
An open issue is a to-do, a linked pull request is in progress, and merge plus
issue closure makes the work done.
