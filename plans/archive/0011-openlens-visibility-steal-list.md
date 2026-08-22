# Plan 0011 - OpenLens Visibility Steal List

Status: implemented; operator verification tracked in `PROJECT_STATUS.md`
Created: 2026-06-12
Last updated: 2026-07-13
Reference: https://openlens.com/
Depends on: `plans/0006-agent-evaluation-attention-layer.md`, `plans/0008-signal-provenance-editor.md`

## Implementation state

This PRD is complete as a product spec and accepted into active scope. The v1 scaffold now exists:

- D1 migration `packages/db/migrations/0012_cited_url_index.sql`.
- Worker routes under `/products/mentions/:brandId/*`: `visibility-matrix`, `share-of-voice`, `cited-sources`, `cited-sources/refresh`, `trends`, and `report`.
- Worker route `GET /products/agent-eval/:auditId/attributes`.
- Shared visibility, source-ownership, trend, share-of-voice, and attribute helpers in `packages/shared/src/openlens-visibility.ts`.
- Brand detail surface at `/mentions/[brandId]` with visibility/source/trend/report sections.
- Agent Eval attribute grid at `/agent-eval/[auditId]/attributes`.
- Unit coverage in `scripts/openlens-visibility.test.ts`.

The remaining local-code follow-ups were completed on 2026-07-13:

- The existing `/mentions` configuration surface now presents category as **Topic** and check progress as prompts.
- Every finished mention check now refreshes cited sources and intent opportunities independently; the manual cited-source endpoint uses the same rebuild helper.
- `POST /products/mentions/:brandId/report/share-token` issues a deterministic brand-scoped HMAC token after ownership verification. `GET /products/mentions/:brandId/report` accepts either normal owner access or that token and fails closed when the server signing secret is unavailable.

Remaining operator work is intentionally separate from this PRD's local implementation:

- Apply migration `0012_cited_url_index.sql` to local and remote D1.

## Thesis

OpenLens is close to High Signal's active Mentions and Agent Eval lane: AI visibility for brands across answer engines, with competitor comparison, source intelligence, and client-ready reporting.

High Signal should not copy OpenLens as a standalone agency dashboard. The steal is narrower: turn brand perception and agent-readiness into **repeatable, evidence-linked brief inputs**. Every steal below maps to a section of `/brief` or to data the brief is already trying to surface.

## Product contract

Input:
- a brand config (name, URL, segment, competitors)
- a topic/prompt set (buyer-intent contexts, not raw keywords)
- run history of mention checks and agent-eval audits

Output:
- platform × prompt × brand visibility matrix
- competitor share-of-voice and citation share
- cited-URL intelligence (owned vs third-party, competitor-only)
- attribute breakdown tied to evidence tasks
- run-history trend lines
- a report-ready web view (no PDF in v1)

## Target user

- Brand owners connected to High Signal via Mentions / Agent Eval.
- Operators auditing brand perception before product launches.
- Internal Sarthak workflow for High Signal itself as a connected brand.

Not the target: standalone SEO agencies running a hundred client dashboards.

## User stories

1. As a brand owner, I open `/mentions/[brand]/visibility` and see a matrix of platforms × prompts with mention/recommendation/competitor cells.
2. As an operator, I diff this week's run against last week's and see which platforms changed.
3. As a content strategist using High Signal internally, I see the top URLs cited by AI platforms when prompted about my topic, classified as `owned | competitor | third-party`.
4. As a brand owner, I see attribute gaps ("docs quality is missing proof pages") that produce concrete `agent_evidence_tasks` rows.
5. As a brand owner, I open a report-ready web page that bundles matrix + competitors + cited sources + tasks + trends, ready to share.

## Eight specific steals

### 1. Multi-engine visibility matrix

Surface: `/mentions/[brand]/visibility` and a brief section card.

Shape:
- rows = prompts (or topics, collapsing prompts per topic)
- columns = platforms (`chatgpt`, `gemini`, `perplexity`, `grok`, `deepseek`, `custom`)
- cells: `brand_mentioned`, `brand_recommended`, `competitors_mentioned[]`, `rank_position`, `sentiment`, `citations[]`, `run_at`

This is close to the existing `mention_results` and `agent_evaluation_responses`. The missing piece is a first-class comparison view that reads both tables and merges by `(topic, prompt, platform)`.

### 2. Topic and prompt setup (no "keywords")

Rename surface copy:

