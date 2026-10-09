import { createWorkerHealthBuffer } from '@high-signal/shared/worker-health-buffer.mjs';
import { createAppHealthClient, type AppHealthClient } from '@saas-maker/app-health';
import { createTrafficSummary } from '@high-signal/shared';
import { takeObservedStages } from './lib/server-timing';

const DEFAULT_ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';
const summarizeTraffic = createTrafficSummary();

export type AppHealthEnv = {
  APP_HEALTH_INGEST_KEY?: string;
  APP_HEALTH_INGEST_URL?: string;
  APP_HEALTH_ENVIRONMENT?: string;
  APP_HEALTH_RELEASE?: string;
  /** Fraction (0..1) of measured cache misses that log stage timings. Default 1. */
  APP_HEALTH_STAGE_SAMPLE_RATE?: string;
  ENVIRONMENT?: string;
};

/** Routes whose cache misses report fixed-name stage timings (issue #198). */
const STAGE_TIMED_ROUTES = new Set(['/brief/daily', '/data/sources', '/data/sources/:id']);
const STAGE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

function stageSampleRate(env: AppHealthEnv): number {
  const raw = env?.APP_HEALTH_STAGE_SAMPLE_RATE?.trim();
  if (!raw) return 1;
  const rate = Number(raw);
  return Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 1;
}

/**
 * Props for one `api.stage_timing` log: route template, per-stage elapsed ms,
 * cache outcomes, colo, and status only. Query values, ids, and response
 * content are never included. Returns null when this request is not a
 * measured, Worker-executed, ordinary cache miss.
 */
export function stageTimingProps(
  request: Request,
  response: Response | null,
  route: string | null,
  totalMs: number,
  sampleRate = 1,
  random: () => number = Math.random
): Record<string, string | number> | null {
  const observed = takeObservedStages(request);
  if (!route || !STAGE_TIMED_ROUTES.has(route) || request.method !== 'GET') return null;
  if (new URL(request.url).searchParams.get('timing') === '1') return null;
  const edge = response?.headers.get('x-edge-cache') ?? 'NONE';
  if (edge === 'API-HIT' || !observed) return null;
  if (sampleRate < 1 && random() >= sampleRate) return null;
  const props: Record<string, string | number> = {
    route: `/api${route}`,
    edge_cache: edge.replace(/^API-/, ''),
    inner_cache: observed.innerCache ?? 'NONE',
    colo: String((request as Request & { cf?: { colo?: unknown } }).cf?.colo ?? 'unknown').slice(
      0,
      8
    ),
    status: response?.status ?? 500,
    total_ms: Math.max(0, Math.round(totalMs)),
  };
  for (const { name, durationMs } of observed.entries.slice(0, 20)) {
    if (!STAGE_NAME.test(name)) continue;
    const key = `${name.replace(/-/g, '_')}_ms`;
    props[key] = Math.round((Number(props[key]) || 0) + Math.max(0, durationMs));
  }
  return props;
}

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
  '/company-universe',
  '/company-universe/lookup',
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

const healthBuffer = createWorkerHealthBuffer(createAppHealthClient);

function clientFor(env: AppHealthEnv): Pick<AppHealthClient, 'record' | 'log' | 'flush'> | null {
  const key = env?.APP_HEALTH_INGEST_KEY?.trim();
  if (!key) return null;
  try {
    return healthBuffer.client(env, {
      key,
      endpoint: env.APP_HEALTH_INGEST_URL ?? DEFAULT_ENDPOINT,
      environment: env.APP_HEALTH_ENVIRONMENT ?? env.ENVIRONMENT ?? 'production',
      release: env.APP_HEALTH_RELEASE,
      runtime: 'worker',
      // Cross-request buffer owns values; each drain creates its own SDK client.
      maxQueueSize: 100,
      maxBatchSize: 100,
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
  const durationMs = Math.max(0, Math.round(Date.now() - startedAt));
  if (!route && !summary) return;
  const client = clientFor(env);
  if (!client) return;
  const stages = stageTimingProps(request, response, route, durationMs, stageSampleRate(env));
  if (route) {
    client.record({
      method: request.method,
      route: `/api${route}`,
      status_code: response?.status ?? 500,
      duration_ms: durationMs,
    });
  }
  if (summary) {
    client.log('traffic.summary', { level: 'info', props: { ...summary, surface: 'api' } });
  }
  if (stages) {
    // `debug` keeps these in the Logs store and out of the default Slack route.
    client.log('api.stage_timing', { level: 'debug', props: stages });
  }
  try {
    ctx.waitUntil(client.flush().catch(() => undefined));
  } catch {
    // Local tests and non-Worker callers may not have an execution context.
    void client.flush().catch(() => undefined);
  }
}
