import { publicSourceDocument } from '@/lib/public-source-document';

export const dynamic = 'force-dynamic';
const privateHeaders = [
  'cookie',
  'authorization',
  'cf-access-jwt-assertion',
  'rsc',
  'next-router-state-tree',
];
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/** Read-only public projection. Edge callers supply a fresh credential-free request. */
export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  if (privateHeaders.some((name) => request.headers.has(name)) || new URL(request.url).search)
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  const { path: segments = [] } = await context.params;
  if (
    segments.some(
      (segment) => !segment || /[\\/?#]/.test(segment) || segment === '.' || segment === '..'
    )
  )
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  const path = '/' + segments.join('/');
  try {
    const document = await publicSourceDocument(path);
    return Response.json(document ?? { error: 'not_found' }, {
      status: document ? 200 : 404,
      headers,
    });
  } catch (error) {
    const digest =
      error && typeof error === 'object' && 'digest' in error ? String(error.digest) : '';
    if (digest === 'NEXT_HTTP_ERROR_FALLBACK;404')
      return Response.json({ error: 'not_found' }, { status: 404, headers });
    if (process.env.NODE_ENV === 'development')
      console.error('Public Markdown source unavailable', path, error);
    return Response.json({ error: 'source_unavailable' }, { status: 503, headers });
  }
}
