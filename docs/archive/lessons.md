# Lessons Learned

Concrete, evidence-backed lessons from building High Signal. Each entry cites
its source (plan, commit, code comment, doc). For decision rationale, see
`docs/decisions.md`. For phase retrospectives, see `docs/retros/`.

---

## ML Model Integration

### GLiNER must be lazy-loaded or it blocks the ingest process

`extract/entities.py` wraps `GLiNER.from_pretrained()` in an `@lru_cache` and
catches all exceptions, returning `[]` on failure. If GLiNER is imported at
module level, missing the optional `[entities]` extra kills the entire pipeline
run. Lazy-load all optional ML models; make the pipeline degrade gracefully to
the gazetteer path.

### GLiREL is "heavy" even for a stub — defer it fully, don't half-integrate

`extract/relations.py` documents the stub decision explicitly: "GLiREL is heavy;
for v0 we return [] and rely on: (1) hand-curated relationships.csv, (2) manual
review queue." The lesson: do not add a heavy model dependency until you have
the validation infrastructure to trust its output. A zero-return stub with a
clear comment is preferable to a wired but unvalidated model.

### FinBERT's 512-token cap silently truncates long documents

`score/sentiment.py` caps input at `text[:512]`. This is fine for headlines and
short snippets but silently drops context for SEC filings, earnings call
transcripts, and long Reddit threads. The model returns a result without any
signal that truncation happened. For longer documents, run sentiment on the most
relevant excerpt rather than the raw head.

### Local sentence-transformer embeddings (384-dim MiniLM) download on first run

`python/lab/`: the `embed.py` pass downloads `sentence-transformers/all-MiniLM-L6-v2`
on first run — roughly 90 MB. This surprised operator during Lab bring-up (plan
0007 status section mentions it). Always note model download size in setup docs
and pre-warm the model cache separately from the first real pipeline run.

### VectorBT was planned but not used — yfinance + hand-rolled math was enough

`score/backtest.py` comment: "VectorBT is heavier; for v0 we use the repo's
yfinance adapter and hand-roll the math." The lesson: reach for the heavy ML
library last. A simple forward-return calculation over yfinance closes was
sufficient for the hit-rate ledger. VectorBT adds startup cost and complexity
before the backtest semantics are even validated.

---

## Per-Source Ingest Pitfalls

### Prediction markets are not equity prices — separate them from day one

README.md: "Prediction markets are separate — `market_quotes` means
Polymarket / Manifold / Kalshi probabilities, not stock quotes. Never use that
table as equity-price evidence." A separate kill rule in the auto-publish judge
prevents prediction-market-only evidence from auto-publishing as a signal. This
distinction was explicit in plan design but required a dedicated code rule to
enforce it.

### Source quality shows up as empty events, not errors

`docs/source-coverage.md` and the `pnpm source:quality` script exist because
misconfigured or low-yield sources return zero events silently. A missing
credential (e.g., `GUARDIAN_API_KEY` absent) makes the adapter skip cleanly —
indistinguishable from "no news today." The lesson: always separate missing
credential (skip) from low-yield (warn) from blocked (error) in source
diagnostics. `pnpm source:diagnose` was added specifically because
`pnpm source:quality` confused missing credentials with poor source yield.

### The USPTO PatentsView API went offline during build

`README.md` data pipelines checklist: "adapter is wired, but the live API is
currently in USPTO ODP transition and returns no events." A source can be
correctly implemented and still return nothing because of upstream provider
transitions. Build resilience for source-level zero-result states.

### EDGAR requires a valid `SEC_USER_AGENT` or requests get blocked

`python/ingest/sources/edgar.py` and setup docs require `SEC_USER_AGENT` in the
Modal Secret / env. Missing this causes EDGAR to return 403s silently absorbed
by the adapter. Rate-limited and policy-gated sources need explicit env
preflight checks, not just graceful degradation.

### GitHub trending is HTML-scraped, not API-fetched — it breaks on DOM changes

