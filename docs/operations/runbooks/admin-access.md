---
title: Operator admin access
description: How the single-operator gate works, how to configure it, and how to rotate the secrets behind it.
---

# Operator admin access

High Signal has no user accounts. Every readable surface is public. One
operator session controls the only thing that must not be public: publishing,
killing, and correcting signals. Rationale and what was removed:
[ADR-013](../../architecture/decisions.md).

## How the gate works

```
/admin/login  ──password──▶  HMAC-signed httpOnly cookie (hs_admin, 12h)
                                     │
              /api/admin/*  ─verify cookie─▶  inject ADMIN_TOKEN  ─▶  worker /admin/*
```

The worker is the real enforcement point: every `/admin/*` route requires the
`ADMIN_TOKEN` bearer (`workers/api/src/routes/admin.ts`). The web layer never
sends that token to the browser — `apps/web/src/lib/admin-worker.ts` is the only
place it is read, and it runs server-side.

| Piece | File |
| --- | --- |
| Cookie mint / verify / password check | `apps/web/src/lib/admin-session.ts` |
| Request-bound gate (`requireAdminSession`, `hasAdminSession`) | `apps/web/src/lib/admin-guard.ts` |
| Worker forwarder (injects `ADMIN_TOKEN`) | `apps/web/src/lib/admin-worker.ts` |
| Browser-facing proxy | `apps/web/src/app/api/admin/[...path]/route.ts` |
| Unit tests | `scripts/admin-session.test.ts` |

## Required secrets

Set as Cloudflare **secrets** on `high-signal-web` (never `[vars]`, never
committed):

| Secret | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | What you type at `/admin/login`. |
| `ADMIN_SESSION_SECRET` | HMAC key for the session cookie. Any long random string. |
| `ADMIN_TOKEN` | Bearer the proxy injects. Must match the value on `high-signal-api`. |

```bash
wrangler secret put ADMIN_PASSWORD --name high-signal-web
wrangler secret put ADMIN_SESSION_SECRET --name high-signal-web
```

**Fails closed.** With `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET` unset, no
session can be minted and `/admin/login` says so plainly. With `ADMIN_TOKEN`
unset on the worker, `/admin/*` returns `503 admin_disabled`.

## Gated surfaces

`/review`, `/review/lab-candidates`, `/backtest-workbench`, `/personal`, and
the tracked-community controls on `/communities`. `/track-record` is public —
only its raw combined debugging table is operator-only. Everything else on the
site is anonymous.

## Rotating

Rotating `ADMIN_SESSION_SECRET` invalidates the active session immediately;
sign in again. Rotating `ADMIN_TOKEN` requires setting the same value on both
Workers — set the API side first, or admin writes fail until both match.

## Signing out

`POST /admin/logout` clears the cookie. It is POST-only so a stray link cannot
sign you out. Sessions expire on their own after 12 hours.
