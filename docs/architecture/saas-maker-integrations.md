---
title: SaaS Maker Integrations
description: How High Signal reuses the user's @saas-maker/* packages and where it deliberately does not.
---

# SaaS Maker Integrations

Reuse the user's `@saas-maker/*` packages instead of rebuilding. The list below
records what is reused and what was deliberately dropped (2026-06-20 cleanup —
see `../../PROJECT_STATUS.md`).

## Reused

- **AI provider** — calls the `free-ai` gateway directly via
  `workers/api/src/lib/ai-client.ts` (no `@saas-maker/ai` package; signal
  generation, summarization).
- **DB** — own `@high-signal/db` workspace package (Drizzle on Cloudflare D1,
  schema in `packages/db/src/schema.ts`); no shared SaaS Maker DB package.
- **Observability** — PostHog directly (no `@saas-maker/ops`).
- **App Health** — published `@saas-maker/app-health` 0.4.0 for endpoint
  measurements and explicit logs in both Workers; App Health's browser tracker
  for page views, reading actions, sessions, and live presence. PostHog and
  Clarity remain in place. The public footer links to a revocable aggregate-only
  live viewer. See the [rollout checklist](../operations/runbooks/app-health.md).
- **Email** — `cloudflare:email` binding (`workers/api/src/lib/email.ts`); no
  SaaS Maker email package.
- **Analytics** — PostHog directly (`apps/web/src/lib/foundry-monitoring.ts`);
  no SaaS Maker analytics package.
- **`@saas-maker/feedback-widget`** — feedback on every signal card.
- **`@saas-maker/waitlist-widget`** — pre-launch landing.
- **`@saas-maker/{eslint,prettier,tsconfig}-config`** — shared tooling (note:
  these were removed 2026-06-20 in favor of local configs + Biome; see
  `../../PROJECT_STATUS.md`).

## Deliberately dropped (2026-06-20)

`@saas-maker/ops`, `@saas-maker/ai`, `@saas-maker/analytics-sdk`, and the shared
eslint/tsconfig npm deps were removed. Workers use a local `ai-client.ts`; root
lint uses Biome. Do not reintroduce these without a clear reason — they added
dependency weight without unique value once PostHog + the local AI client were
in place.
