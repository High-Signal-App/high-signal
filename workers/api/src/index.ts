import { app, type Env } from './app';
import { handleHighSignalMcpRequest } from './mcp';
import { handlePublicApiCache } from './public-cache';
import { precomputeBriefSnapshots } from './routes/brief';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/mcp') {
      return handleHighSignalMcpRequest(request, env, ctx);
    }
    const cache =
      typeof caches === 'undefined' ? null : (caches as CacheStorage & { default: Cache }).default;
    return handlePublicApiCache(request, async () => app.fetch(request, env, ctx), {
      cache,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Brief precompute is the API Worker's only scheduled responsibility.
    // This populates daily_brief_snapshots so /brief/daily does 1 D1 lookup
    // instead of 5-14 sequential queries.
    ctx.waitUntil(
      precomputeBriefSnapshots(env).catch((err) =>
        console.error('[cron] brief precompute failed:', err)
      )
    );
  },
};
