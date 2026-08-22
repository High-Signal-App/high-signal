# Plan 0009 - Brief Distribution And Subscription Routing

Status: accepted / scaffolded
Created: 2026-06-12
Last updated: 2026-06-13
Depends on: `plans/0004-platform-consolidation.md`, `plans/0001-research-artifact-first.md`

## Implementation state

This PRD is complete as a product spec and accepted into active scope. The v1 scaffold now exists:

- D1 migration `packages/db/migrations/0010_brief_delivery.sql`.
- Worker routes mounted under `/delivery/*`: `GET/POST /delivery/preferences`, `GET /delivery/log`, `POST /delivery/test`, and cron entry `POST /delivery/internal/run`.
- Email transport through Cloudflare Email Routing's native `send_email` binding (`env.SEND_EMAIL`, `env.EMAIL_FROM`), with MIME rendering in `workers/api/src/lib/email.ts`.
- Clerk-fronted Next.js proxy at `/api/delivery/[...path]`.
- User settings page at `/settings/delivery` and admin delivery summary at `/admin/delivery`.
- Unit coverage in `scripts/brief-delivery.test.ts`.

Remaining implementation/operator work is intentionally tracked as follow-up, not as PRD uncertainty:

- Apply migration `0010_brief_delivery.sql` to local and remote D1.
- Configure Email Routing for the zone, verify DKIM/SPF, and choose either fixed `allowed_destination_addresses` or Cloudflare's per-destination verification flow.
- Set `EMAIL_FROM` and `API_BASE` in worker vars; without `API_BASE`, the cron explicitly skips snapshot composition.
- Add the GitHub Actions schedule that POSTs to `/delivery/internal/run` with `ADMIN_TOKEN`.
- Add manual retry route/UI if failed-send retry needs to be user-triggered instead of cron-triggered.

## Thesis

The Daily Brief is the product homepage, but it still depends on the user coming back manually. The next large step is a distribution system that routes the brief to the right channel, at the right time, in the right form.

This is not a generic notification system. It is a **brief delivery engine** with channel-aware formatting, retention rules, and preference-aware routing. The brief is the payload; delivery is a thin transport layer.

## Product contract

Input:
- a daily brief snapshot (region + connected-brand state at delivery time)
- per-user channel preferences (channels enabled, time window, region override)
- a delivery window resolved from user timezone

Output:
- one email rendering of the brief (primary channel)
- a compact summary digest (header + 3 lines per section) for future push/Slack
- a stable RSS/Atom item per snapshot
- a delivery log row per user per day with status and reason
- a delivery history view in profile/settings

## Why this matters

- A brief only compounds if it is seen repeatedly. Sarthak's "I don't want it blocked by me" directive (the auto-publish rule) only matters if readers actually receive the result.
- Delivery makes the product habit-forming without adding a new content surface.
- Channel routing creates a clean path for future operator and team workflows without turning High Signal into a marketing platform.

## Target user

- Signed-in users who want the brief without opening the app every day.
- Operators who want a compact record of what was delivered and when.
- Future team users who need the same brief in a readable, non-chat surface.

## User stories

1. As a signed-in user, I open `/settings/delivery`, enable email, set a 07:00 window in my timezone, and pick a region. I receive an email at the next 07:00 boundary.
2. As a user who broke my preferred channel (email bounce), I see a "last delivery failed" banner on `/settings` with the reason and a retry button.
3. As an operator, I look at `/admin/delivery` and see per-day delivery counts, failure rates, and the most recent skip reasons.
4. As a power user, I subscribe my reader to the per-region Atom feed and get the same content the email channel produces.
5. As a user who unsubscribes, I see no delivery the next day; my preference is reversible without losing prior delivery history.

## Core workflow

