# Retro — Daily Brief Reframe

Date: 2026-05-25 (reframe shipped) / confirmed 2026-06-03 (scope reset)
Retro written: 2026-06-13
Prior frame: plan 0004 (five sub-products under an umbrella)
Confirmed by: `docs/scope-reset-2026-06-03.md`

---

## What changed and why

From 2026-04-25 to 2026-05-25 the product was framed as five sub-products under
the "High Signal" umbrella: Market Intelligence, Community Intelligence, Mention
Intelligence, Agent Evaluation Intelligence, and Lab. Each had its own nav item,
its own primary surface, and its own product framing.

On 2026-05-25 Sarthak reframed: one product, one Daily Brief, five sections. The
sub-products became "lenses" — intelligence helpers that feed the brief. Commit:
"Reframe High Signal around the Daily Brief; ship Lab substrate + seed demo."
agents.md locked decisions (2026-05-25): "The five sub-products were demoted to
lenses that feed the brief."

A second confirming step came 2026-06-03: `docs/scope-reset-2026-06-03.md` explicitly
parked Lab, standalone equities, and standalone communities, and set boundary rules
(e.g., "Mentions and agent eval are active only because they produce brief sections
4 and 5").

---

## What the old frame got right

**The domain model was accurate.** Entities, events, signals, evidence, score_runs,
relationships, mention configs, community digests — all of these are still in use.
Plan 0004's domain model translated almost unchanged into the consolidated schema.

**The migration sequencing worked.** Mentionpilot and AgentMode were migrated in a
controlled way (plan 0005 extraction ledger), not deleted. Their product logic
landed in High Signal before the source repos were archived.

**The hit-rate ledger and evidence-first principles survived the reframe.** The
core quality contracts — cite-or-kill, append-only signal memory, public hit-rate —
were never in question. The reframe was about navigation and positioning, not
about the evidence architecture.

---

## What the old frame got wrong

**Five entry points with equal weight created no clear homepage.** When everything
is a primary product, nothing is the reason to come back. The brief gives a daily
reason to return; sub-product deep-dives give a reason to explore.

**Lab had no success metric tied to product value.** Lab was listed as a
sub-product but its only real job was to feed candidates to the review queue. It
did not have a user-facing reason to exist independently.

**Equities expanded too fast before the brief needed it.** The equities snapshot
pipeline grew to 3,226 tickers and Tier 2/3 macro data before the brief's
"stocks watching for a boom" section was proven useful. The scope reset explicitly
parked the standalone equities UI.

---

## What the reframe required technically

- New `/brief/daily` worker route composing five sections from the lenses
- `safe()` wrapper per section to degrade gracefully on D1 errors
- Seed fallback content (35 stock signals, 20 ideas, 18 trends) for empty D1
- Hit-rate family fallback so new signal types borrow sibling confidence
- Primary nav reordered: brief first, lenses second, review last
- `/` (homepage) renders the brief for both signed-in and anonymous users

---

## What was surprising

**Seed fallback made the brief ship fast but creates a hidden quality risk.**
The brief always looks populated, even with zero real data. This was correct for
getting the surface live quickly. The risk is that an operator cannot tell
easily whether the brief is showing real data or seed fallback.

**The auto-publish directive came the same day as the reframe (2026-05-26).**
agents.md: "Sarthak's 2026-05-26 directive: 'I don't want it blocked by me.'"
The reframe and the removal of the human review gate happened within 24 hours.
This created the two-tier judge (ADR-008) as a direct consequence.

**Region is a free filter with 7 demo regions, not a paywall.** Locked decision
2026-05-25: "Everything is free; region is a free filter. Revisit when usage
proves willingness-to-pay." This was a deliberate deferral of monetization,
not a missed opportunity.

---

## Carry-forward

1. Add a visible "showing demo data" indicator in the brief when seed fallback
   is active (currently indistinguishable from real data).
2. The boundary rules from the scope reset should be encoded in agents.md's
   "resist" list so they don't require a second scope reset to re-establish.
3. The brief's quality is now the product's quality — any degradation in a
   lens (broken source, empty digest, failed mention check) directly affects
   what users see. Monitor lens health as part of the brief health.
