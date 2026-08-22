/**
 * /api/admin/<...> — same-origin proxy to the api worker's /admin/* routes.
 *
 * Auth: a cryptographically verified Cloudflare Access JWT.
 * Forwarding + ADMIN_TOKEN injection live in lib/admin-worker.ts, so the token
 * stays on the server and never reaches the browser.
 */

import { hasAdminSession } from '@/lib/admin-guard';
import { forwardToAdminWorker } from '@/lib/admin-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await hasAdminSession(req))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();

  const result = await forwardToAdminWorker(`${path.join('/')}${search}`, {
    method: req.method,
    contentType: req.headers.get('content-type'),
    body,
  });

  if (result.status === 500 && result.body === null) {
    return Response.json({ error: 'proxy_misconfigured' }, { status: 500 });
  }

  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': result.contentType },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
