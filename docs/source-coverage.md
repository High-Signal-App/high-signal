# Source Coverage And Launch Scope

Status: launch policy
Updated: 2026-05-16

High Signal should generate a useful review queue every day, but it should not
generate random insights. The public product exists to produce decision-grade
signals for an active collection. The rule is:

- Generate drafts broadly inside the active collection.
- Publish selectively.
- Label weak evidence as `low` confidence instead of hiding it.

Every generated insight should answer:

- What changed?
- Who is affected?
- Why does it matter for this collection?
- What direction does it imply?
- What evidence supports it?
- What should a reviewer or reader do next: watch, publish, correct, score, or kill?

## V0 Launch Scope

### Market Intelligence

This is the launch-ready insight product.

Generate daily draft signals from:

- `news` — RSS plus article extraction from seeded AI-infra / semiconductor sources.
- `edgar` — 8-K daily; 10-Q and 10-K on wider windows.
- `ir` — company investor relations and press-release feeds.
- `gov` — export controls, policy, standards, and regulator feeds.
- `gdelt` — broad news backstop and historical replay source.
- `reddit` — public community weak signals.
- `github` — releases and repo activity for AI infrastructure projects.
- `youtube` — transcripts from selected technical / market channels.
- `hkex` — HK-listed AI and semiconductor announcements.
- `markets` — prediction-market quotes; these are resources for context and scoring, not primary signal cards.

Default cadence:

- Daily 06:00 UTC: `pipeline --source all --days 1`
- Every 4h: `pipeline --source markets`
- Daily 22:30 UTC: score matured signals
- Manual backfill: `gdelt,edgar` first, then widen only after review quality is stable

Stock scope:

- Track Indian public markets as the national watch layer.
- Track US/global names and sectors as the international watch layer.
- Keep the first pass high level: direction, confidence, affected names, sector pressure, and watch/ignore guidance.
- Do not expand into deep valuation models, full analyst reports, or exhaustive single-stock research yet.

Product opportunity handoff:

- When a market or world-level change implies a new constraint, buyer urgency, budget shift, regulatory requirement, or workflow breakage, it should feed `/opportunities`.
- The output should say what product might need to be built, who it is for, why now, and what evidence or complaint cluster supports it.

### Mention Intelligence

Generate product data, not public market signals yet.

Ready now:

- Brand configs
- Prompt-based AI mention checks
- Visibility score / badge API
- Dashboard surface

Not launch-ready as unified signals until the outcome metric is defined:

- visibility gain
- citation gain
- competitor share-of-voice delta
- alert resolution

### Community Intelligence

Generate source-linked digests, not public market signals yet.

Community Intelligence should also observe smaller app requirements and common complaints:

- repeated missing features
- common workflow friction
- support or setup complaints
- requests for integrations, control, monitoring, pricing clarity, privacy, or reliability
- repeated "how do I do X" questions that imply an app/tool gap

Ready now:

- Tracked community contract
- Reddit summary normalization
- Archive pages
- Dashboard surface

Not launch-ready as unified signals until the outcome metric is defined:

- repeated pain cluster
- post/comment velocity
- manually marked usefulness
- buying-intent conversion

## Confidence Policy

## Dynamic Insight Types

The seed taxonomy in `python/ingest/src/high_signal_ingest/seed/signal_types.yaml`
is a starting vocabulary, not a closed list.

Generation should prefer seeded types when they fit because that keeps the
track-record ledger easier to compare over time. When a source event clearly
does not fit the seeded taxonomy, the generator may create a new concise
`snake_case` `signal_type`, but only for a repeatable insight pattern tied to
the active collection.

Examples:

- `pricing_page_change`
- `customer_churn_signal`
- `developer_adoption_spike`
- `credit_facility_update`
- `regulatory_comment_window`

Reviewers should merge noisy one-off types back into an existing type when they
are only wording variants. New types should survive when they represent a
repeatable insight pattern with a distinct source mix, horizon, or outcome
metric.

Do not keep types that are just random observations, generic news labels, or
one-off phrasing.

## Kill Criteria

Delete or ignore a draft when:

- It is generic market commentary with no entity-specific catalyst.
- It is off-collection.
- It is only a duplicate syndication wave.
- It has no plausible action beyond "interesting."
- The dynamic type is just a wording variant of an existing type.
- The evidence does not support the direction or confidence.

### Low Confidence

Use for single-source, weak-source, rumor, or early uncorroborated clues.

Low-confidence drafts are allowed and expected. They keep the review queue from
going dark and make weak signals visible. They should not be auto-published
unless the source itself is authoritative or the review note explains why the
single-source item matters.

### Medium Confidence

Use for two corroborating sources without an official primary source.

Medium-confidence drafts are publishable after review if the evidence is not
duplicative and the entity-specific catalyst is clear.

### High Confidence

Use for an official source plus corroborating coverage.

Examples:

- SEC / HKEX filing plus tier-1 coverage
- Company IR release plus credible industry reporting
- Government rule text plus company-specific impact coverage

## Source Credit Policy

Every signal needs visible evidence credit:

- Drafts may have one source if confidence is `low`.
- Published medium/high signals need at least two distinct evidence URLs.
- Evidence URLs should point to the primary source where possible, not only a syndication copy.
- Backfilled signals must keep the historical source date as `published_at`.
- Corrections are new signals; do not rewrite published history.

## What Is Not Ready

Do not expand launch positioning around these yet:

- paid / licensed transcripts
- internal customer documents
- CRM / pipeline data
- broad Indian markets
- mobile or Slack/Discord alerts
- generalized multi-wedge market intelligence
- deep single-stock research before the high-level national/international watch layer works

These can wait until the AI-infra market collection has a stable daily review
queue and enough scored outcomes to make the track record meaningful.

## Readiness Call

High Signal is ready to position as:

> Daily evidence-backed AI-infra market signals, with confidence bands, source
> credit, spillover maps, and a public hit-rate ledger.

For product builders, High Signal should also be ready to position as:

> Put in an idea; High Signal checks it against market, community, mention, news,
> and resource flow, then tells you whether to pursue, test, watch, or avoid.

It is not yet ready to position as:

> A universal intelligence platform across all companies, communities, and
> customer data.
