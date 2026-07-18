# STATUS — High Signal

> Short view of the current objective, active work, blockers, and next steps.
> The detailed, dated ledger is [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
> (authoritative for "what shipped and when"). Update both together when active
> scope changes. Last updated: 2026-07-18.

## Current objective

Ship and harden **one product**: the synthesized **Daily Brief** across
technology / startups / finance, global by default with a free region filter,
five sections (three public, two brand-connected). Free; no billing. The moat
is the public hit-rate ledger + cite-or-kill evidence. Auto-publish runs daily
with no human gate.

## Active work (snapshot)

- **Company universe** — rebuilt around official YC / Antler / a16z / Techstars
  directories: 12,964 companies, 34,248 reciprocal similarity edges, paginated
  search via D1. (See `PROJECT_STATUS.md` 2026-07-15 entries.)
- **AI Visibility (GEO) upgrade** — multi-model fan-out + LLM-judge + persona
  segmentation + packaged report on Mentions. Operator step: set
  `OPENAI_API_KEY` / `GEMINI_API_KEY` / `PERPLEXITY_API_KEY` / `ANTHROPIC_API_KEY`
  on `high-signal-api` to light up multi-model.
- **Brief email delivery (plan 0009)** — local surfaces complete; production
  send still gated (see Blockers).
- **Plans 0008 / 0010 / 0011 / 0012 / 0013** — local acceptance complete;
  remaining work is operator/external steps tracked in `PROJECT_STATUS.md`.

## Blockers

- **Brief email delivery** requires `EMAIL_FROM`, `API_BASE`, Cloudflare Email
  Routing setup (DKIM/SPF), and destination verification before the cron sends
  real mail. Remote migration 0019 is applied.
- **Clerk production instance** — site runs on the Clerk dev key; production
  cutover is a manual dashboard + DNS step
  ([`docs/operations/runbooks/clerk-production.md`](docs/operations/runbooks/clerk-production.md)).
- **USPTO PatentsView** in ODP transition — may return no events.
- **Cloudflare CPU abuse** — a hosting-ASN scanner was issuing ~166k req/day
  over plain HTTP; mitigated 2026-07-12 (HTTP→HTTPS redirect + IP guard +
  AI-crawler 404s on query-heavy history surfaces). Keep the guard until traffic
  stays normal for a full billing cycle; prefer a WAF rule when zone rules
  permission is available.
- **D1 remote migrations** — most applied; verify with
  `wrangler d1 migrations list high-signal-db --remote --config workers/api/wrangler.toml`
  before any deploy that depends on a new table.

## Unresolved questions

- Should `events` be split into "source observations" vs "actionable normalized
  events"? (Open since `docs/product/feature-audit.md`; flagged in scope reset.)
- When does the data substrate boundary (`docs/architecture/data-service-boundary.md`)
  become a real service instead of in-repo adapters?
- When is the right time to reintroduce a paid tier / region gating? (Deferred
  until usage proves willingness-to-pay.)

## Next steps (operator)

1. Finish Email Routing setup + `EMAIL_FROM` to unblock cron-driven brief delivery.
2. Cut Clerk to production (`docs/operations/runbooks/clerk-production.md`).
3. Set remaining source API keys: `FRED_API_KEY`, `ETHERSCAN_API_KEY`,
   `COMPANIES_HOUSE_API_KEY` (highest-value manual signups — see `PROJECT_STATUS.md`).
4. Keep the Cloudflare CPU abuse guard under observation; convert to a WAF rule
   when zone rules permission is available.
5. Run `pnpm docs:check` and keep this knowledge base current when scope shifts.
