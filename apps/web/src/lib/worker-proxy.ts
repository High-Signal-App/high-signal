/**
 * Shared same-origin proxy to the API worker.
 *
 * Both /api/delivery and /api/watchlists use this pattern: authenticate via
 * Clerk, inject the user's Clerk id + email as headers, then forward to the
 * service-bound `API` worker. Keeping the forwarding logic in one place avoids
 * drift between the two route handlers.
 */

import { createClerkClient } from '@clerk/nextjs/server';
import { getRequestAuth } from '@/lib/require-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getCloudflareApi() {
  const mod = await import('@opennextjs/cloudflare');
  const cfctx = (
    mod as unknown as {
      getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
    }
  ).getCloudflareContext?.();
  return cfctx?.env?.['API'] as { fetch?: typeof fetch } | undefined;
}

export async function proxyToWorker(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
  prefix: string
): Promise<Response> {
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
  const targetPath = `/${prefix}/${path.join('/')}${u.search}`;

  const api = await getCloudflareApi();
  if (!api?.fetch) return Response.json({ error: 'proxy_misconfigured' }, { status: 500 });

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
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
