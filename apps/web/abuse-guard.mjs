const BLOCKED_CLIENT_IPS = new Set([
  // Sustained scanner: ~166k random historical/page requests per day since 2026-07-03.
  '93.123.109.102',
]);

export function guardPublicRequest(request) {
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp && BLOCKED_CLIENT_IPS.has(clientIp)) {
    return new Response('Forbidden', {
      status: 403,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const url = new URL(request.url);
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url, 308);
  }

  return null;
}
