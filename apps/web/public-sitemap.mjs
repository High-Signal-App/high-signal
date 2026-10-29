import { isProtectedHistoryDay } from '../../packages/shared/src/core/history-access.ts';

const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;

export async function qualifyPublicSitemap(request, response, now = new Date()) {
  if (
    new URL(request.url).pathname !== '/sitemap.xml' ||
    response.status !== 200 ||
    !(response.headers.get('content-type') ?? '').includes('xml')
  ) {
    return response;
  }

  const xml = await response.text();
  const publicXml = xml.replace(/<url>[\s\S]*?<\/url>/g, (entry) => {
    const date = entry.match(
      /<loc>https:\/\/highsignal\.app\/brief\/(\d{4}-\d{2}-\d{2})<\/loc>/
    )?.[1];
    return date && isProtectedHistoryDay(date, now) ? '' : entry;
  });
  const dayTtl = Math.max(
    0,
    Math.floor((DAY_MS - ((now.getTime() + IST_OFFSET_MS) % DAY_MS)) / 1000)
  );
  const headers = new Headers(response.headers);
  for (const header of ['content-length', 'content-encoding', 'etag']) headers.delete(header);
  headers.set(
    'Cache-Control',
    `public, max-age=${Math.min(300, dayTtl)}, s-maxage=${Math.min(3600, dayTtl)}`
  );
  return new Response(request.method === 'HEAD' ? null : publicXml, {
    status: response.status,
    headers,
  });
}
