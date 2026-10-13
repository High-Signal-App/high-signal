import { createAppHealthClient } from '@saas-maker/app-health';
import { createTrafficSummary } from '@high-signal/shared';
import { createWorkerHealthBuffer } from '@high-signal/shared/worker-health-buffer.mjs';
import { publicRouteDescriptor } from './public-route-registry.mjs';
import { cacheSummaryProps } from './cache-summary.mjs';

const ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';
const summarizeTraffic = createTrafficSummary();
const buffer = createWorkerHealthBuffer(createAppHealthClient);
export function normalizeWebRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const descriptor = publicRouteDescriptor(path);
  if (descriptor) {
    return descriptor.type === 'static'
      ? `/web${path}`
      : `/web${descriptor.route.html.replace(/\{[^}]+\}/g, ':param')}`;
  }
  if (['/health', '/api/ai', '/llms.txt', '/sitemap.xml'].includes(path)) return `/web${path}`;
  if (path === '/api/history/access') return '/web/api/history/access';
  if (path === '/api/company-universe/lookup') return '/web/api/company-universe/lookup';
  if (/^\/api\/admin\/[^/]+$/.test(path)) return '/web/api/admin/:route';
  return null;
}

export function observeWebRequest(request, response, startedAt, env, ctx, cacheSummary = null) {
  const summary = summarizeTraffic(request);
  const cache = cacheSummaryProps(cacheSummary);
  // Rejected bursts still enter the bounded traffic summary. Do not turn
  // every cheap rejection into another Worker invocation and D1 write.
  const route = response?.headers.has('x-high-signal-guard')
    ? null
    : normalizeWebRoute(new URL(request.url).pathname);
  const key =
    typeof env?.APP_HEALTH_INGEST_KEY === 'string' ? env.APP_HEALTH_INGEST_KEY.trim() : '';
  if (!key || (!route && !summary && !cache)) return;
  try {
    const client = buffer.client(env, {
      key,
      endpoint: env.APP_HEALTH_INGEST_URL || ENDPOINT,
      environment: env.APP_HEALTH_ENVIRONMENT || 'production',
      release: env.APP_HEALTH_RELEASE,
      runtime: 'worker',
      maxQueueSize: 100,
      maxBatchSize: 100,
      maxRetries: 0,
      requestTimeoutMs: 1000,
      disableTimer: true,
    });
    if (route)
      client.record({
        method: request.method,
        route,
        status_code: response?.status || 500,
        duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
      });
    if (summary)
      client.log('traffic.summary', { level: 'info', props: { ...summary, surface: 'web' } });
    if (cache) client.log('web.cache.summary', { level: 'debug', props: cache });
    ctx.waitUntil(client.flush().catch(() => undefined));
  } catch {
    // Health delivery is fail-open and must never affect the product response.
  }
}
