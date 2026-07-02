# Plan 0012 - AI Visibility and Reddit Intent Response

Status: accepted / scaffolded
Created: 2026-06-30
Last updated: 2026-06-30
Reference: https://octolens.com/, https://www.aipeekaboo.com/, https://www.subredditsignals.com/
Depends on: `plans/0011-openlens-visibility-steal-list.md`, `plans/0006-agent-evaluation-attention-layer.md`

## Implementation state

The first slice is scaffolded:

- D1 migration `packages/db/migrations/0014_intent_opportunities.sql`.
- Drizzle schema `intentOpportunities` in `packages/db/src/schema.ts`.
- Worker routes:
  - `GET /products/mentions/:brandId/intent-opportunities`
  - `POST /products/mentions/:brandId/intent-opportunities/refresh`
  - `PATCH /products/mentions/:brandId/intent-opportunities/:id`
  - `POST /products/mentions/:brandId/intent-opportunities/:id/reply-draft`
- Refresh scans recent D1 community events (`reddit`, `hackernews`, `stackexchange`, `lobsters`, `substack`) for brand aliases and competitor names, then classifies buyer stage/action type with `annotateLightweightNlp`.
- Refresh links proof/docs/comparison/content intent items to open `agent_evidence_tasks` on the latest same-owner, same-brand Agent Eval audit when one exists.
- Mention checks trigger the same intent refresh helper after completion; failures are caught so missing migration/table state does not break the check run.
- Optional reply drafts use the existing OpenAI-compatible High Signal AI config. Without a key, the route returns `ai_not_configured` and leaves the inbox item unchanged.
- `/mentions/[brandId]` has an `intent` tab with refresh, draft, done, and dismiss actions.
- `/products/mentions/:brandId/report` and the web report tab now include top open intent opportunities.

Remaining work:

- Apply migration `0014_intent_opportunities.sql` to local and remote D1.

## Why now

Three more live competitors sharpen the near-term bar for High Signal:

- **Octolens** owns broad social listening for the agent era: Reddit, X, LinkedIn, GitHub, HN, podcasts, news, Slack/email/webhooks, full API, and MCP on every plan.
- **Peekaboo** owns the AI visibility dashboard framing: ChatGPT/Gemini/Perplexity/Google AI Mode tracking, visibility score, competitor comparison, cited-content insight, and GSC/Looker/GA/WordPress integrations.
- **Subreddit Signals** owns the Reddit buyer-intent wedge: purchase-readiness classification, subreddit discovery, reply guidance, case-study proof, low-cost plan, and a managed service upsell.

High Signal should not copy these as three separate products. The winning response is one evidence-backed loop:

1. discover where buyers and agents already talk about the brand,
2. classify whether each surface is awareness, pain, comparison, or purchase intent,
3. show which competitors and citations win,
4. turn the gap into proof-page, positioning, content, or reply tasks,
5. track whether the next scan improves visibility and recommendation share.

That loop feeds Daily Brief sections 4 and 5 and the Mentions/Agent Eval lens. It should also produce report-ready artifacts for sales.

## What is already stolen

This is not a fresh roadmap. High Signal already has most of the hard pieces:

- **Mentions** already has brand configs, prompts, checks, competitor reporting, and monitor surfaces.
- **Agent Eval** already scores evidence gaps across trust, pricing, docs, integrations, proof, policies, and transaction readiness.
- **Plan 0011** already covers the OpenLens/Peekaboo-like layer: visibility matrix, share of voice, cited sources, trends, attribute grid, and report-ready view.
- **`opportunities.py`** already covers the RedShip/Subreddit Signals-like layer: community-source monitoring, deterministic scoring, buyer/pain relevance, dedupe, and optional operator-reviewed reply drafts.
- **Brief sections 4 and 5** already define where brand perception and product-improvement outputs belong.
- **Plan 0009** already covers scheduled delivery, logs, snapshots, and email primitives.

The remaining competitor gap is not "steal more features." It is **connect the existing pieces into one visible brand workflow**:

1. persist scored intent opportunities instead of leaving them as a CLI/report artifact,
2. show them beside AI visibility and cited-source gaps on `/mentions/[brandId]`,
3. feed the same findings into the weekly report and Daily Brief,
4. later expose the same objects through API/MCP if usage proves it.

## Competitive bar

### Octolens

What they prove:

- Users want monitored mentions delivered into their existing stack, not another dashboard.
- API, webhook, Slack/email, and MCP are not enterprise extras; they are expected primitives.
- Agent workflows matter: users want Claude/Cursor/automation tools to query mention data directly.

High Signal advantage to build:

- Do not stop at mention delivery. Add source-linked interpretation: why this mention matters, buyer stage, competitor implication, required proof, and whether it should affect the Daily Brief.
- Tie alerts to the evidence graph and hit-rate ledger, so repeated claims become tracked signals rather than disposable notifications.
- Make API/MCP access read the same opinionated objects as the web surface: visibility, cited sources, intent opportunities, proof gaps, and next actions.

### Peekaboo

What they prove:

- AI visibility is a sellable category for brands and agencies.
- Brand-vs-competitor visibility score, visibility over time, citations, and content pickup are table stakes.
- Google Search Console, Looker Studio, Google Analytics, and CMS integrations are useful for agencies, but they can pull the product toward generic SEO.