- `topic` = buyer-intent or decision context (e.g., "AI infra observability for series B").
- `prompt` = concrete query sent to platforms ("best observability for AI inference at scale?").
- `attribute` = reason a brand wins or loses ("pricing clarity", "compliance posture").

`keyword` is removed from product copy. Existing `mentionPrompts` is reframed as `prompts under a topic`.

Data: extend `mention_configs` with a `topics` JSON column; add `mention_topics` table only if topics need their own metadata.

### 3. Competitor share-of-voice

Add a competitor delta view to `/mentions/[brand]`:

- brand share of AI answer mentions (% of runs in window)
- competitor share of AI answer mentions
- recommendation share
- citation share
- source overlap and source gaps
- changes since the last run window

Computed from `mention_results.competitors_mentioned[]` and `mention_results.citations[]`. No new tables required; a worker view does the aggregation.

### 4. Source intelligence

Cited URLs become first-class evidence. New table `cited_url_index`:

```sql
CREATE TABLE `cited_url_index` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text NOT NULL,
  `topic` text NOT NULL,
  `url` text NOT NULL,
  `host` text NOT NULL,
  `ownership` text NOT NULL,        -- 'owned' | 'competitor' | 'third_party' | 'unknown'
  `competitor_id` text,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `platforms` text NOT NULL,        -- json array of platforms that cited this url
  `mention_run_count` integer NOT NULL DEFAULT 0
);
CREATE INDEX `cited_url_brand_topic_idx` ON `cited_url_index`(`brand_id`, `topic`);
CREATE INDEX `cited_url_host_idx` ON `cited_url_index`(`host`);
```

Surface lists:
- top cited URLs by topic
- competitor-only URLs (no brand co-mention)
- owned vs third-party split
- cross-platform URLs (cited by ≥3 platforms)
- "missing proof pages" — gaps implied by what competitors cite

Connect to plan `0008`: each cited URL can become a `source_document_id` and feed `claim_evidence_links`. Cited sources are not a separate SEO product; they are evidence with extra context.

### 5. Attribute breakdown

Map agent-eval areas to OpenLens-style attributes. Existing `agent_evidence_scores.area` already covers most:

- trust ↔ proof
- pricing clarity ↔ pricing
- security/compliance ↔ policies
- integrations ↔ transaction readiness
- docs quality ↔ docs
- proof/case studies ↔ proof
- category clarity ↔ positioning
- support/reliability ↔ policies/reviews

Each attribute renders as a card on `/agent-eval/[id]` with status (`missing | weak | clear | strong`), evidence URLs, and linked `agent_evidence_tasks`. No score without evidence.

### 6. Run history and trend lines

Every mention/agent-eval run is already immutable in D1. Add a worker route `/mentions/[brand]/trends?window=30d` that returns:

- visibility trend: `brand_mentioned` rate over time
- recommendation trend: `brand_recommended` rate
- citation-source trend: number of distinct cited URLs
- competitor movement: share-of-voice delta per competitor
- newly appearing / disappearing attributes (from agent-eval area status changes)

Web surface: a single trends card per brand. Sparkline + delta + recent inflection point.

### 7. Report-ready web view

`/mentions/[brand]/report?window=30d` renders:

