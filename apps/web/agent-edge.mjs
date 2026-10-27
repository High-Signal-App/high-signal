import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from './src/lib/site.ts';
import { createAgentSurfaceHandler, discoveryLinkHeader } from './agent-surfaces/handler.mjs';
import {
  wantsMarkdown as prefersMarkdown,
  markdownResponse,
  htmlPathFromMarkdown,
} from './agent-surfaces/http.mjs';
import {
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES,
  PUBLIC_STATIC_ROUTES,
  isPublicHtmlPath,
  normalizePublicPath,
} from './public-route-registry.mjs';

const PRODUCT = { name: SITE_NAME, url: SITE_URL, summary: SITE_DESCRIPTION };

const AGENT_CACHE_CONTROL = 'public, max-age=300, s-maxage=86400';

/**
 * Quota headers advertised on machine-readable API responses so agent
 * clients can pace themselves. These describe the public anonymous budget
 * (120 requests / 60s) and are informational; actual enforcement lives in the
 * abuse guard and origin API.
 */
export const RATE_LIMIT_HEADERS = {
  'RateLimit-Limit': '120',
  'RateLimit-Remaining': '119',
  'RateLimit-Reset': '60',
};

const BULK_AI_CRAWLER_USER_AGENTS = [
  'amazonbot',
  'bytespider',
  'ccbot',
  'claudebot',
  'facebookbot',
  'google-cloudvertexbot',
  'gptbot',
  // Observed bulk headless crawling: use the existing text representation
  // instead of booting Next.js and its speculative RSC navigation graph.
  'lightpanda/',
  'meta-externalagent',
];

function catalogForOrigin(origin) {
  const staticSurfaces = PUBLIC_STATIC_ROUTES.map((route) => ({
    id: route.path === '/' ? 'home' : route.path.slice(1).replaceAll('/', '-'),
    url: `${origin}${route.path}`,
    md: route.path === '/' ? `${origin}/index.md` : `${origin}${route.path}.md`,
    kind: 'static',
    description: route.description,
  }));
  const templates = PUBLIC_DYNAMIC_ROUTE_TEMPLATES.map((route) => ({
    id: route.id,
    urlTemplate: `${origin}${route.html}`,
    mdTemplate: `${origin}${route.markdown}`,
    kind: 'dynamic-template',
    description: route.description,
    eligibility: 'Rendered pages must permit indexing under the public corpus policy.',
  }));

  return {
    name: PRODUCT.name,
    version: '3',
    url: origin,
    llms: `${origin}/llms.txt`,
    llmsFull: `${origin}/llms-full.txt`,
    openapi: `${origin}/openapi.json`,
    sitemap: `${origin}/sitemap.xml`,
    robots: `${origin}/robots.txt`,
    mcp: {
      url: 'https://api.highsignal.app/mcp',
      serverCard: 'https://api.highsignal.app/mcp/server-card',
      transport: 'streamable-http',
      auth: 'none',
      tools: [
        'get_daily_brief',
        'get_signal',
        'get_daily_dump',
        'get_source_coverage',
        'search_signals',
        'browse_source',
        'get_track_record',
        'get_entity',
      ],
    },
    markdown: {
      suffix: '.md',
      negotiation: true,
    },
    agentSkills: {
      index: `${origin}/.well-known/agent-skills/index.json`,
      dailyBrief: `${origin}/.well-known/agent-skills/high-signal-daily-brief/SKILL.md`,
    },
    ard: `${origin}/.well-known/ard.json`,
    surfaces: staticSurfaces,
    templates,
    dataResources: [
      {
        id: 'signals-rss',
        url: `${origin}/signals/rss`,
        kind: 'rss',
        description: 'Published signal feed.',
      },
      {
        id: 'signals-atom',
        url: `${origin}/signals/atom`,
        kind: 'atom',
        description: 'Published signal feed.',
      },
      {
        id: 'hit-rate-json',
        url: `${origin}/data/hit-rate.json`,
        kind: 'json',
        description: 'Public hit-rate ledger data.',
      },
      {
        id: 'daily-dump-json',
        url: 'https://api.highsignal.app/data/daily',
        kind: 'json',
        description:
          'Complete UTC daily dump of published signals, linked evidence events, and the separately labeled Digg attention overlay.',
      },
      {
        id: 'high-signal-mcp',
        url: 'https://api.highsignal.app/mcp',
        kind: 'mcp',
        description:
          'Public read-only Streamable HTTP MCP server for the Daily Brief, signal proofs, and complete daily dump.',
      },
    ],
    auth: {
      public: true,
      notes:
        'Only public reader surfaces are cataloged. Review, admin, delivery, and private machinery are excluded.',
    },
  };
}

