# TODO: Move Clerk to a production instance

**Status: pending — not urgent.** The site works fine on the Clerk dev key for now.

## Context

`highsignal.app` is live on the `high-signal-web` Worker. Auth currently uses a Clerk
**development** instance (`pk_test_…` in `apps/web/wrangler.toml`). Dev instances work on
any domain but show a dev banner, have lower limits, and use Clerk's shared OAuth — not
ideal for a real public domain.

## Steps — Clerk dashboard + Cloudflare DNS (needs your login)

1. Clerk dashboard → this app → create/activate the **Production** instance; set domain `highsignal.app`.
2. Add the ~5 CNAME records Clerk provides (`clerk`, `accounts`, `clkmail`,
   `clk._domainkey`, `clk2._domainkey`) to Cloudflare DNS for `highsignal.app`
   as **DNS-only (grey cloud, NOT proxied)**.
3. If social login is used (Google/GitHub), create your own production OAuth apps and
   paste the credentials into Clerk — the shared dev OAuth does not carry over.
4. Wait for Clerk to verify DNS, then copy the production keys: `pk_live_…` / `sk_live_…`.

## Code side — small, can be done once keys exist

- Replace `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `apps/web/wrangler.toml` with `pk_live_…`.
- Set the secret on the production Worker:
  `cd apps/web && pnpm wrangler secret put CLERK_SECRET_KEY`  (paste `sk_live_…`)
- Redeploy (push to `main`).

## Already done (related)

- `highsignal.app` apex + `www` codified in `apps/web/wrangler.toml` `routes`.
- `www` → apex 308 redirect in `apps/web/next.config.ts`.
