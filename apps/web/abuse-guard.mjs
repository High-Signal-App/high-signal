const BLOCKED_CLIENT_IPS = new Set([
  // Sustained scanner: ~166k random historical/page requests per day since 2026-07-03.
  '93.123.109.102',
]);

const REQUEST_LIMIT = 120;
const WINDOW_MS = 60_000;
const MAX_CLIENTS = 4096;

// Best-effort burst protection before OpenNext. Counters contain no request
// bodies or I/O handles and are bounded per isolate; this is not an account
// spend cap or a replacement for provider-side rate limiting.
export function createPublicRequestGuard(now = Date.now) {
  const clients = new Map();
  return function guard(request) {
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp && BLOCKED_CLIENT_IPS.has(clientIp)) {
      return new Response('Forbidden', {
        status: 403,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
          'x-high-signal-guard': 'blocked-client',
        },
      });
    }

    const url = new URL(request.url);

    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url, 308);
    }

    // Operator APIs, mutations and static files keep their own contracts.
    if (
      clientIp &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !url.pathname.startsWith('/api/') &&
      !url.pathname.startsWith('/_next/') &&
      !/\.(?:css|js|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname)
    ) {
      const time = now();
      let window = clients.get(clientIp);
      if (!window || time >= window.resetAt) {
        clients.delete(clientIp);
        if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value);
        window = { requests: 0, resetAt: time + WINDOW_MS };
        clients.set(clientIp, window);
      }
      window.requests += 1;
      if (window.requests > REQUEST_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((window.resetAt - time) / 1000));
        return new Response('Too many requests. Please retry shortly.', {
          status: 429,
          headers: {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8',
            'retry-after': String(retryAfter),
            'ratelimit-limit': String(REQUEST_LIMIT),
            'ratelimit-remaining': '0',
            'ratelimit-reset': String(retryAfter),
            'x-high-signal-guard': 'rate-limit',
          },
        });
      }
    }

    return null;
  };
}

export const guardPublicRequest = createPublicRequestGuard();
