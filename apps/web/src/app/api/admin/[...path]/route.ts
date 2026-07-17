/**
 * /api/admin/<...> — same-origin proxy to the api worker's /admin/* routes.
 *
 * Auth: Clerk session plus a server-side allow-list.
 *
 * The proxy injects the worker-internal ADMIN_TOKEN before forwarding to the
 * service-bound `API`. This keeps the bearer token off the browser entirely.
 */

import { requireAdmin } from '@/lib/clerk-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return Response.json(admin.body, { status: admin.status });

  const { path } = await ctx.params;
  const u = new URL(req.url);
  const targetPath = `/admin/${path.join('/')}${u.search}`;

  const mod = await import('@opennextjs/cloudflare');
  const cfctx = (
    mod as unknown as {
      getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
    }
  ).getCloudflareContext?.();
  const api = cfctx?.env?.API as { fetch?: typeof fetch } | undefined;
  const token = (cfctx?.env?.ADMIN_TOKEN as string | undefined) ?? '';

  if (!api?.fetch || !token) {
    return Response.json({ error: 'proxy_misconfigured' }, { status: 500 });
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  if (req.headers.get('content-type')) {
    headers.set('Content-Type', req.headers.get('content-type')!);
  }
  // Trace who acted. Browser cannot spoof this because this route injects it after Clerk auth.
  headers.set('X-Admin-Email', admin.identity.email);
  headers.set('X-Clerk-User-Id', admin.identity.userId);

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
