## Context

The Daily Brief already ships an `OpportunityBriefPayload` contract
(`packages/shared/src/core/brief.ts`) with verdict, confidence, target user,
problem, market-timing reasons, evidence mix, competitor/pricing/agent-visibility
notes, risks, next validation step, and prior hit-rate. The `opportunity-briefs`
spec already covers the generic "ideas carry decision-grade payloads" behavior.

This change adds a **named, curated pipe** that produces those payloads for 20
India D2C niches, instead of relying only on community-digest derivation.

## Design choices

### 1. JSON artifacts before D1

The PRD explicitly offers a no-migration first slice: store the weekly run as
JSON under `data/d2c-opportunities/` and render from that artifact. We take it.

- `data/d2c-opportunities/<YYYY-MM-DD>.json` — one file per weekly run, schema
  below.
- The web/worker side reads the latest artifact via a small shared loader
  (`loadD2COpportunitySnapshot`) that the worker imports at request time. For
  the MVP the worker bundles the latest artifact at build time (it is small,
  < 50 KB) and falls back to seed briefs if the file is missing. A future slice
  can move this to D1 + KV without changing the renderer.

This avoids a migration, keeps the artifact git-reviewable, and matches the
"prefer JSON artifacts before D1 migrations" handoff rule.

### 2. Reuse `OpportunityBriefPayload`, do not fork it

India D2C briefs are not a new type. They are `BriefIdeaItem[]` with
`opportunity: OpportunityBriefPayload` populated, exactly like the seed ideas
in `seed-content.ts`. The renderer in `BriefSections.tsx` already handles them.
This keeps one canonical Opportunity Brief contract (DRY across docs).

### 3. Deterministic scoring first, LLM never on the hot path

Scoring is a pure function of the niche seed + the weekly evidence artifact:

```
opportunityScore = demand*30 + sourceDiversity*15 + competitionGap*20
                 + pricingGap*15 + adSaturation*10 + agentVisibilityGap*10
```

Each input is 0–1. Verdict mapping:

- `TEST`: demand ≥ 0.5 AND competition gap ≥ 0.4 AND a clear first SKU exists.
- `WATCH`: promising but thin (demand ≥ 0.3 OR corroboration missing).
- `AVOID`: saturated (competition gap < 0.2) OR weak demand (< 0.3) OR
  compliance-heavy with no wedge.
- `ENTER`: reserved (not emitted in Slice 1/2).

Confidence is `low` until source diversity ≥ 2 source classes, then `medium`;
`high` is reserved for post-hoc calibration (Slice 3).

### 4. Seed niches are hand-curated, evidence is the variable

The 20 niches from the PRD are static seeds with a stable `slug`, `category`,
`targetUser`, `problem`, `firstSku`, `risks`, and `nextValidationStep`. The
**evidence mix** (demand / competition / pricing / ad-saturation / momentum) is
what the weekly collector refreshes. Seed briefs ship with conservative
placeholder evidence so the renderer works end-to-end on day 1; real evidence
replaces placeholders as the collector runs.

### 5. Source posture (Slice 2)

- **Reddit** (existing `sources/reddit.py` adapter, public JSON/RSS) —
  India-relevant subs: `IndianStartups`, `IndianInvestments`, `IndianSkincare`,
  `IndianGlowup`, `IndianFitness`, `beauty`, `SkincareAddiction`,
  `IndianFoodAddicts`, `IndianPetFood`, `IndianParents`. Per-niche keyword
  filter.
- **Hacker News** (existing `sources/hackernews.py`) — only where a niche has
  a tech angle (commuter accessories, hard-water hair care).
- **Product Hunt** RSS — new entrant velocity (free, public).
- **Google Trends** — deferred (fragile, no stable free API). The collector
  records `momentum: null` with a `freshnessDate` until a stable path exists.
- **Meta Ad Library** — deferred to manual qualitative checks (API limited for
  India commercial ads). The collector records `adSaturation: null` until then.
- **Marketplace / brand pages** — deferred (per-site fragility). The collector
  records `pricing: null` until a per-niche allowlist is built.

This keeps Slice 2 to free, citable, durable sources and leaves the brittle
ones as explicit `null` with a freshness date — matching the PRD's "start with
artifacts and explicit freshness dates" risk mitigation.

### 6. Renderer integration

- `/opportunities`: new "India D2C Opportunity Briefs" section after the
  existing evidence grid. Shows all 20 briefs (or the latest N with real
  evidence), each with verdict, confidence, target user, problem, evidence
  mix, risks, next validation step.
- `/brief` section 02: when `region=south-asia`, prepend up to 3 India D2C
  briefs to the ideas list (real D1 community ideas still win the rest of the
  slots). For `global`, include 1 rotating India D2C brief so the surface is
  visible without switching regions.

### 7. What stays out

- No D1 migration, no `d2c_niches` / `d2c_niche_snapshots` tables (Slice 3).
- No agent-visibility overlay (Slice 4).
- No automated brand outreach, no inventory/fulfillment tooling.
- No impuls8 scraping or data copying.
- No paid data provider dependency.
