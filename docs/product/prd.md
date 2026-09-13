# High Signal — product requirements

Status: final product and acceptance contract, 2026-09-13.

Implementation and release evidence belong in
[`PROJECT_STATUS.md`](../../PROJECT_STATUS.md). This PRD defines the product; it
does not by itself certify a deployment.

## Purpose and audience

High Signal is a public news product for readers following meaningful changes
in technology, startups, and finance. It reduces noisy public information to
one dated edition with clear reporting, inspectable sources, and honest
market-call outcomes.

## Reader promise

For every material item, High Signal answers:

1. What changed?
2. Who is affected?
3. Why does it matter now?
4. What evidence supports it?
5. What remains uncertain?
6. If it makes a directional call, what happened afterward?

## Core workflow

Collect public information → retain source observations → deduplicate and
cluster related coverage → publish a dated edition → let readers inspect the
proof and market context → publish corrections and evaluate matured calls.

## Requirements

### R1. Daily edition

- Today and yesterday SHALL be public, anonymous, and region-filterable.
- The edition SHALL show its date and freshness.
- Source-linked news MAY appear without a qualifying market signal.
- The edition SHALL have no target item count and SHALL NOT use seed, synthetic,
  or filler content to make a section look complete.

### R2. Evidence and publication

- Every directional or analytical signal SHALL pass the shared publishability
  rules before appearing on any public surface.
- A publishable signal SHALL have semantically aligned support from at least two
  public URLs and independent evidentiary origins.
- Attention sources MAY raise investigation priority but SHALL NOT receive
  evidence or confidence credit by themselves.
- Each published signal SHALL expose what changed, why it matters, its principal
  uncertainty, affected entities, and its source evidence.

### R3. Market context

- Markets and equities SHALL remain reporting context, not a second product.
- All scheduled equity, ETF, index, and crypto closes SHALL enter through the
  single yfinance snapshot path.
- Prediction-market probabilities SHALL remain distinct from equity prices and
  SHALL NOT independently support publication.

### R4. Accountability

- Signals SHALL retain a public chronological history.
- Published signal markdown SHALL be append-only.
- A correction SHALL be a new record that cites and supersedes the prior signal;
  it SHALL NOT rewrite the original.
- Track Record and backtests SHALL show sample sizes, pending outcomes, and
  evaluation assumptions. Direct hit rates SHALL appear only after that exact
  signal type has enough matured outcomes.

### R5. Supporting research

- Sources, Company Universe, entities, sectors, convergence, market context,
  and Community Intelligence MAY remain public when they help readers inspect
  or understand the reporting.
- Community Intelligence SHALL remain an operator-curated input until Reddit
  Insights can replace its raw collection and history without losing the digest
  and brief contracts.

### R6. Honest system states

- Ready, empty, and unavailable states SHALL be explicit and distinguishable.
- An unavailable category SHALL NOT be silently replaced with stale, synthetic,
  or unrelated data.
- Reader-facing web, REST, feeds, and MCP surfaces SHALL apply the same
  publication and history boundaries.

### R7. Access and operations

- Reader access SHALL remain public and account-free.
- Cloudflare Access SHALL protect only bounded operator review and publishing
  paths; machine credentials SHALL remain server-side.
- GitHub Actions SHALL own scheduled ingestion, publishing, validation, market
  refresh, and scoring. Deployments SHALL remain explicit release actions.

## Product boundaries

High Signal owns editorial selection, reporting, publication, source proof,
market context, and market-call evaluation. The detailed ownership map is in
[`ecosystem.md`](ecosystem.md).

High Signal does not own:

- reader accounts, personalization, billing, or paid tiers;
- personal command briefs or generic product recommendations;
- D2C niche scoring, generic idea ranking, or generic reel generation;
- brand monitoring, AI visibility, competitor perception, or agent evaluation;
- a local Lab or vector-search product;
- a second equity-price ingress.

Brand intelligence belongs to Mentionpilot. Raw Reddit collection and history
may move to Reddit Insights only after contract parity is demonstrated.

## Acceptance criteria

The product satisfies this PRD when all of the following are true:

1. An anonymous reader can open today or yesterday, see the correct edition
   date and region, and distinguish ready, empty, and unavailable content.
2. A news item links to its original public source even when the edition has no
   publishable signal.
3. A published signal opens a proof page containing its reporting, uncertainty,
   claim provenance, and at least two independently originated supporting
   sources.
4. Signals, the Daily Brief, public JSON/feeds, and MCP agree on publication and
   bounded-history eligibility.
5. A correction preserves the original record and links the successor and prior
   claim in public history.
6. Track Record exposes matured and pending outcomes, sample size, and the
   evaluation assumptions without presenting an unqualified aggregate as a
   direct hit rate.
7. Market pages consume the canonical equity snapshot and visually distinguish
   prices from prediction-market probabilities.
8. Retired product routes, scheduled jobs, runtime imports, and synthetic brief
   fallbacks are absent from active code.
9. Repository formatting, types, tests, builds, documentation checks, and the
   relevant browser journey pass for the release candidate.
10. Production is called complete only after the exact revision is deployed and
    the anonymous reader journey is reverified live.

## Success measures

Measure returning readers, useful-story feedback, source coverage and freshness,
correction rate, and forecast calibration. Publication volume is not a quality
target.

## Locked sequence and deferred decisions

First prove reliable news production and reader usefulness while retaining the
market workflows and current Community Intelligence inputs. Distribution
expansion, monetization, and the Reddit Insights transfer are later decisions
with their own acceptance contracts; they are not unresolved requirements for
this product.