- executive summary (3 lines, auto-generated from the trends)
- platform matrix (steal #1)
- competitor comparison (steal #3)
- top cited sources (steal #4)
- missing evidence tasks (steal #5)
- next actions (top 5 `agent_evidence_tasks` sorted by priority)

PDF export deferred. The web report should be shareable via per-brand token URL.

### 8. Agent-accessible operations (future surface)

Document a clean future API shape but do not build a separate MCP surface yet:

- `POST /api/v1/brands` — create brand config
- `POST /api/v1/brands/:id/topics` — propose competitors and topics
- `POST /api/v1/brands/:id/scans` — run visibility scan
- `GET /api/v1/brands/:id/visibility` — read score
- `GET /api/v1/brands/:id/citations` — read citations
- `GET /api/v1/brands/:id/tasks` — read recommendations

These follow the existing `workers/api/src/routes/products.ts` conventions. Build only the routes needed for the web report in v1; the rest are spec sketches.

## Web surface

- `/mentions/[brand]` gets new tabs: `visibility`, `competitors`, `sources`, `trends`, `report`.
- `/agent-eval/[id]` adds the attribute breakdown grid.
- `/brief` sections 4 (perception) and 5 (improvements) start pulling from `cited_url_index` and `agent_evidence_tasks` respectively for a connected brand.
- No new top-level product. No agency-style "client" branding.

## API surface (worker)

New under `workers/api/src/routes/products.ts` (existing file):

- `GET /products/mentions/:brandId/visibility-matrix`
- `GET /products/mentions/:brandId/share-of-voice?window=30d`
- `GET /products/mentions/:brandId/cited-sources?topic=&ownership=`
- `GET /products/mentions/:brandId/trends?window=30d`
- `GET /products/mentions/:brandId/report?token=&window=30d`
- `POST /products/mentions/:brandId/cited-sources/refresh` — recompute `cited_url_index` from latest results

## Telemetry

- `visibility_matrix.viewed`
- `share_of_voice.viewed`
- `cited_sources.viewed` with `ownership` dimension
- `report.shared_token_generated`
- `report.shared_token_viewed`
- `attribute.task_created_from_gap`

Watch: if `report.shared_token_viewed` outpaces `report.viewed` by 3× the report is the actual product surface, not the matrix — plan accordingly.

## Rollout slice

1. Rename product copy from `keyword`/`query` to `topic`/`prompt` across Mentions and Agent Eval. Migration of any `*_keyword` columns to `*_topic` aliases.
2. Visibility matrix tab on `/mentions/[brand]`.
3. Cited-source intelligence: build `cited_url_index`, classify ownership (owned via brand-domain match; competitor via competitor-domain match; rest = third_party), surface lists.
4. Attribute breakdown grid on `/agent-eval/[id]`, mapped to existing `agent_evidence_scores.area`.
5. Trends route + trends card.
6. Report-ready web view + shareable token URL.
7. (Deferred) Per-platform fan-out (one provider per platform), PDF export, MCP surface.

## Scope

### Add
- `cited_url_index` in D1.
- Topic/prompt copy rename and surface IA refactor.
- Worker routes listed above.
- Visibility matrix, competitor share-of-voice, cited-source intelligence, attribute grid, trends, report-ready web view.

### Keep out
- Agency-only dashboard framing.
- Broad per-platform provider complexity before single-endpoint flow proves value.
- "All AI platforms" claims without controlled run cost and quality.
- PDF reports before the web report is used.
- GEO/AEO drifting into generic SEO content generation.

## Dependencies

- Existing `mention_configs`, `mention_prompts`, `mention_checks`, `mention_results`.
- Existing `agent_evaluation_audits`, `agent_evaluation_responses`, `agent_evidence_scores`, `agent_evidence_tasks`.
- `HIGH_SIGNAL_AI_API_KEY` (or `OPENAI_API_KEY`) for real-AI execution.
- Plan `0008` for evidence-link plumbing on cited sources.

## Acceptance criteria

- A brand owner can see at a glance which platforms mention or recommend them vs competitors.
- Every platform result links back to the exact prompt and raw response (existing immutable rows; new view only).
- Cited URLs are grouped by topic and competitor relevance.
- Attribute gaps produce concrete `agent_evidence_tasks` with priority and source URL.
- Trends compare immutable runs rather than overwriting the latest result.
- The feature feeds brief sections 4 and 5 without turning High Signal into a standalone agency dashboard.
- A report URL with a token loads without sign-in but does not expose other brands' data.

## Non-goals

- A standalone GEO/AEO content product.
- Per-client / per-agency multi-tenancy.
- Real-time platform polling. Runs stay on the cron cadence.
- Per-platform billing / cost analytics.

## Risks

- Multi-platform scans get expensive and slow. Mitigation: keep the single-endpoint flow; document per-platform fan-out as a separate plan if ever needed.
- Provider-specific behavior creates brittle tests. Mitigation: store raw response text; never mutate.
- Competitor comparison becomes noisy without stable prompt/topic sets. Mitigation: require an explicit topic set per brand; refuse runs over a free-form keyword list.
- Report work eats focus. Mitigation: web report only; defer PDF until at least one user shares a report twice.
- Cited-source classification gets wrong "ownership" labels. Mitigation: ownership is rule-based (brand domain match, competitor domain match); third_party is the default, not a guess.

## Open questions

- Should the report be public (shareable token URL) by default, or sign-in-only?
- Where does topic taxonomy live — per brand, or a shared bank that brands subscribe to?
- Do we need to consolidate `mention_prompts` and `agent_evaluation_responses.prompt_*` columns into a shared prompt model, or keep them parallel?
- How aggressively should cited-source rollups feed the public hit-rate ledger? Brand-specific data should not contaminate the public moat.
