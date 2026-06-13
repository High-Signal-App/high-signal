# Plan 0009 - Brief Distribution And Subscription Routing

Status: proposed
Created: 2026-06-12
Depends on: `plans/0004-platform-consolidation.md`, `plans/0001-research-artifact-first.md`

## Thesis

The Daily Brief is the product homepage, but it is still too dependent on the user coming back manually. The next large step is a distribution system that routes the brief to the right channel, at the right time, in the right form.

This is not a generic notification system. It is a brief delivery engine with channel-aware formatting, retention rules, and preference-aware routing.

## Product contract

Input:
- daily brief snapshot
- user region and connected brand state
- channel preferences
- delivery window

Output:
- email brief
- compact push-ready digest
- optional RSS/atom item
- archived delivery history
- delivery status and failures

## Why this matters

- A brief only compounds if it is seen repeatedly.
- Delivery makes the product habit-forming without adding a new content surface.
- Channel routing creates a clean path for future operator and team workflows.

## Target User

- Signed-in users who want the brief without opening the app every day.
- Operators who want a compact record of what was delivered and when.
- Future team users who need the same brief in a readable, non-chat surface.

## Rollout Slice

1. Email delivery for the daily brief only.
2. Delivery history and retry visibility in profile/settings.
3. RSS/Atom and compact digest formats after email is stable.
4. Optional team/operator routing only after single-user delivery works.

## Scope

### Add
- Delivery preferences on the user record.
- A scheduled delivery job for daily brief snapshots.
- Email-first format with graceful fallback to RSS/Atom archival links.
- Delivery history on the profile or settings surface.
- Failure visibility for bounced or skipped sends.

### Keep out
- Social posting automation.
- Generic notification spam.
- Multi-step marketing automation flows.
- Paid-tier gating.

## Dependencies

- Daily brief snapshot generation.
- A user record that can persist delivery preferences.
- An email path or downstream service that can fail loudly and be retried.
- The existing RSS/Atom endpoints for archival fallback.

## Acceptance criteria

- A user can subscribe to a brief delivery channel and receive the same daily brief without manual refresh.
- Delivery failures are visible and retryable.
- The brief format stays consistent with the web surface.
- The channel choice is reversible without data loss.
- Delivery state is logged per user per day so operators can audit what happened.
- A skipped send has an explicit reason, not silent failure.

## Risks

- Messaging can become a second product if not constrained.
- Email deliverability needs a clear owner and a failure policy.
- The system should not drift into a marketing platform.
