import { createAppHealthClient, type AppHealthClient } from '@saas-maker/app-health';
import { createTrafficSummary } from '@high-signal/shared';

const DEFAULT_ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';
const summarizeTraffic = createTrafficSummary();

export type AppHealthEnv = {
  APP_HEALTH_INGEST_KEY?: string;
  APP_HEALTH_INGEST_URL?: string;
  APP_HEALTH_ENVIRONMENT?: string;
  APP_HEALTH_RELEASE?: string;
  ENVIRONMENT?: string;
};

const EXACT = new Set([
  '/',
  '/health',
  '/mcp',
  '/mcp/server-card',
  '/signals',
  '/signals/facets',
  '/entities',
  '/track-record',
  '/track-record/cohorts',
  '/track-record/series',
  '/track-record/source-accuracy',
  '/track-record/workbench',
  '/track-record/labels',
  '/communities/reddit-mentions',
  '/communities/discover',
  '/sectors',
  '/markets',
  '/brief/daily',
  '/brief/dates',
  '/convergence',
  '/unmapped',
  '/enrich/ticker',
  '/attention',
  '/claims',
  '/data/daily',
  '/data/sources',
  '/d2c/opportunities',
  '/d2c/agent-visibility',
  '/company-universe',
  '/company-universe/lookup',
  '/learning/daily',
  '/history/access',
]);
const TEMPLATES: Array<[RegExp, string]> = [
  [/^\/signals\/by-entity\/[^/]+$/, '/signals/by-entity/:entityId'],
  [/^\/signals\/[^/]+\/evidence$/, '/signals/:slug/evidence'],
  [/^\/signals\/[^/]+$/, '/signals/:slug'],
  [/^\/entities\/[^/]+$/, '/entities/:id'],
  [/^\/communities\/reddit\/[^/]+$/, '/communities/reddit/:subreddit'],
  [
    /^\/products\/communities\/[^/]+\/[^/]+\/digests$/,
    '/products/communities/:subreddit/:period/digests',
  ],
  [/^\/claims\/by-signal\/[^/]+$/, '/claims/by-signal/:slug'],
  [/^\/claims\/[^/]+$/, '/claims/:id'],
  [/^\/data\/sources\/[^/]+$/, '/data/sources/:id'],
  [/^\/d2c\/opportunities\/[^/]+$/, '/d2c/opportunities/:slug'],
  [/^\/attention\/[^/]+$/, '/attention/:article'],
  [/^\/company-universe\/[^/]+$/, '/company-universe/:slug'],
  [/^\/admin\/signals\/[^/]+$/, '/admin/signals/:slug'],
  [/^\/admin\/claims\/[^/]+\/evidence$/, '/admin/claims/:id/evidence'],
  [/^\/admin\/claims\/[^/]+\/evidence\/[^/]+$/, '/admin/claims/:id/evidence/:linkId'],
  [/^\/admin\/claims\/[^/]+\/status$/, '/admin/claims/:id/status'],
  [/^\/admin\/claims\/[^/]+\/corrections$/, '/admin/claims/:id/corrections'],
  [/^\/admin\/communities\/tracked\/[^/]+(?:\/digests)?$/, '/admin/communities/tracked/:id'],
  [/^\/admin\/communities\/tracked$/, '/admin/communities/tracked'],
];

/** Return the allowlisted API template, without retaining dynamic values. */
export function normalizeApiRoute(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (EXACT.has(path)) return path;
  return TEMPLATES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

function clientFor(env: AppHealthEnv): AppHealthClient | null {
  const key = env?.APP_HEALTH_INGEST_KEY?.trim();
  if (!key) return null;
  try {
    return createAppHealthClient({
      key,
      endpoint: env.APP_HEALTH_INGEST_URL ?? DEFAULT_ENDPOINT,
      environment: env.APP_HEALTH_ENVIRONMENT ?? env.ENVIRONMENT ?? 'production',
      release: env.APP_HEALTH_RELEASE,
      runtime: 'worker',
      maxQueueSize: 2,
      maxBatchSize: 2,
      maxRetries: 0,
      requestTimeoutMs: 1_000,
      disableTimer: true,
    });
  } catch {
    return null;
  }
}

/** Record one completed gateway request and attach delivery to this request. */
export function observeApiRequest(
  request: Request,
  response: Response | null,
  startedAt: number,
  env: AppHealthEnv,
  ctx: ExecutionContext
): void {
  const summary = summarizeTraffic(request);
  const route = normalizeApiRoute(new URL(request.url).pathname);
  if (!route && !summary) return;
  const client = clientFor(env);
  if (!client) return;
  if (route) {
    client.record({
      method: request.method,
      route: `/api${route}`,
      status_code: response?.status ?? 500,
      duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
    });
  }
  if (summary) {
    client.log('traffic.summary', { level: 'info', props: { ...summary, surface: 'api' } });
  }
  try {
    ctx.waitUntil(client.flush().catch(() => undefined));
  } catch {
    // Local tests and non-Worker callers may not have an execution context.
    void client.flush().catch(() => undefined);
  }
}
