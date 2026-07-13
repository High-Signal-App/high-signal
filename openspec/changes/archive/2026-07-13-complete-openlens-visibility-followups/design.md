## Context

Plan 0011 already defines the accepted OpenLens visibility contract and most of its worker and web scaffold is implemented. Three local follow-ups remain: the `/mentions` configuration form still presents a generic category and check counts as queries, cited URLs are refreshed only through an explicit endpoint, and the report endpoint requires an owner identifier even though the plan calls for safe token sharing.

The repository already uses deterministic HMAC tokens for one-click unsubscribe links, with `ADMIN_TOKEN` as an available server-only fallback secret. Reusing that pattern avoids a database migration, new dependency, or production configuration change.

## Goals / Non-Goals

**Goals:**

- Present topic/prompt language consistently on the existing Mentions configuration surface.
- Keep `cited_url_index` current whenever a mention check finishes.
- Preserve normal owner access to reports while enabling brand-scoped, unauthenticated report access with an unforgeable token.
- Fail closed for token creation and token access when the signing secret is unavailable.

**Non-Goals:**

- Applying or changing any database migration, including migration 0012.
- Changing PRD 0012, email, DNS, Wrangler configuration, secret values, or production.
- Persisting or revoking individual share tokens in v1.
- Adding PDF export or a new report UI.

## Decisions

1. **Use deterministic HMAC-SHA256 tokens scoped to `report:<brandId>`.** The shared helper mirrors the existing unsubscribe-token pattern, truncates the signature to 32 hexadecimal characters, and uses the worker's existing `ADMIN_TOKEN` binding as the signing secret. A dedicated persisted token was rejected because it requires a schema migration; using a brand ID as a token was rejected because it is forgeable.
2. **Authorize report reads through one of two explicit paths.** An owner identifier continues through the existing ownership lookup. Without an owner, the worker requires a valid token before loading the brand by ID. This prevents a token for one brand from reading another brand and avoids exposing brand existence before authorization.
3. **Expose token generation through an owner-gated POST route.** `POST /products/mentions/:brandId/report/share-token` returns a token only after the existing owner lookup succeeds. It returns a service-unavailable error when the signing secret is absent.
4. **Extract cited-source rebuilding into a shared route-local helper.** The existing manual refresh route and the post-check hook call the same function, preventing drift. Post-check cited-source and intent-opportunity refreshes run independently so one refresh failure does not suppress the other.
5. **Limit terminology changes to product copy.** Storage columns and internal analytics identifiers remain unchanged; `category` is presented as Topic and check counts are presented as prompts.

## Risks / Trade-offs

- **Tokens cannot be revoked individually because they are deterministic.** → Rotating the existing server secret invalidates all tokens; persisted revocable tokens remain a later migration if usage proves the need.
- **Reusing `ADMIN_TOKEN` couples report links to an operational secret rotation.** → This matches an existing repository pattern and avoids production config work; fail-closed behavior prevents accidental public access when unset.
- **A failed cited-source refresh could otherwise mask another post-check refresh.** → Run refreshes with `Promise.allSettled` and log failures separately.
- **Automatic refresh adds D1 work after every check.** → Reuse the bounded 30-day/5,000-row logic already exposed manually and keep it outside the request response path.