const OPENAPI_MACHINE_SURFACES = [
  {
    path: '/llms.txt',
    tag: 'agent-surfaces',
    summary: 'Short LLM index',
    description: 'Concise index of product surfaces for LLM agents.',
    responseDescription: 'Plain-text LLM index',
    contentType: 'text/plain',
    schemaType: 'string',
  },
  {
    path: '/llms-full.txt',
    tag: 'agent-surfaces',
    summary: 'Full LLM brief',
    description: 'Complete agent brief with all surfaces and data resources.',
    responseDescription: 'Plain-text full agent brief',
    contentType: 'text/plain',
    schemaType: 'string',
  },
  {
    path: '/api/ai',
    tag: 'agent-surfaces',
    summary: 'Agent catalog',
    description: 'JSON inventory of all public agent surfaces, templates, and data resources.',
    responseDescription: 'Agent catalog JSON',
    contentType: 'application/json',
    schemaType: 'object',
  },
  {
    path: '/openapi.json',
    tag: 'agent-surfaces',
    summary: 'OpenAPI specification',
    description: 'OpenAPI 3.1 description of public agent surfaces.',
    responseDescription: 'OpenAPI 3.1 JSON',
    contentType: 'application/json',
    schemaType: 'object',
  },
  {
    path: '/index.md',
    tag: 'agent-surfaces',
    summary: 'Homepage Markdown',
    description: 'Product brief in Markdown without JavaScript.',
    responseDescription: 'Markdown product brief',
    contentType: 'text/markdown',
    schemaType: 'string',
  },
  {
    path: '/signals/rss',
    tag: 'data',
    summary: 'Signals RSS feed',
    description: 'Published signals as RSS.',
    responseDescription: 'RSS XML feed of published signals',
    contentType: 'application/rss+xml',
    schemaType: 'string',
  },
  {
    path: '/signals.json',
    tag: 'data',
    summary: 'Published signals JSON',
    description: 'Published signals as JSON.',
    responseDescription: 'JSON array of published signals',
    contentType: 'application/json',
    schemaType: 'array',
  },
  {
    path: '/data/hit-rate.json',
    tag: 'data',
    summary: 'Hit-rate ledger JSON',
    description: 'Downloadable public hit-rate ledger for every market call.',
    responseDescription: 'Hit-rate ledger JSON',
    contentType: 'application/json',
    schemaType: 'object',
  },
  {
    path: '/data/daily',
    tag: 'data',
    summary: 'Complete daily signals, evidence, and attention dump',
    description:
      'One UTC day of published signals, every canonical evidence event linked to them, and the derived Digg attention sections. Digg never contributes evidence or confidence.',
    responseDescription: 'Daily signals, evidence, and attention JSON',
    contentType: 'application/json',
    schemaType: 'object',
    servers: [{ url: 'https://api.highsignal.app' }],
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: false,
        description: 'UTC date in YYYY-MM-DD format; defaults to the current UTC date.',
        schema: { type: 'string', format: 'date' },
      },
    ],
  },
];

