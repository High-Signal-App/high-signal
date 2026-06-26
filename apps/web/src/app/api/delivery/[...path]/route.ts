/**
 * /api/delivery/<...> — Clerk-only proxy to the worker's /delivery/* routes.
 *
 * Unlike /api/admin, this is open to any signed-in user (not allow-list).
 * We inject the Clerk user id + email as headers so the worker can attribute
 * preference writes and log rows without trusting the browser.
 */

import { createClerkClient } from '@clerk/nextjs/server';
import { getRequestAuth } from '@/lib/require-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = await getRequestAuth(req);
  const userId = auth && 'userId' in auth ? auth.userId : null;
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const clerk = createClerkClient({
    publishableKey: process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],
    secretKey: process.env['CLERK_SECRET_KEY'],
  });
  const user = await clerk.users.getUser(userId);
  const email = user?.primaryEmailAddress?.emailAddress ?? '';

  const { path } = await ctx.params;
  const u = new URL(req.url);
  const targetPath = `/delivery/${path.join('/')}${u.search}`;

  const mod = await import('@opennextjs/cloudflare');
  const cfctx = (
    mod as unknown as {
      getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
    }
  ).getCloudflareContext?.();
  const api = cfctx?.env?.['API'] as { fetch?: typeof fetch } | undefined;
  if (!api?.fetch) return Response.json({ error: 'proxy_misconfigured' }, { status: 500 });

  const headers = new Headers();
  if (req.headers.get('content-type')) {
    headers.set('Content-Type', req.headers.get('content-type')!);
  }
  headers.set('X-Clerk-User-Id', userId);
  if (email) headers.set('X-Admin-Email', email);

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const r = await api.fetch(`https://api${targetPath}`, {
    method: req.method,
    headers,
    body,
  });
  return new Response(r.body, {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