`python/lab/github_trending.py`: "HTML scrape of `github.com/trending`…
No API key required." The tradeoff: zero cost and no API approval, but the
scraper is fragile to GitHub's DOM changes. This was accepted deliberately
(plan 0007) as part of the "no paid sources in default path" principle.

### Equities need exactly one price ingress — multiple fetchers create races

`docs/data-service-boundary.md` and `README.md` equities section: "Do NOT add
direct quote fetchers in web scripts, personal workflows, signal scoring, or
source adapters; consume this artifact or the D1 closes / ticker_snapshot
tables." This rule was added after derived JSON artifacts and the pipeline
fetcher could have diverged. A single canonical equities path prevents
conflicting prices appearing in different surfaces.

---

## Lab Bring-Up Surprises

### Phase 1 ships code but Postgres must still be started manually

Plan 0007 status (2026-05-25): "Phase 1 is dormant until you bring it up." The
code was committed but no Postgres container was running. agents.md Known Gaps:
"Lab phase 1 completeness — code is committed but no Postgres is running;
bring-up is on the operator." Shipping code is not the same as shipping a running
service. For local-first infra, the bring-up steps need to be treated as part of
the deliverable.

### Story clustering and velocity scoring required prior embedding run

`python/lab/cluster.py` (union-find) needs embeddings to exist in `documents.embedding`
for the cosine-similarity half of the clustering. The embed step is marked
optional but the cluster step silently falls back to link-only clustering without
it. Optional steps with hidden dependencies should be clearly sequenced in
runbooks.

### 14k-repo import was planned but not shipped in Phase 1

Plan 0007 "Not yet shipped" list: "14k-repo GitHub DB import into `repos`
(currently only daily/weekly/monthly trending HTML scrape)." The trending scraper
provides a useful seed but not the broad repo universe the plan envisioned. This
gap remained open at the time of the scope reset.

---

## Architecture and Process Lessons

### Modal → GitHub Actions migration happened within 24 hours of Modal launch

Commit 2026-04-25: "chore: deploy Modal — daily ingest + scoring crons live."
Commit 2026-04-26: "feat: migrate daily crons from Modal → GitHub Actions."
The lesson: evaluate the simplest runtime first. GitHub Actions is free, already
in the repo, and handles this cron workload without a second service. Modal was
carried forward only for ad-hoc backfills where its longer-running sandboxed
environment is genuinely useful.

### CF Access auth was abandoned for Clerk within one week

CF Access shipped 2026-04-25; Clerk adopted 2026-05-01. CF Access is fine for a
single-operator admin gate, but the moment user-facing features (watchlists, brand
configs, delivery preferences) were planned, a full session model became necessary.
Do not invest in edge-only auth if the product roadmap includes user identity.

### The five-sub-products frame was abandoned within one month

Plan 0004 framed High Signal as five sub-products (2026-05-01). The Daily Brief
reframe happened 2026-05-25. The scope reset confirmed this 2026-06-03. The
lesson: a product positioned as "five things" is harder to explain than one thing
with helpers. The brief as a homepage gave a single user-facing artifact to point
at.

### D1 remote migrations lagged behind local migrations consistently

agents.md Known Gaps (2026-05-25): "D1 migrations on remote — local migrations
applied per convention; `pnpm db:migrate:remote` has not been verified for the
latest agent-evaluation tables." PROJECT_STATUS.md (2026-06-13): migration
`0008_source_document_keys.sql` still pending remotely. Local-first development
creates a persistent gap between local and remote schema state. Automate remote
migration verification in CI or add a preflight check before deploy.

### Seed fallback content prevents a blank brief but can mask data pipeline gaps

`packages/shared/src/seed-content.ts` ships 35 stock signals, 20 business ideas,
and 18 lifestyle trends as demo fallback. The brief always renders well even on
an empty D1. The risk: an operator might not notice the real pipeline has stopped
producing data if the seed content looks plausible. Add a visible "showing demo
data" signal in the brief UI when falling back.