const OPENAPI_PARAMETER_NAMES = new Map([['yyyy-mm', 'period']]);
const OPENAPI_TEMPLATE_PATTERN = compilePattern(String.raw`\{([^}]+)\}`, 'g');

function openapiSpecForOrigin(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: PRODUCT.name,
      version: '1.0.0',
      description: PRODUCT.summary,
      contact: { url: origin },
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'agent-surfaces', description: 'Machine-readable discovery surfaces' },
      { name: 'public-pages', description: 'Public HTML pages with Markdown alternates' },
      { name: 'data', description: 'Public JSON and feed data resources' },
    ],
    paths: Object.fromEntries([
      ...OPENAPI_MACHINE_SURFACES.map((surface) => [surface.path, machinePathItem(surface)]),
      ...PUBLIC_STATIC_ROUTES.map((route) => [
        route.path,
        publicPagePathItem(route.title, route.description),
      ]),
      ...PUBLIC_DYNAMIC_ROUTE_TEMPLATES.map((route) => [
        openapiPath(route.html),
        publicPagePathItem(route.description, route.description, openapiParameters(route.html)),
      ]),
    ]),
  };
}

function machinePathItem(surface) {
  return {
    get: {
      tags: [surface.tag],
      summary: surface.summary,
      description: surface.description,
      ...(surface.servers ? { servers: surface.servers } : {}),
      ...(surface.parameters ? { parameters: surface.parameters } : {}),
      responses: {
        200: {
          description: surface.responseDescription,
          content: { [surface.contentType]: { schema: { type: surface.schemaType } } },
        },
      },
    },
  };
}

function publicPagePathItem(summary, description, parameters = []) {
  return {
    get: {
      tags: ['public-pages'],
      summary,
      description,
      parameters,
      responses: {
        200: {
          description: 'HTML page with a Markdown alternate.',
          content: {
            'text/html': { schema: { type: 'string' } },
            'text/markdown': { schema: { type: 'string' } },
          },
        },
      },
    },
  };
}

function openapiPath(pathTemplate) {
  return pathTemplate.replace(OPENAPI_TEMPLATE_PATTERN, (_, name) => {
    return `{${OPENAPI_PARAMETER_NAMES.get(name) ?? name}}`;
  });
}

function openapiParameters(pathTemplate) {
  return [...pathTemplate.matchAll(OPENAPI_TEMPLATE_PATTERN)].map((match) => {
    const sourceName = match[1];
    const name = OPENAPI_PARAMETER_NAMES.get(sourceName) ?? sourceName;
    return {
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `${name} path segment`,
    };
  });
}

export function handleAgentEdge(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = normalizePublicPath(url.pathname);

  if (path === '/' && url.searchParams.get('mode') === 'agent') {
    return json(request, catalogForOrigin(url.origin), {
      'Content-Location': '/api/ai',
      Vary: 'Accept',
    });
  }

  if (path === '/api/ai' || path === '/api-ai.json') {
    return json(request, catalogForOrigin(url.origin));
  }
  if (path === '/openapi.json') {
    return json(request, openapiSpecForOrigin(url.origin));
  }

  return null;
}

export function agentDiscoveryLinkHeader(origin) {
  return [
    discoveryLinkHeader(SITE_URL),
    '</sitemap.xml>; rel="sitemap"; type="application/xml"',
    '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
    '</api/ai>; rel="service-desc"; type="application/json"',
    '</.well-known/ard.json>; rel="ard"; type="application/json"',
    `<${origin}/.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"`,
  ].join(', ');
}

