# Architecture Decision Records

This file is the canonical ADR log for High Signal. Each entry covers a real
decision visible in code, plans, or git history. Unknown rationale is flagged
`TBD: capture rationale`. See `docs/knowledge/learnings/lessons.md` for operational findings and
`docs/knowledge/retros/` for phase retrospectives.

---

## ADR-001 — D1 + Drizzle instead of Postgres as the signal store

Date: 2026-04-25
Status: active

**Context.** The project runs on Cloudflare Workers for both the web and API
layer. A separate managed Postgres would require a network boundary between the
Worker and the DB, adding latency and a second service to operate.

**Decision.** Use Cloudflare D1 (SQLite-on-Workers) with Drizzle ORM as the
canonical store for signals, entities, events, evidence, and score_runs. D1 is
zero-ops, co-located with the Worker, and directly bindable.

**Rationale.** Removing the network hop keeps p50 latency low. D1 is good enough
at the current row counts (signals, entities, score_runs are each in the
hundreds, not millions). Drizzle gives type-safe schema with migrations the same
as Postgres, so a future move is possible.

**Alternatives rejected.** Neon/Supabase Postgres: more power but adds ops, a
billing dependency, and cross-region latency from Workers. Turso: considered
during the AgentMode migration (which used it); deliberately not carried forward
so the consolidated repo has one store rather than two.

**Tradeoffs.** D1 is SQLite; no array types, no pgvector, no `RETURNING` in older
versions, limited concurrent writes. The Lab substrate explicitly breaks this
boundary with a local Postgres+pgvector (ADR-009). Heavy analytics and vector
search stay out of D1 by design.

---

## ADR-002 — Git-versioned markdown as the signal memory layer

Date: 2026-04-25
Status: active

**Context.** Signals need an audit trail. Corrections must be traceable without
rewriting history.

**Decision.** Every published signal is a markdown file committed under
`signals/YYYY-MM-DD/<slug>.md` with YAML frontmatter (entities, direction,
confidence, evidence URLs, predicted-window). Corrections are new files citing
the prior. No retroactive edits allowed.

**Rationale.** Plan 0001 explicitly stated: "The artifact is the moat. Brutal
honesty is the unique moat — every signal logged, every prediction scored, no
retroactive edits." Git diff is the audit trail; the history is the credibility
claim.

**Alternatives rejected.** DB-only storage with soft-delete/corrections: loses
the public verifiability. Append-only event log in D1: works for queries, but
the markdown file is the public-facing artifact that can be browsed directly on
GitHub.

**Tradeoffs.** Sync from git to D1 is a separate script step (`pnpm signals:sync`).
The git store and D1 can temporarily diverge. The review queue in D1 is the
operational state; the git markdown is the truth store.

---

## ADR-003 — GLiNER for entity extraction (gazetteer-first, ML fallback)

Date: 2026-04-25
Status: active

**Context.** The ingest pipeline must tag financial entities (companies,
products, people) in raw text from 20+ sources. The entity set is known (seed
corpus of 274 entities at launch), but new entities appear in the wild.

**Decision.** Two-tier extraction: (1) fast deterministic regex match against a
hand-curated entity gazetteer (built from `seed/ai_infra_entities.csv`);
(2) GLiNER zero-shot NER (`urchade/gliner_medium-v2.1`) for novel mentions not
in the gazetteer. Gazetteer hits are authoritative; GLiNER hits are candidates
that enter the `/unmapped` review surface.

**Rationale.** The gazetteer covers the known entity universe at near-zero
inference cost. GLiNER handles open-world novel entities without requiring
training data. Threshold set to 0.55 after experimentation (referenced in code
comment; exact calibration TBD: capture rationale).

**Alternatives rejected.** spaCy NER: good for common named entities but not
tuned for financial entities or zero-shot domain adaptation. Fine-tuned BERT:
requires labeled data the project does not have. Rule-only: misses novel
entities that create future signals.

**Tradeoffs.** GLiNER is a heavy optional dependency (lazy-loaded); it returns
`[]` when unavailable, so the pipeline degrades gracefully to gazetteer-only.
Confidence threshold choice affects recall vs. noise — not yet calibrated
post-hoc against the signal hit-rate ledger.

---

## ADR-004 — GLiREL deferred; hand-curated relationship graph for v0

Date: 2026-04-25
Status: active (deferred)

**Context.** The spillover graph (TSMC capex → ASML → HBM → cloud capex) is the
core moat mechanic. Edges must be accurate enough that the 2nd-order prediction
is meaningful.

**Decision.** Ship v0 with a hand-curated `relationships.csv` (175 seed edges).
GLiREL is stubbed in `extract/relations.py` but returns `[]`. The review queue
gates edge quality before publish.

**Rationale.** `extract/relations.py` comment: "GLiREL is heavy; for v0 we
return [] and rely on: (1) hand-curated relationships.csv, (2) manual review
queue." Accurate edges matter more than broad coverage at the AI-infra wedge
size; hand curation is feasible at 175 edges.

