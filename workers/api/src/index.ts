import { WorkerEntrypoint } from 'cloudflare:workers';
import { app, type Env } from './app';
import { db } from './db';
import { handleHighSignalMcpCardRequest, handleHighSignalMcpRequest } from './mcp';
import { handlePublicApiCache, isPublicCacheRequest } from './public-cache';
import { refreshEventsSourceRollup } from './lib/events-rollup';
import { dispatchDueWorkflows } from './lib/workflow-scheduler';
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
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Keep the public brief warm and use Cloudflare's reliable half-hour clock
    // as the control plane for GitHub-hosted ingestion. Dispatching remains
    // fail-closed until the repository-scoped token is explicitly provisioned.
    ctx.waitUntil(
      precomputeBriefSnapshots(env)
        .then((result) => {
          if (!result.globalPublished) {
            console.error('[cron] global brief precompute did not publish', result);
          }
        })
        .catch((err) => console.error('[cron] brief precompute failed:', err))
    );
    // Keeps `/data/sources` and `/data/sources/:id` off the whole-table
    // aggregate they used to recompute per cache miss. The rebuild is skipped
    // whenever it would produce the identical answer, so a quiet half hour
    // costs two bounded probes rather than a 440k-row scan.
    ctx.waitUntil(
      refreshEventsSourceRollup(env, db(env.DB), new Date(event.scheduledTime))
        .then((result) => {
          if (result.rebuilt) console.log('[cron] events rollup rebuilt', result);
        })
        .catch((err) => console.error('[cron] events rollup refresh failed:', err))
    );
    ctx.waitUntil(
      dispatchDueWorkflows(env, new Date(event.scheduledTime))
        .then((results) => {
          for (const result of results) {
            if (result.status === 'failed')
              console.error('[cron] workflow dispatch failed', result);
          }
        })
        .catch((err) => console.error('[cron] workflow scheduler failed:', err))
    );
  },
};
