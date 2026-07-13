# Plan 0013 - India D2C Opportunity Pipeline

Status: implemented (slices 1–4); operational follow-ons tracked in `PROJECT_STATUS.md`
Created: 2026-07-05
Last updated: 2026-07-13
Reference: impuls8 workflow review, High Signal Opportunity Briefs
Depends on: Daily Brief section 02, `openspec/specs/opportunity-briefs/spec.md`, `plans/0012-ai-visibility-and-reddit-intent-response.md`

## One-line thesis

High Signal should build a small, owned, cited India D2C opportunity pipeline that produces decision-grade Opportunity Briefs (`test/watch/avoid`) from public signals, instead of copying a competitor's directory or scores.

## Why now

impuls8 validates the workflow: Indian D2C founders want to know which niches have demand, low competition, pricing gaps, and acquisition saturation before spending money on inventory, branding, or ads.

High Signal should not scrape or redistribute impuls8 data. Their product is a benchmark, not a source. The opportunity is to build a smaller but more trustworthy pipe:

1. public evidence in,
2. niche-level weekly aggregates,
3. cited Opportunity Brief out,
4. hit-rate / aging tracked over time.

This matches High Signal's moat better than a broad directory: cite-or-kill, confidence bands, source diversity, and eventual hit-rate.

## Target user

- Solo or small-team Indian D2C founders validating a first SKU.
- Operators considering a new category before spending on inventory or ads.
- Agencies/consultants who need evidence-backed category briefs for clients.

## User problem

Small D2C operators can see broad trends, but they cannot quickly answer:

- Is this category actually getting demand, or just hype?
- Are there already too many brands?
- Which price band is crowded or open?
- Are ads already saturated?
- What exact product wedge should I test first?
- What evidence supports the call?

## Product output

Each output is an **India D2C Opportunity Brief**:

```text
Niche: Hair growth + scalp support
Verdict: TEST
Confidence: medium
Target user: Indian men 22-35 seeing early thinning / scalp irritation
Problem: people search for minoxidil compatibility and irritation support, not generic hair oil
Why now: search/category momentum + repeated public questions + manageable first-SKU wedge
Demand evidence: cited community/search/review items
Competition: top substitutes + count band
Pricing: visible price range and testable opening
Ad saturation: observed Meta ad intensity where available
Agent visibility: what AI assistants recommend for the category
Risks: claims/compliance, generic positioning, retention uncertainty
Next validation: landing page + 10 interviews + pre-order or waitlist test
```

## Scope

### In scope

- India only.
- 20 initial D2C niches, not 3,500 brands.
- Weekly aggregation, not real-time monitoring.
- Public/free or low-friction sources first.
- Cited Opportunity Briefs rendered through the existing Daily Brief section 02 and/or `/opportunities`.
- Deterministic scoring first; LLM summarization optional and fail-closed.

### Out of scope

- Scraping impuls8 or copying its database.
- Building a full D2C brand directory.
- Paid data providers as a dependency for MVP.
- Automated brand outreach.
- Medical or financial claims without conservative wording.
- Inventory, supplier, or fulfillment tooling.

## MVP data sources

Use only sources High Signal can access and cite directly:

| Signal | Source | Access posture | MVP use |
| --- | --- | --- | --- |
| Community demand | Reddit India/startup/beauty/fitness/investing subs, HN where relevant | Free API within limits | complaint and "looking for X" clusters |
| Search momentum | Google Trends web/RSS/alpha where available | Free but API access limited/fragile | 4w/12w movement by niche keywords |
| Product/pricing | Brand websites, Shopify product pages, marketplace pages when public | Public web, per-site fragility | min/median/max price bands and SKU claims |
| Reviews/complaints | Public app/marketplace/product reviews where accessible | Mixed but often public | repeated missing-feature or quality complaints |
| Ad saturation | Meta Ad Library public UI/API where legal/available | Public UI; API limited for India commercial ads | qualitative ad-intensity check for selected niches |
| Launch/new entrants | Product Hunt, news/RSS, brand sites, social profile discovery | Mostly free | new entrant velocity |
| Agent visibility | ChatGPT/Gemini/Perplexity prompts through existing Mentions/OpenLens machinery | Keyed where configured | which brands agents recommend and cite |

## Initial niche list

Start with niches where a small brand can test one SKU or kit:

1. Hair growth + scalp support
2. Lip + intimate skincare for sensitive skin
3. Hard-water hair care
4. Beard dandruff / beard scalp care
5. Post-gym men's skin wipes / sweat care
6. Delivery-rider phone accessories
7. Heat-resistant phone mounts / commuter accessories
8. Office chai healthy snacks
9. Diabetic-friendly travel snacks
10. High-protein regional snacks
11. Affordable home-gym accessories under INR 5,000
12. Women's gym shorts / support and fit
13. Baby lotions/oils with transparent ingredients
14. Ayurvedic face care with proof-first positioning
15. Sustainable cleaning/laundry refills
16. Pet health supplements
17. Oral care sub-niches
18. Sleep/stress support products
19. Intimate hygiene
20. Condiments/sauces with regional identity

## Scoring model

Each niche gets a 0-100 opportunity score, but the score is secondary to the verdict and evidence.

Suggested weights:

- Demand momentum: 30
- Source diversity: 15
- Competition gap: 20
- Pricing gap: 15
- Ad saturation / acquisition difficulty: 10
- Agent visibility gap: 10

Verdict rules:

- `TEST`: demand evidence + manageable competition + clear first SKU.
- `WATCH`: promising but thin/corroboration missing.
- `AVOID`: saturated, weak demand, compliance-heavy, or no clear wedge.
- `ENTER`: reserved until enough historical evidence and validation proof exists.

## Data model draft

Add only when implementation needs persistence:

```sql
CREATE TABLE d2c_niches (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'IN',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE d2c_niche_snapshots (
  id TEXT PRIMARY KEY,
  niche_id TEXT NOT NULL,
  snapshot_date INTEGER NOT NULL,
  demand_score INTEGER NOT NULL,
  competition_score INTEGER NOT NULL,
  pricing_score INTEGER NOT NULL,
  ad_saturation_score INTEGER,
  agent_visibility_score INTEGER,
  opportunity_score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);
```

If a no-migration first slice is preferred, store the first weekly run as JSON under `data/d2c-opportunities/` and render from that artifact.

## UI / API

MVP surfaces:

- `/brief` section 02: include top 3 India D2C Opportunity Briefs when `region=south-asia` or `region=india` equivalent exists.
- `/opportunities`: add an India D2C filter or section.
- Optional API: `GET /opportunities/d2c?region=IN&limit=20`.

Each card must show:

- verdict and confidence
- niche/category
- target user
- problem
- evidence mix with cited sources
- competition/pricing/ad notes
- risk
- next validation step

## Implementation slices

### Slice 1 - Static seed and renderer

- Add 20 India D2C niche seeds.
- Generate deterministic Opportunity Briefs from the seed evidence shape.
- Render in `/opportunities` and optionally brief section 02.
- No new external fetchers.

### Slice 2 - Weekly source collector

- Pull narrow Reddit/community/search/product-page samples for the 20 niches.
- Write JSON artifacts with evidence URLs and extracted snippets.
- Add source-quality reporting.

### Slice 3 - Scoring and history

- Aggregate weekly snapshots.
- Show score deltas and verdict changes.
- Track whether prior `TEST/WATCH/AVOID` calls aged well.

### Slice 4 - Agent visibility overlay

- Run category recommendation prompts.
- Record which brands are recommended and cited.
- Add "agent answer gap" to the Opportunity Brief.

## Acceptance criteria

- At least 20 India D2C niches have Opportunity Briefs with cited evidence or explicit seed placeholders.
- Each brief has verdict, confidence, target user, problem, evidence mix, risks, and next validation step.
- At least 5 niches have real public evidence from two or more source classes.
- The system does not ingest or depend on impuls8 data.
- The first implementation has no new paid source dependency.
- The output is visible from `/opportunities` or `/brief`.
- A targeted test covers the scoring/verdict mapping.

## Risks

- **Source fragility**: Google Trends and marketplace pages may be brittle. Mitigation: start with artifacts and explicit freshness dates.
- **False confidence**: small public samples can overstate demand. Mitigation: use `WATCH` by default until source diversity is real.
- **Compliance**: health/beauty claims can drift into medical language. Mitigation: conservative copy and claims boundary.
- **Directory creep**: the work can expand into brand database busywork. Mitigation: cap MVP at 20 niches and decision briefs.

## Devin handoff

Ask Devin to review this PRD and produce an implementation plan for Slice 1 and Slice 2 only:

- keep changes scoped,
- avoid paid data dependencies,
- do not scrape or copy impuls8,
- prefer JSON artifacts before D1 migrations,
- preserve High Signal's evidence-first Opportunity Brief contract.
