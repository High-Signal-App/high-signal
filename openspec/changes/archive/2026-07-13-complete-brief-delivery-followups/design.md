## Context

Plan 0009 already supplies delivery preference/log tables, an email cron, retry attempt capping, one-click unsubscribe, and a signed-in settings page. The cron calls the retry schedule helper only to detect the terminal attempt; without a persisted eligibility time it retries a failed row on the next 30-minute tick instead of enforcing the documented delay. The schema intentionally includes `rss` and `digest_json` channels plus `rss_token`, but only the email channel is functional. The existing `/digest/rss` and web `/digest.json` surfaces publish weekly signal rows and do not represent a user's daily brief. Manual retry is named in the worker API plan but no route or UI action exists.

The change must be local-only: the additive D1 migration may be authored and tested but SHALL NOT be applied remotely. No DNS/provider work, secrets, production configuration, or deployment is in scope. It must reuse the existing Clerk proxy trust boundary and current `delivery_preferences` columns.

## Goals / Non-Goals

**Goals:**

- Let a signed-in user explicitly retry one of their own failed email log rows.
- Prevent concurrent retry clicks from sending the same row twice.
- Persist and enforce the next eligible automatic retry time across worker invocations.
- Create a stable opaque RSS token without rotating it during ordinary preference edits.
- Serve token-authenticated RSS and Atom representations of that user's current daily brief.
- Serve a compact versioned JSON representation of the signed-in user's current daily brief for future internal transports.
- Keep channel output derived from the same `/brief/daily` snapshot as email.

**Non-Goals:**

- Applying migrations locally or remotely, configuring Email Routing/DNS, adding secrets, deploying, or sending production mail.
- Adding Slack, Discord, SMS, marketing automation, or another delivery provider.
- Replacing the existing public weekly digest behavior for requests without a private token.
- Building external transport for the compact JSON format.

## Decisions

1. **Claim a retry row before sending.** `POST /delivery/retry/:logId` will select by both log id and authenticated user id, require `status=failed` and `channel=email`, then conditionally update that exact row from `failed` to `queued`. A second request loses the conditional update and returns a conflict. An explicit user retry may exceed the automatic three-retry cap (four total delivery attempts); that cap governs unattended cron retries, while the UI action is the documented manual recovery path.

2. **Reuse current preference and snapshot composition.** The retry uses the saved email preference for address, region, and connected brand, then composes through `/brief/daily` just like the cron. It updates the existing log row in place, incrementing `attempt`, so the unique `(user, channel, date)` invariant and history remain intact.

3. **Generate the RSS token only for the RSS channel.** An RSS preference upsert reads the current row first and preserves its token; when absent it creates a cryptographically random opaque token. The authenticated response returns the token so the settings UI can construct same-origin `/digest/rss?token=…` and `/digest/atom?token=…` URLs. Ordinary email preference writes never create or rotate feed credentials.

4. **Keep public and private digest modes side by side.** `/digest/rss` and `/digest/atom` retain the existing public weekly-signal response when no token is supplied. With a token, the worker requires an enabled RSS preference whose stored token matches, fetches that preference's daily brief, and emits private no-store feed output. The web feed handlers forward token-bearing requests to the worker while retaining their existing public renderer otherwise.

5. **Use one versioned compact contract.** A pure shared mapper emits `high-signal.compact-digest.v1` with ordered sections and concise items/evidence links. Email, private feeds, and `GET /delivery/digest` all derive from the same `BriefSnapshot`; the JSON route is Clerk-authenticated and does not create a delivery-log row because it is a representation, not a transport attempt.

6. **Persist the next automatic eligibility time.** Add nullable `delivery_log.next_attempt_at` through migration `0019_delivery_retry_schedule.sql` and the Drizzle schema. After a failed attempt, compute the next timestamp from the existing 15-minute/1-hour/4-hour schedule and write it with the row result. Cron retries require both a non-terminal attempt and `next_attempt_at <= now`; a future timestamp is a clean skip. `NULL` on a pre-migration legacy failed row below the cap means immediately eligible, so rollout needs no data rewrite. Manual owner action deliberately bypasses elapsed backoff but still rewrites the schedule if that explicit attempt fails.

## Risks / Trade-offs

- **[Current-snapshot retry differs from the original failed payload]** → Keep the original `briefDate` and log id but document that retry composes from current canonical data until `delivery_snapshots` is populated by the delivery pipeline.
- **[Feed token is a bearer credential]** → Generate high-entropy opaque values, query by token without exposing user ids, mark private responses `no-store`, and never put tokens in logs.
- **[Self-fetch depends on `API_BASE`]** → Fail closed with an explicit 503/failed reason when the existing brief-composition base is unavailable; do not synthesize a different product payload.
- **[Conditional update support varies in mocks]** → Verify against TypeScript's D1/Drizzle result type and cover eligibility/contract logic with pure tests; worker integration remains guarded by the conditional `WHERE` clause.
- **[Code can deploy before migration 0019 is applied]** → Treat migration 0019 as a release gate for this branch and do not deploy the worker first; no compatibility fallback can safely reference an absent D1 column.