export function resolvePublicMarkdownTarget(request) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const pathname = new URL(request.url).pathname;
  const direct = pathname === '/api/md' || pathname.startsWith('/api/md/');
  if (!direct && /^\/(?:api|_next|_astro|\.well-known)(?:\/|$)/.test(pathname)) return null;
  const suffixRequest = pathname.endsWith('.md');
  if (!direct && !suffixRequest && !wantsMarkdown(request)) return null;
  const publicPath = normalizePublicPath(
    direct
      ? '/' + pathname.replace(/^\/api\/md\/?/, '')
      : suffixRequest
        ? htmlPathFromMarkdown(pathname)
        : pathname
  );
  if (!direct && !suffixRequest && !isPublicHtmlPath(publicPath)) return null;
  return {
    publicPath,
    suffixRequest,
    direct,
    markdownPath: publicPath === '/' ? '/index.md' : `${publicPath}.md`,
  };
}

function unavailableMarkdown(request, path, status = 404) {
  const canonical = new URL(path, SITE_URL).href;
  const response = markdownResponse(
    status === 404
      ? '# Not found\n\nNo public Markdown page exists at this path.\n'
      : '# Temporarily unavailable\n\nThe public source could not be loaded.\n',
    request,
    {
      'Content-Location': canonical,
      Link: `<${canonical}>; rel="canonical", ${discoveryLinkHeader(SITE_URL)}`,
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    }
  );
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status,
    headers: response.headers,
  });
}

export async function handleRenderedMarkdown(request, renderSource) {
  const target = resolvePublicMarkdownTarget(request);
  if (!target) return null;
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept',
      },
    });
  if (!isPublicHtmlPath(target.publicPath)) return unavailableMarkdown(request, target.publicPath);
  // A fresh request prevents authenticated history, cookies, query filters and RSC state from entering public content.
  const sourceUrl = new URL(
    '/api/public-markdown' + (target.publicPath === '/' ? '' : target.publicPath),
    request.url
  );
  let response;
  try {
    response = await renderSource(
      new Request(sourceUrl, { headers: { Accept: 'application/json' } })
    );
  } catch {
    return unavailableMarkdown(request, target.publicPath, 503);
  }
  if (response.status === 404) return unavailableMarkdown(request, target.publicPath);
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json'))
    return unavailableMarkdown(request, target.publicPath, 503);
  let source;
  try {
    source = await response.json();
  } catch {
    return unavailableMarkdown(request, target.publicPath, 503);
  }
  let canonicalPath;
  try {
    if (
      typeof source?.markdown !== 'string' ||
      !source.markdown.startsWith('# ') ||
      typeof source.url !== 'string'
    )
      throw new Error('Invalid source');
    const canonical = new URL(source.url);
    if (canonical.origin !== SITE_URL || !isPublicHtmlPath(canonical.pathname))
      throw new Error('Invalid canonical');
    canonicalPath = canonical.pathname;
  } catch {
    return unavailableMarkdown(request, target.publicPath, 503);
  }
  const manifest = {
    name: SITE_NAME,
    origin: SITE_URL,
    summary: SITE_DESCRIPTION,
    pages: {},
    negotiation: true,
    catalog: catalogForOrigin(SITE_URL),
  };
  const handle = createAgentSurfaceHandler({
    manifest,
    listMarkdownRoutes: () => [
      {
        path: canonicalPath,
        title: source.title,
        description: source.description,
        aliases: [new URL(request.url).pathname],
      },
    ],
    loadMarkdown: () => source.markdown,
  });
  const result = await handle(request);
  // Public history expires at the day boundary; never keep a cached representation after its access policy changes.
  if (/^\/(?:signals|brief|embed)(?:\/|$)/.test(target.publicPath) || target.publicPath === '/') {
    result.headers.set('Cache-Control', 'no-store');
    result.headers.set('CDN-Cache-Control', 'no-store');
    result.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  return result;
}

/**
 * Cache explicit `.md` and `/api/md` requests under the canonical `.md` key.
 *
 * The Worker passes `cacheEnabled: false` for authenticated requests. Query
 * variants, HEAD requests, and Accept-negotiated HTML URLs also bypass this
 * public cache so only the sitemap/catalog form can be shared safely.
 */
