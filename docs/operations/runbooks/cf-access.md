# Cloudflare Access setup — `/review` + `/api/admin/*`

> **SUPERSEDED (2026-05-01).** Cloudflare Access was abandoned in favor of Clerk
> (ADR-007 in [`../../architecture/decisions.md`](../../architecture/decisions.md)).
> Do not reintroduce CF Access without a migration plan. This page is kept for
> history only — it is **not** the active auth path.

One-time, ~5 min, manual via CF dashboard.

## 1. Create the Application
1. CF Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
2. Choose **Self-hosted**
3. **Application name**: `high-signal-review`
4. **Session duration**: 24h (or your preference)
5. **Application domain**: `high-signal-web.sarthakagrawal927.workers.dev`
6. **Path**: leave host blank, set path to `/review`
7. **Add path rule** for `/api/admin/*`

## 2. Pick an Identity Provider
- Google is the simplest. CF dashboard has a one-click Google OAuth setup if not already configured.
- Email OTP works as a fallback (CF generates magic links).

## 3. Add the Policy
- **Policy name**: `admin-only`
- **Action**: `Allow`
- **Configure rules** → **Include**:
  - **Selector**: `Emails`
  - **Value**: `sarthakagrawal927@gmail.com`

## 4. Wire the worker env
After save, on the Application's Overview tab grab:
- **AUD tag** (long hex string)
- **Team domain** (`<team>.cloudflareaccess.com`)

Then in `apps/web/wrangler.toml`, uncomment + fill:
```toml
CF_ACCESS_AUD = "<paste AUD>"
CF_ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
ADMIN_ALLOWED_EMAILS = "sarthakagrawal927@gmail.com"
```

Redeploy:
```bash
cd apps/web
pnpm cf:build && wrangler deploy
```

## 5. Verify
1. Open `https://high-signal-web.sarthakagrawal927.workers.dev/review` in a private window — CF Access should redirect to your IdP.
2. Sign in with the allowed email.
3. Land on `/review`. Click **publish** on any draft. Action should succeed.
4. From a non-allowed email or no auth, the page should be blocked at the edge before the worker even sees the request.

## What's protected
- `/review` — page (CF Access redirects to OAuth before render)
- `/api/admin/*` — proxy that forwards to the API worker with the internal `ADMIN_TOKEN` (browser never sees it)

## What's NOT protected (intentionally)
- `/signals`, `/entities/*`, `/track-record`, `/digest` — public reads
- `/api/og` — OG image renderer

## Machine-to-machine (Modal scorer, ingest)
Currently still uses raw bearer `ADMIN_TOKEN` against `https://high-signal-api.sarthakagrawal927.workers.dev/admin/*`. CF Access doesn't apply to the API worker directly.

Plan: split into `/admin/m2m/*` with separate `MACHINE_TOKEN` (see `plans/0002-auth-hardening.md`, Path B step 1).

## Revocation
- Remove the email from the Application's policy → all live sessions invalidate within 24h (or session duration).
- Hard kill: rotate `ADMIN_TOKEN` worker secret + update Modal secret.
