/**
 * /api/delivery/<...> — Clerk-only proxy to the worker's /delivery/* routes.
 *
 * Unlike /api/admin, this is open to any signed-in user (not allow-list).
 * We inject the Clerk user id + email as headers so the worker can attribute
 * preference writes and log rows without trusting the browser.
 */

import { proxyToWorker, runtime, dynamic } from '@/lib/worker-proxy';

export { runtime, dynamic };

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToWorker(req, ctx, 'delivery');
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