export async function handleCachedRenderedMarkdown(
  request,
  renderHtml,
  { cache, waitUntil, cacheEnabled = true, cacheBuildId = 'unversioned' } = {}
) {
  const target = resolvePublicMarkdownTarget(request);
  const url = new URL(request.url);
  const canCache =
    cacheEnabled &&
    request.method === 'GET' &&
    (target?.suffixRequest === true || target?.direct === true) &&
    url.search === '' &&
    cache &&
    typeof cache.match === 'function' &&
    typeof cache.put === 'function';

  if (!canCache) return handleRenderedMarkdown(request, renderHtml);

  const cacheUrl = new URL(url);
  cacheUrl.pathname = target.markdownPath;
  cacheUrl.searchParams.set('__hs_agent_build', cacheBuildId);
  cacheUrl.searchParams.set('__hs_agent_format', 'source-v1');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return withEdgeCacheStatus(cached, 'AGENT-HIT');

  const rendered = await handleRenderedMarkdown(request, renderHtml);
  if (!isCacheableRenderedMarkdown(rendered)) return rendered;

  const write = Promise.resolve(cache.put(cacheKey, rendered.clone())).catch(() => undefined);
  if (typeof waitUntil === 'function') waitUntil(write);
  else await write;

  return withEdgeCacheStatus(rendered, 'AGENT-MISS');
}

/**
 * Compatibility hook: crawler identity never changes the requested representation.
 * Explicit Markdown requests use the build-keyed cache and public burst guard.
 */
export async function handleCachedCrawlerMarkdown() {
  // Format is selected by Accept or the URL, never by crawler identity.
  return null;
}

export function isBulkAiCrawler(request) {
  if (request.cf?.verifiedBotCategory === 'AI Crawler') return true;
  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  return BULK_AI_CRAWLER_USER_AGENTS.some((crawler) => userAgent.includes(crawler));
}

function isCacheableRenderedMarkdown(response) {
  if (
    response?.status !== 200 ||
    response.headers.has('set-cookie') ||
    /no-store|private/i.test(response.headers.get('cache-control') ?? '')
  )
    return false;
  return isMarkdownContentType(response.headers.get('content-type') ?? '');
}

function withEdgeCacheStatus(response, status) {
  const headers = new Headers(response.headers);
  // Cloudflare may apply a zone Browser Cache TTL to a Cache API hit. Keep the
  // public contract identical to a freshly rendered agent response.
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', AGENT_CACHE_CONTROL);
  headers.set('x-edge-cache', status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isMarkdownContentType(contentType) {
  const normalized = contentType.toLowerCase();
  return normalized.includes('text/markdown') || normalized.includes('text/plain');
}

const HTML_META_TAG_PATTERN = compilePattern(String.raw`<meta\b[^>]*>`, 'gi');
const HTML_NAME_ATTRIBUTE_PATTERN = compilePattern(String.raw`\bname\s*=\s*(['"])(.*?)\1`, 'i');
const HTML_CONTENT_ATTRIBUTE_PATTERN = compilePattern(
  String.raw`\bcontent\s*=\s*(['"])(.*?)\1`,
  'i'
);

function compilePattern(source, flags) {
  return new RegExp(source, flags);
}

export function htmlDisallowsIndexing(html) {
  for (const match of html.matchAll(HTML_META_TAG_PATTERN)) {
    const tag = match[0];
    const name = tag.match(HTML_NAME_ATTRIBUTE_PATTERN)?.[2]?.toLowerCase();
    const content = tag.match(HTML_CONTENT_ATTRIBUTE_PATTERN)?.[2]?.toLowerCase();
    if (name === 'robots' && (content ?? '').split(/[\s,]+/).includes('noindex')) return true;
  }
  return false;
}

export function wantsMarkdown(request) {
  return prefersMarkdown(request);
}

function json(request, data, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': AGENT_CACHE_CONTROL,
      ...RATE_LIMIT_HEADERS,
      ...extra,
    },
  });
}