**Alternatives rejected.** GLiREL full integration: would extract relation
triples automatically but requires validation infra to prevent hallucinated edges
from corrupting the spillover map.

**Tradeoffs.** Curated graph is accurate but does not grow automatically. New
entity relationships require manual addition. The `/unmapped` surface partially
addresses entity discovery but not edge discovery. TBD: capture rationale for
when GLiREL integration becomes the right tradeoff.

---

## ADR-005 — FinBERT for sentiment, not general-purpose LLM

Date: 2026-04-25
Status: active

**Context.** Signal candidates need a directional sentiment label (positive /
negative / neutral) on financial text.

**Decision.** Use `ProsusAI/finbert` via the HuggingFace transformers pipeline.
Input capped at 512 tokens. Returns `(label, confidence)`. Falls back to
`("neutral", 0.0)` when unavailable.

**Rationale.** FinBERT is fine-tuned on financial corpora (analyst reports,
earnings calls, financial news) giving it significantly better calibration than
general-purpose BERT or a zero-shot instruction-tuned model on financial
terminology. Cost: zero at inference time on Modal/local. The signal generator
calls this as one input factor, not as the sole decision.

**Alternatives rejected.** GPT-based sentiment via API: higher cost, slower,
requires network call in the scoring loop. General BERT sentiment: tested on
financial text but domain shift degrades calibration noticeably. TBD: capture
quantitative comparison vs. general BERT on this pipeline's texts.

**Tradeoffs.** 512 token cap means long documents (earnings call transcripts,
10-K sections) are truncated. FinBERT's training distribution is analyst
language; Reddit/HN slang calibration is weaker.

---

## ADR-006 — Modal for Python ML runtime → migrated to GitHub Actions in one day

Date: 2026-04-25 (Modal launch) → 2026-04-26 (migrated to GitHub Actions)
Status: active (Modal kept for ad-hoc backfills only)

**Context.** The Python pipeline (GLiNER, FinBERT, Trafilatura, edgartools)
needs a scheduled runtime. Modal was the first choice because it was a known
pattern from the `reel-maker` fleet project.

**Decision (day 1).** Deploy daily crons on Modal. Commit: "chore: deploy Modal —
daily ingest + scoring crons live."

**Pivot (day 2).** Migrate daily crons from Modal to GitHub Actions. Commit:
"feat: migrate daily crons from Modal → GitHub Actions." Modal retained only for
ad-hoc backfills via `modal run`.

**Rationale for pivot.** TBD: capture rationale (no explicit note in code or
plans). Likely: GitHub Actions is free for public/private repos at this usage
level; Modal adds a billing dependency and second service to manage; GHA cron
syntax is simpler for this workload.

**Tradeoffs.** GitHub Actions: free but cold-start latency for Python env setup,
no persistent GPU/memory between runs, max 6h job. Modal: warmer starts, better
for GPU-heavy workloads, costs money at scale. Current workload is CPU-bound
(GLiNER, FinBERT) so GHA is adequate.

---

## ADR-007 — Cloudflare Access → Clerk for auth

Date: 2026-04-25 (CF Access) → 2026-05-01 (Clerk migration)
Status: active (Clerk is the auth layer; CF Access abandoned)

**Context.** `/review` and `/api/admin/*` needed auth protection on day 1. The
product later added user-facing features (watchlists, brand configs, delivery
preferences) that need persistent identity.

**Decision (day 1).** Ship Cloudflare Access (Zero Trust) for `/review` +
`/api/admin/*`. Rationale in plan 0002: no token in localStorage, CF handles
Google OAuth, no code to maintain.

**Pivot (2026-05-01).** Adopt Clerk. Commit: "Adopt Clerk for premium product
authentication." CF Access plan abandoned per agents.md: "The earlier Cloudflare
Access plan was abandoned; do not reintroduce it without a migration plan."

**Rationale for pivot.** TBD: capture rationale (agents.md explicitly buries CF
Access without explaining why). Likely: Clerk offers a full session model, user
metadata (`publicMetadata.region`), and sign-up/sign-in UI that CF Access cannot
provide as the product moved toward a user-facing product with Clerk-gated
features.

**Tradeoffs.** Clerk adds a JS SDK dependency and an external auth vendor.
Machine-to-machine calls still use bearer `ADMIN_TOKEN`; only browser auth went
through Clerk. CF Access's zero-code edge protection was simpler for
single-operator scenarios.

---

## ADR-008 — Two-tier auto-publish judge (deterministic rules + AI fallback)

Date: 2026-05-26
Status: active

**Context.** As of 2026-05-26, Sarthak's directive: "I don't want it blocked by
me." The review queue as a daily human gate was not scaling.

