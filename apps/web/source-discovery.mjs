import { SITE_IDENTITY, SITE_URL } from './src/lib/site.ts';
import { createAgentSurfaceManifest } from './agent-surfaces/manifest.mjs';
import { buildMarkdownIndex, buildFullMarkdown, buildAiTxt } from './agent-surfaces/documents.mjs';
import { discoveryLinkHeader } from './agent-surfaces/handler.mjs';
import { publicDocsRoutes } from './public-docs-edge.mjs';
const paths = new Set(['/llms.txt', '/llms-full.txt', '/ai.txt', '/api/md/_catalog']);
const text = (request, body, type = 'text/plain; charset=utf-8', status = 200) =>
  new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex, follow',
      'Cache-Control': status === 200 ? 'public, max-age=0, s-maxage=300' : 'no-store',
      Link: discoveryLinkHeader(SITE_URL),
    },
  });
const dayKey = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
const dayTtl = () =>
  Math.max(1, Math.floor((86_400_000 - ((Date.now() + 19_800_000) % 86_400_000)) / 1000));
function ordered(routes) {
  const priority = (path) =>
    path === '/'
      ? 0
      : [
            '/signals',
            '/track-record',
            '/data',
            '/case-studies',
            '/articles',
            '/markets',
            '/entities',
            '/sectors',
            '/about',
            '/methodology',
            '/editorial-policy',
            '/privacy',
            '/terms',
            '/api-docs',
          ].includes(path)
        ? 1
        : path.startsWith('/docs')
          ? 2
          : path === '/equities'
            ? 9
            : 3;
  return [...routes].sort((a, b) => priority(a.path) - priority(b.path));
}
export function isSourceDiscovery(request) {
  return (
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method) && paths.has(new URL(request.url).pathname)
  );
}
export async function handleSourceDiscovery(
  request,
  renderSource,
  { assets, cache, waitUntil, buildId = 'unversioned' } = {}
) {
  if (!isSourceDiscovery(request)) return null;
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept',
      },
    });
  const url = new URL(request.url);
  const cacheUrl = new URL(url.pathname, SITE_URL);
  cacheUrl.searchParams.set('build', buildId);
  cacheUrl.searchParams.set('day', dayKey());
  const cursor = url.pathname === '/api/md/_catalog' ? url.searchParams.get('cursor') : null;
  if (cursor) cacheUrl.searchParams.set('cursor', cursor);
  const key = new Request(cacheUrl);
  const previous = await cache?.match(key);
  if (previous)
    return new Response(request.method === 'HEAD' ? null : previous.body, {
      status: previous.status,
      headers: previous.headers,
    });
  try {
    const sourceUrl = new URL('/api/public-markdown-catalog', request.url);
    if (cursor) sourceUrl.searchParams.set('cursor', cursor);
    const source = await renderSource(
      new Request(sourceUrl, { headers: { Accept: 'application/json' } })
    );
    if (!source.ok) throw new Error('Public catalog unavailable');
    const catalog = await source.json();
    if (!Array.isArray(catalog.routes)) throw new Error('Invalid public catalog');
    const docs = cursor ? [] : await publicDocsRoutes(assets);
    const routes = ordered([...catalog.routes, ...docs]);
    const renderRequest = new Request(request, { method: 'GET' });
    let response;
    if (url.pathname === '/api/md/_catalog')
      response = text(
        renderRequest,
        JSON.stringify({ ...catalog, routes }),
        'application/json; charset=utf-8'
      );
    else {
      const manifest = createAgentSurfaceManifest({
        ...SITE_IDENTITY,
        pages: {},
        notes: [
          ...SITE_IDENTITY.notes,
          'The Markdown catalog is paginated; follow its next URL through all public source families. Full content is bounded to 50 pages and 500000 characters. Discovery document counts describe this initial catalog page and documentation; follow catalog pagination for the remaining public addresses.',
          'Public read-only MCP server: https://api.highsignal.app/mcp; existing server card: https://api.highsignal.app/mcp/server-card.',
        ],
      });
      if (url.pathname === '/llms.txt')
        response = text(
          renderRequest,
          buildMarkdownIndex(manifest, routes).replace(
            `Showing 50 of ${routes.length} pages`,
            `Showing 50 of ${routes.length} pages in the initial catalog page and documentation`
          )
        );
      else if (url.pathname === '/ai.txt')
        response = text(
          renderRequest,
          buildAiTxt(manifest, routes).replace(
            'public-route-count:',
            'initial-catalog-page-route-count:'
          )
        );
      else {
        const body = await buildFullMarkdown(manifest, routes, async (path) => {
          const doc = docs.find((route) => route.path === path);
          if (doc) {
            const asset = await assets.fetch(new Request(new URL(doc.assetPath, SITE_URL)));
            if (!asset.ok || !(asset.headers.get('content-type') ?? '').includes('text/markdown'))
              throw new Error('Public docs source unavailable');
            return asset.text();
          }
          const rendered = await renderSource(
            new Request(new URL('/api/public-markdown' + (path === '/' ? '' : path), request.url), {
              headers: { Accept: 'application/json' },
            })
          );
          if (rendered.status === 404) return null;
          if (!rendered.ok) throw new Error('Public source unavailable');
          const value = await rendered.json();
          if (typeof value.markdown !== 'string') throw new Error('Invalid public Markdown source');
          return value.markdown;
        });
        response = text(
          renderRequest,
          body.replace(
            'registered public pages (limit',
            'pages in the initial catalog page and documentation (limit'
          )
        );
        response.headers.set(
          'Cache-Control',
          `public, max-age=0, s-maxage=${Math.min(300, dayTtl())}, stale-while-revalidate=0`
        );
      }
    }
    if (url.pathname !== '/llms-full.txt')
      response.headers.set(
        'Cache-Control',
        `public, max-age=0, s-maxage=${Math.min(300, dayTtl())}, stale-while-revalidate=0`
      );
    if (cache?.put) {
      const write = cache.put(key, response.clone()).catch(() => undefined);
      if (waitUntil) waitUntil(write);
      else await write;
    }
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  } catch {
    return text(
      request,
      url.pathname === '/api/md/_catalog'
        ? JSON.stringify({ error: 'catalog_unavailable' })
        : 'Public sources are temporarily unavailable.\n',
      url.pathname === '/api/md/_catalog'
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8',
      503
    );
  }
}