High Signal advantage to build:

- Keep the focus on agent recommendation worthiness, not generic SEO score inflation.
- Connect citations to actual missing evidence tasks: pricing clarity, integrations, docs, security, proof, comparisons, and support.
- Use High Signal's broader source layer to explain why an AI-answer gap exists: community complaints, competitor launches, docs changes, reviews, source authority, and market context.

### Subreddit Signals

What they prove:

- Reddit lead generation sells when framed as buyer stage, not keyword monitoring.
- Subreddit discovery, reply suggestions, attribution, and managed service are credible wedges.
- Competitor pages and case studies are effective demand-capture surfaces.

High Signal advantage to build:

- Generalize beyond Reddit while keeping Reddit as the first sharp channel.
- Classify intent using High Signal's evidence vocabulary: complaint, evaluation, alternative request, purchase-ready, churn risk, integration need, proof request.
- Produce operator-safe reply drafts and content tasks, never auto-posting or fake-account engagement.

## Product contract

Input:

- brand URL and owned domains
- competitor names and domains
- target buyer topics/prompts
- source scope: AI answers, Reddit, HN, GitHub, Stack Overflow, news/RSS, app reviews
- optional connected analytics sources later: GSC, GA, Search Console exports, CMS

Output:

- visibility score with platform and prompt breakdown
- competitor share-of-voice and citation share
- cited-source index with owned, competitor, third-party, and unknown ownership
- intent inbox of community/social opportunities
- reply drafts and content tasks for operator review
- evidence task list tied to Agent Eval attributes
- report-ready weekly brief and shareable audit URL

## Net-new slice

Build only the smallest missing loop:

1. Extend the existing opportunities scorer into a persisted **intent inbox** for one brand.
2. Classify each item into buyer stage and action type:
   - `complaint`
   - `alternative_request`
   - `purchase_ready`
   - `competitor_mention`
   - `proof_request`
   - `integration_need`
   - `content_opportunity`
3. Add a Mentions detail tab that shows:
   - top buyer-intent items
   - competitor/source involved
   - suggested operator action
   - optional reply draft when AI is configured
   - linked evidence task when the fix is a missing proof page or docs gap
4. Add a weekly report section using existing plan 0011/report plumbing:
   - AI visibility deltas from plan 0011
   - cited-source gaps
   - Reddit/community buyer-intent items
   - top five actions

## API and data shape

Prefer reusing existing tables where possible. Add a table only if persistence is needed for UI/history.

Potential new D1 table:

```sql
CREATE TABLE `intent_opportunities` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text NOT NULL,
  `source` text NOT NULL,
  `source_url` text NOT NULL,
  `source_title` text NOT NULL,
  `source_excerpt` text NOT NULL,
  `platform` text NOT NULL,
  `intent_stage` text NOT NULL,
  `action_type` text NOT NULL,
  `score` integer NOT NULL,
  `competitors` text NOT NULL,
  `evidence_task_id` text,
  `reply_draft` text,
  `status` text NOT NULL DEFAULT 'open',
  `found_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX `intent_opportunities_brand_score_idx`
  ON `intent_opportunities`(`brand_id`, `status`, `score`);
```

Routes, mounted under the existing products surface:

- `GET /products/mentions/:brandId/intent-opportunities?status=&source=&window=`
- `POST /products/mentions/:brandId/intent-opportunities/refresh`
- `PATCH /products/mentions/:brandId/intent-opportunities/:id`
- `POST /products/mentions/:brandId/intent-opportunities/:id/reply-draft`

## UI surface

- `/mentions/[brandId]` gets an `intent` tab next to visibility, sources, trends, and report.
- `/brief` section 4 can mention perception shifts when intent opportunities involve competitor comparison or purchase-ready demand.
- `/brief` section 5 can turn repeated intent items into product/content/docs improvements.
- `/agent-eval/[auditId]/attributes` should link missing evidence tasks back to the intent items that exposed the gap.

## What "better" means

High Signal beats these competitors when:

- a founder can see not just "you were mentioned", but "this buyer is comparing you against X because your Y proof is missing";
- an agency can send a report that includes AI visibility, citations, community demand, proof gaps, and exact next actions in one place;
- an operator can query the same objects via API/MCP later without losing the evidence trail;
- every recommended response or content task links back to cited source material;
- the Daily Brief incorporates the brand-specific changes instead of making the user visit a separate lead dashboard.

## Non-goals

- Auto-posting replies.
- Fake Reddit accounts or engagement automation.
- Generic SEO content generation.
- Broad agency-client dashboards before the brand-connected brief/report loop is used.
- Paid third-party SERP data before the free/source-backed loop proves demand.

## Acceptance criteria

- A connected brand has a persisted intent inbox with scored items from at least Reddit plus one non-Reddit community/dev source.
- Each item has buyer stage, action type, score, source URL, and competitor/proof-gap context when detected.
- The Mentions detail page shows intent opportunities without turning `/communities` back into a standalone product.
- Reply drafts are optional, operator-reviewed, and absent when no AI key is configured.
- Weekly/report output combines AI visibility, cited-source gaps, and buyer-intent opportunities.
- The plan feeds Daily Brief sections 4 and 5.
