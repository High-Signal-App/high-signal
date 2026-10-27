import { listMarkdownRoutes } from '@/lib/public-source-catalog';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (
    ['cookie', 'authorization', 'cf-access-jwt-assertion'].some((name) => request.headers.has(name))
  )
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  const cursor = new URL(request.url).searchParams.get('cursor');
  if (cursor && cursor.length > 8192)
    return Response.json({ error: 'invalid_cursor' }, { status: 400, headers });
  try {
    return Response.json(await listMarkdownRoutes(cursor), { headers });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('Public catalog unavailable', error);
    return Response.json({ error: 'catalog_unavailable' }, { status: 503, headers });
  }
}
