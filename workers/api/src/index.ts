import { WorkerEntrypoint } from 'cloudflare:workers';
import { app, type Env } from './app';
import { handleHighSignalMcpCardRequest, handleHighSignalMcpRequest } from './mcp';
import { handlePublicApiCache, isPublicCacheRequest } from './public-cache';
import { precomputeBriefSnapshots } from './routes/brief';

async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/mcp/server-card') {
    return handleHighSignalMcpCardRequest(request);
  }
  if (pathname === '/mcp') {
    return handleHighSignalMcpRequest(request, env, ctx);
  }
  const cache =
    typeof caches === 'undefined' ? null : (caches as CacheStorage & { default: Cache }).default;
  return handlePublicApiCache(request, async () => app.fetch(request, env, ctx), {
    cache,
    waitUntil: (promise) => ctx.waitUntil(promise),
  });
}

export class PublicApi extends WorkerEntrypoint<Env> {
  override async fetch(request: Request) {
    return handleApiRequest(request, this.env, this.ctx);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (isPublicCacheRequest(request) && ctx?.exports?.PublicApi) {
      return ctx.exports.PublicApi.fetch(request);
    }
    return handleApiRequest(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Brief precompute is the API Worker's only scheduled responsibility.
    // This populates daily_brief_snapshots so /brief/daily does 1 D1 lookup
    // instead of 5-14 sequential queries.
    ctx.waitUntil(
      precomputeBriefSnapshots(env)
        .then((result) => {
          if (!result.globalPublished) {
            console.error('[cron] global brief precompute did not publish', result);
          }
        })
        .catch((err) => console.error('[cron] brief precompute failed:', err))
    );
  },
};
