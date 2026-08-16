/**
 * /api/watchlists/<...> — Clerk-only proxy to the worker's /watchlists/* routes.
 * Same pattern as /api/delivery — any signed-in user, no allow-list.
 */

import { proxyToWorker, runtime, dynamic } from '@/lib/worker-proxy';

export { runtime, dynamic };

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToWorker(req, ctx, 'watchlists');
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