1. A scheduled worker (`cron-deliver-brief.yml`, GitHub Actions, 06:00 UTC fan-out window) walks `delivery_preferences` rows whose computed local-time window is currently open.
2. For each user, it composes the brief snapshot (reuses `/brief/daily` worker route with the user's region + connected brand state).
3. It renders the snapshot into the channel-specific format (HTML email today).
4. It sends via the configured email provider; result and provider message id land in `delivery_log`.
5. Failures are retried with backoff (3 attempts over 6 hours), then surface to the user on `/settings/delivery` as "last delivery failed".
6. A user who toggles a channel off has no row inserted for the next day; the preference change is logged.

## Channels in scope

| Channel | Phase | Format | Provider |
|---|---|---|---|
| Email | 1 | HTML + plain-text fallback | Cloudflare Email Routing `send_email` binding (`env.SEND_EMAIL`, `env.EMAIL_FROM`) |
| RSS/Atom | 1 | Existing `/digest/{rss,atom}` extended with per-user token | Worker |
| Compact digest | 2 | JSON payload for future push/Slack | Worker (internal only at first) |
| Slack/Discord webhooks | 3 | Defer — only if a real user asks |

No SMS. No marketing-style HTML campaigns. No in-app push.

## Data model (D1)

Migration `0010_brief_delivery.sql`:

```sql
CREATE TABLE `delivery_preferences` (
  `user_id` text PRIMARY KEY NOT NULL,
  `channel` text NOT NULL,             -- 'email' | 'rss' | 'digest_json'
  `enabled` integer NOT NULL DEFAULT 1,
  `email` text,                        -- canonical email at sign-up time
  `region` text NOT NULL DEFAULT 'global',
  `timezone` text NOT NULL DEFAULT 'UTC',
  `local_window_start` text NOT NULL DEFAULT '07:00', -- HH:MM
  `connected_brand_id` text,           -- optional, for personal brief sections
  `rss_token` text,                    -- private feed token
  `updated_at` integer NOT NULL
);
CREATE INDEX `delivery_preferences_channel_idx` ON `delivery_preferences`(`channel`, `enabled`);

CREATE TABLE `delivery_log` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `channel` text NOT NULL,
  `brief_date` text NOT NULL,          -- YYYY-MM-DD in user local tz
  `status` text NOT NULL,              -- 'queued' | 'sent' | 'failed' | 'skipped'
  `reason` text,                       -- skip/fail reason
  `provider_message_id` text,
  `attempt` integer NOT NULL DEFAULT 1,
  `sent_at` integer,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `delivery_log_user_day_chan_idx`
  ON `delivery_log`(`user_id`, `channel`, `brief_date`);
CREATE INDEX `delivery_log_status_idx` ON `delivery_log`(`status`, `created_at`);

CREATE TABLE `delivery_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `brief_date` text NOT NULL,
  `region` text NOT NULL,
  `snapshot_json` text NOT NULL,        -- the rendered brief snapshot
  `created_at` integer NOT NULL
);
CREATE INDEX `delivery_snapshots_user_day_idx`
  ON `delivery_snapshots`(`user_id`, `brief_date`);