**Decision.** Two-tier judge for every draft signal:
1. Deterministic rubric (`scripts/auto-publish-rules.ts`, unit-tested): PUBLISH /
   KILL / HOLD based on evidence URL count, source class diversity, quality
   reason flags, and prediction-market-only detection.
2. AI judge (DeepSeek default, any OpenAI-compatible) fires only on HOLD verdicts.
   Without AI available, HOLD biases to KILL.

Verdict effects: PUBLISH → `review_status='published'`; KILL → `review_status='killed'`
(new fourth status, reversible via `/review`).

**Rationale.** The deterministic layer handles the clear cases (< 2 evidence URLs
→ KILL; prediction-market-only → KILL; `fallback_or_backfill` reason → KILL)
without any AI cost. The AI judge covers the ambiguous middle cases. The human
`/review` surface is an override, not the daily gate.

**Alternatives rejected.** Full AI judging of every draft: cost and latency per
signal. Human-only review: blocked the pipeline.

**Tradeoffs.** The deterministic rubric encodes editorial policy as code —
changes require a code commit and test update, not just a preference change.
Prediction-market-only kill rule means signals with only Manifold/Polymarket
evidence never auto-publish, even if the crowd probability is highly directional.

---

## ADR-009 — Separate Lab substrate in local Postgres+pgvector, not D1

Date: 2026-05-22
Status: active (Lab parked as of 2026-06-03)

**Context.** High Signal Lab (plan 0007) needs semantic search (pgvector) and
upsert-heavy batch writes over 100k+ documents — workloads that do not fit D1's
SQLite constraints.

**Decision.** Lab runs entirely on a local Postgres instance (via docker-compose)
with `pgvector` and `pg_trgm` extensions. It is explicitly separate from the D1
signal store and is never a production dependency. Schema lives under
`python/lab/schema.sql`.

**Rationale.** Plan 0007 is explicit: "One store. Local Postgres only… No
ClickHouse, no DuckDB/Parquet, no Meilisearch, no Qdrant. Rationale: the
pipeline is upsert-heavy… Postgres is built for that write pattern." At
100k–1M rows the analytics here (top-50 feed) are trivial in Postgres.

**Alternatives rejected.** D1: no vector type, max row size constraints, not
designed for ML pipeline writes. DuckDB/Parquet: good for analytics but fights
the upsert-heavy write pattern. Qdrant/Meilisearch: separate services to operate
for a local-first substrate.

**Tradeoffs.** Lab requires Docker on the operator's machine. Lab is local-first;
it is never deployed as a cloud dependency. The cost of the separation is that
Lab data cannot be directly joined with D1 signal data at query time.

---

## ADR-010 — Monorepo layout: pnpm workspace + uv (Python sibling)

Date: 2026-04-25
Status: active

**Context.** The stack spans TypeScript (Next.js, Hono Workers, shared types) and
Python (ingest pipeline, ML models, Lab substrate). Both need package management
and shared build tooling.

**Decision.** Single `pnpm-workspace.yaml` monorepo with `apps/web`,
`workers/api`, `packages/db`, `packages/shared`, `packages/annotation`. Python
lives under `python/ingest` and `python/lab` as sibling `uv`-managed
sub-projects sharing no TS build graph.

**Rationale.** TBD: capture rationale for `uv` over `poetry`/`pip`. pnpm
workspace is the fleet standard (saas-maker packages). Keeping Python as a
sibling (not inside any TS package) avoids build-tooling conflicts and lets each
Python sub-project have its own `pyproject.toml` / `uv.lock`.

**Tradeoffs.** No shared build step across TS and Python. Running the full stack
requires both `pnpm install` and `uv sync` independently. The CI runs the Python
tests separately from Vitest.

---

## ADR-011 — Five-section Daily Brief as the single product surface

Date: 2026-05-25
Status: active (supersedes plan 0004's five-sub-product framing)

**Context.** As of 2026-05-25, the product had been framed as five sub-products
(Markets, Communities, Mentions, Agent Eval, Lab). This created navigation and
positioning confusion.

**Decision.** One product: a Daily Brief with five sections. The sub-products
become "lenses" — intelligence helpers that feed the brief. The brief is the
homepage for signed-in users; the lenses are accessible as deep views but are not
the product's headline.

**Rationale.** Commit message 2026-05-25: "Reframe High Signal around the Daily
Brief." agents.md locked decision (2026-05-25): "Core product: one Daily Brief
per user per day." The scope reset doc (docs/product/scope-reset.md) confirmed
this by parking Lab, standalone equities, and standalone communities.

**Alternatives rejected.** Staying with sub-products: confusing navigation, no
clear homepage, hard to explain the value prop.

**Tradeoffs.** Some sub-product surfaces (equities, communities, lab) are still
reachable by URL but are de-emphasized. The brief's quality depends on all five
lenses working; a broken lens degrades one brief section rather than failing
silently (the `safe()` wrapper in `workers/api/src/routes/brief.ts` handles this).
