import { createAppHealthClient } from '@saas-maker/app-health';
import { createTrafficSummary } from '@high-signal/shared';
import { publicRouteDescriptor } from './public-route-registry.mjs';

const ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';
const summarizeTraffic = createTrafficSummary();
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

export function observeWebRequest(request, response, startedAt, env, ctx) {
  const summary = summarizeTraffic(request);
  const route = normalizeWebRoute(new URL(request.url).pathname);
  const key =
    typeof env?.APP_HEALTH_INGEST_KEY === 'string' ? env.APP_HEALTH_INGEST_KEY.trim() : '';
  if (!key || (!route && !summary)) return;
  try {
    const client = createAppHealthClient({
      key,
      endpoint: env.APP_HEALTH_INGEST_URL || ENDPOINT,
      environment: env.APP_HEALTH_ENVIRONMENT || 'production',
      release: env.APP_HEALTH_RELEASE,
      runtime: 'worker',
      maxQueueSize: 2,
      maxBatchSize: 2,
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
    ctx.waitUntil(client.flush().catch(() => undefined));
  } catch {
    // Health delivery is fail-open and must never affect the product response.
  }
}