```

`delivery_log_user_day_chan_idx` makes the cron idempotent: if it re-runs in the same day, the unique index prevents double-send.

## API surface (worker)

New routes under `workers/api/src/routes/delivery.ts`:

- `GET /delivery/preferences` — read current user's preferences.
- `POST /delivery/preferences` — upsert preferences.
- `POST /delivery/test` — send a one-off test email of today's brief snapshot.
- `GET /delivery/log` — last 30 days of delivery rows for current user.
- `POST /delivery/retry/:logId` — planned manual retry endpoint; cron retry/backoff is in the scaffold.
- `GET /digest/rss?token=…` — extended existing route with per-user token auth.
- `POST /delivery/internal/run` — invoked by `cron-deliver-brief.yml`; processes the current window.

`POST /delivery/internal/run` is the cron entry point. It is the **only** worker route that mutates `delivery_log` based on a brief snapshot; preferences updates from the UI never write `delivery_log` directly.

## Web surface

- `/settings/delivery` — toggle channel, set timezone/window/region/brand, "send test now" button, last 30-day delivery list with status badges.
- `/settings` profile page links to `/settings/delivery`.
- Bounce/failure banner on `/settings` and on `/brief` when the most recent attempt failed.
- `/admin/delivery` — per-day delivery counts, top failure reasons, retry queue.

No marketing copy on these pages. Reuse existing `system/*` components — the futurist + clean rule still applies.

## Email format

- Subject: `High Signal — {brief_date} ({region})`
- Sender: `brief@high-signal.app` (DKIM + SPF set up on the email provider).
- Header: brand mark, brief date, region, "view in browser" link.
- Body: identical section order to `/brief`: stocks → ideas → trends → perception → improvements.
- Each item: claim text, two evidence links (max), hit-rate badge inline.
- Footer: "manage delivery" + "unsubscribe" link (one-click, token-authenticated).

Plain-text fallback is auto-generated; both parts always sent.

## Failure policy

- Bounce, complaint, or 4xx from provider → status `failed`, reason captured.
- Three consecutive `failed` rows on the email channel → channel auto-disabled, user notified on next sign-in.
- 5xx → retry with backoff (15min, 1h, 4h). After 3 attempts, mark `failed`.
- "Skipped" reasons must be explicit: `no_brief_today`, `preference_disabled`, `email_not_verified`, `bounced_recently`.
- The cron never silently no-ops a window.

## Telemetry

- `delivery.queued`, `delivery.sent`, `delivery.failed`, `delivery.skipped` with `channel`, `reason` dimensions.
- `delivery.retry_attempted`
- `preferences.changed`
- Daily delivery summary written to `/admin/delivery` health view.

Watch for: failed_rate > 5% per day, skipped_rate > 30% (likely a window/timezone bug), or repeated same-reason skips across users.

## Rollout slice

1. Migration + preferences UI on `/settings/delivery`. Channel = email only. "Send test now" works.
2. `cron-deliver-brief.yml` scheduled at 06:00 UTC, walks open windows hourly. Idempotent via unique index.
3. Delivery log + bounce visibility surfaced on `/settings`.
4. RSS/Atom per-user token. Reuse `/digest/{rss,atom}` route.
5. Compact JSON digest format (internal). No external transport yet.
6. Slack/Discord webhook channel — only if a real user asks.

## Scope

### Add
- `delivery_preferences`, `delivery_log`, `delivery_snapshots` in D1.
- Worker routes under `/delivery/*`, including `/delivery/internal/run`.
- `/settings/delivery` + `/admin/delivery` pages.
- Scheduled GitHub Actions workflow.
- Cloudflare `send_email` integration with explicit failure reasons.

### Keep out
- Social posting automation.
- Generic notification spam.
- Multi-step marketing automation flows.
- Paid-tier gating.
- In-app push notifications.

## Dependencies

- Daily brief snapshot generation (`/brief/daily`) is already stable and degrades gracefully on empty D1.
- A user record (Clerk `userId`) that can persist preferences. Email comes from Clerk user object.
- Cloudflare Email Routing binding `SEND_EMAIL`, sender var `EMAIL_FROM`, and `API_BASE` configured on the worker.
- Existing `/digest/{rss,atom}` endpoints as the archival fallback.

## Acceptance criteria

- A user can enable email delivery and receive the same daily brief at their chosen window without manual refresh.
- Delivery failures are visible on `/settings/delivery` and retryable from the UI.
- The brief email format matches the section ordering and evidence discipline of the web surface.
- Channel choice is reversible; toggling off and back on preserves prior `delivery_log` history.
- Each delivery row has a status and (if not sent) an explicit reason.
- Re-running the cron in the same window is a no-op (no duplicate sends).
- Three consecutive failures auto-disable the channel and notify the user.

## Non-goals

- Designing a separate marketing email system.
- A/B testing subject lines.
- Open/click tracking (deferred until a user asks).
- Multi-brief-per-day delivery — one brief per day per user, max.

## Risks

- Messaging drifts into a second product. Mitigation: refuse any feature that does not directly transport the brief.
- Email deliverability needs an owner. Mitigation: SPF/DKIM and a dedicated subdomain at setup; one human on bounce alerts.
- Timezone math is the usual minefield. Mitigation: store timezone as IANA name, resolve local windows in the worker with a known library, never `Date.now()`-style math in the cron script.
- Provider lock-in. Mitigation: keep the provider call behind a single `sendEmail()` helper in the worker.

## Open questions

- Does anonymous-user RSS make sense at all, or is RSS only for signed-in users with tokens?
- Do we need a "weekly summary" mode for users who do not want daily? Not in v1.
- When a user connects a brand mid-week, do we backfill the personal sections retroactively or only forward?
