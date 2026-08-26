import {
  PUBLIC_DYNAMIC_ROUTE_TEMPLATES,
  PUBLIC_STATIC_ROUTES,
  isPublicHtmlPath,
  normalizePublicPath,
} from './public-route-registry.mjs';

const PRODUCT = {
  name: 'High Signal',
  url: 'https://highsignal.app',
  summary:
    'Daily synthesized brief on technology, startups, and finance with cited evidence and a public hit-rate ledger.',
};

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
  'meta-externalagent',
];

const INDEX_MARKDOWN = `# High Signal

High Signal turns noisy public evidence into one daily synthesized brief across
technology, startups, and finance.

## Evidence contract

- Published signals require at least two cited sources.
- Predictions carry direction, confidence, and a maturity window.
- Matured calls feed a public hit-rate ledger.
- Corrections are additive and cite the prior signal.
- Prediction-market probabilities are context, not equity prices.

## Main product surfaces

- [Daily Brief](https://highsignal.app/brief)
- [How the Daily Brief works](https://highsignal.app/daily-intelligence-brief)
- [Startup intelligence platform](https://highsignal.app/startup-intelligence-platform)
- [Market intelligence for founders](https://highsignal.app/market-intelligence-for-founders)
- [Technology trend intelligence](https://highsignal.app/technology-trend-intelligence)
- [Published signals](https://highsignal.app/signals)
- [Track record](https://highsignal.app/track-record)
- [Methodology](https://highsignal.app/methodology)
- [Company universe](https://highsignal.app/case-studies)
- [Markets](https://highsignal.app/markets)
- [Changelog](https://highsignal.app/changelog)

## Machine surfaces

- [Agent catalog](https://highsignal.app/api/ai)
- [Short agent index](https://highsignal.app/llms.txt)
- [Full agent brief](https://highsignal.app/llms-full.txt)
- [Canonical sitemap](https://highsignal.app/sitemap.xml)
- [Signals RSS](https://highsignal.app/signals/rss)
`;

const LLMS_MARKDOWN = `# High Signal

> ${PRODUCT.summary}

## Start here

- [Daily Brief](https://highsignal.app/brief)
- [Daily intelligence guide](https://highsignal.app/daily-intelligence-brief)
- [Startup intelligence guide](https://highsignal.app/startup-intelligence-platform)
- [Founder market-intelligence workflow](https://highsignal.app/market-intelligence-for-founders)
- [Technology trend-intelligence guide](https://highsignal.app/technology-trend-intelligence)
- [Signals](https://highsignal.app/signals)
- [Track record](https://highsignal.app/track-record)
- [Methodology](https://highsignal.app/methodology)
- [Agent catalog](https://highsignal.app/api/ai)

Every index-eligible public HTML route has a Markdown alternate. Large dynamic
corpora use the templates declared by the agent catalog and the same eligibility
policy as the canonical sitemap.
`;

const LLMS_FULL_MARKDOWN = `${INDEX_MARKDOWN}

## Dynamic public corpora

- Dated Daily Brief records
- Published signal detail pages
- Entity and entity-month archives
- Signal-type taxonomies
- Qualified company-universe profiles

These Markdown responses are rendered from the same server-side product output
as the human page. Private review, admin, delivery, and JSON machinery is
excluded.

## Data resources

- https://highsignal.app/signals/rss
- https://highsignal.app/signals/atom
- https://highsignal.app/signals.json
- https://highsignal.app/entities.json
- https://highsignal.app/data/hit-rate.json
- https://api.highsignal.app/data/daily
`;

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
    version: '2',
    url: origin,
    llms: `${origin}/llms.txt`,
    llmsFull: `${origin}/llms-full.txt`,
    openapi: `${origin}/openapi.json`,
    sitemap: `${origin}/sitemap.xml`,
    robots: `${origin}/robots.txt`,
    markdown: {
      suffix: '.md',
      negotiation: true,
    },
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

  if (path === '/llms.txt') {
    return text(request, LLMS_MARKDOWN, 'text/plain; charset=utf-8');
  }
  if (path === '/llms-full.txt') {
    return text(request, LLMS_FULL_MARKDOWN, 'text/plain; charset=utf-8');
  }
  if (path === '/index.md') {
    return text(request, INDEX_MARKDOWN, 'text/markdown; charset=utf-8');
  }
  if (path === '/api/ai' || path === '/api-ai.json') {
    return json(request, catalogForOrigin(url.origin));
  }
  if (path === '/openapi.json') {
    return json(request, openapiSpecForOrigin(url.origin));
  }

  if (path === '/' && wantsMarkdown(request)) {
    return text(request, INDEX_MARKDOWN, 'text/markdown; charset=utf-8', {
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
      Vary: 'Accept',
    });
  }

  return null;
}

export function resolvePublicMarkdownTarget(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const normalized = normalizePublicPath(url.pathname);
  let publicPath = normalized;
  let suffixRequest = false;

  if (normalized.endsWith('.md')) {
    publicPath = normalizePublicPath(normalized.slice(0, -3));
    suffixRequest = true;
  } else if (!wantsMarkdown(request)) {
    return null;
  }

  if (!isPublicHtmlPath(publicPath)) return null;
  return {
    publicPath,
    suffixRequest,
    markdownPath: publicPath === '/' ? '/index.md' : `${publicPath}.md`,
  };
}

export async function handleRenderedMarkdown(request, renderHtml) {
  const target = resolvePublicMarkdownTarget(request);
  if (!target) return null;

  const htmlUrl = new URL(request.url);
  htmlUrl.pathname = target.publicPath;
  const headers = new Headers(request.headers);
  headers.set('Accept', 'text/html');
  headers.set('x-high-signal-agent-render', 'markdown');
  const htmlRequest = new Request(htmlUrl, {
    method: 'GET',
    headers,
  });
  const rendered = await renderHtml(htmlRequest);
  const contentType = rendered.headers.get('content-type') ?? '';

  if (!rendered.ok || !contentType.includes('text/html')) {
    return new Response(request.method === 'HEAD' ? null : rendered.body, {
      status: rendered.status,
      statusText: rendered.statusText,
      headers: rendered.headers,
    });
  }

  const html = await rendered.text();
  if (htmlDisallowsIndexing(html)) {
    return new Response('This public route is not part of the agent discovery corpus.\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const markdown = htmlDocumentToMarkdown(
    html,
    new URL(target.publicPath, htmlUrl.origin).toString()
  );
  if (!markdown) {
    return new Response('Public page rendered without readable content.\n', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return text(request, markdown, 'text/markdown; charset=utf-8', {
    Link: `<${target.publicPath}>; rel="canonical"; type="text/html"`,
    Vary: 'Accept',
  });
}

/**
 * Cache the canonical `.md` form without changing the underlying renderer.
 *
 * The Worker passes `cacheEnabled: false` for authenticated requests. Query
 * variants, HEAD requests, and Accept-negotiated HTML URLs also bypass this
 * public cache so only the sitemap/catalog form can be shared safely.
 */
export async function handleCachedRenderedMarkdown(
  request,
  renderHtml,
  { cache, waitUntil, cacheEnabled = true } = {}
) {
  const target = resolvePublicMarkdownTarget(request);
  const url = new URL(request.url);
  const canCache =
    cacheEnabled &&
    request.method === 'GET' &&
    target?.suffixRequest === true &&
    url.search === '' &&
    cache &&
    typeof cache.match === 'function' &&
    typeof cache.put === 'function';

  if (!canCache) return handleRenderedMarkdown(request, renderHtml);

  const cacheKey = new Request(url.toString(), { method: 'GET' });
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
 * Keep bulk AI training crawlers useful without sending them through the
 * browser-oriented Next.js/RSC prefetch graph. Search crawlers and user-driven
 * assistants continue to receive normal HTML.
 */
export async function handleCachedCrawlerMarkdown(
  request,
  renderHtml,
  { cache, waitUntil, cacheEnabled = true } = {}
) {
  if (!cacheEnabled || !isBulkAiCrawler(request) || request.method !== 'GET') return null;
  if (request.headers.get('rsc') === '1') return null;

  const url = new URL(request.url);
  const publicPath = normalizePublicPath(url.pathname);
  if (url.search !== '' || !isPublicHtmlPath(publicPath)) return null;

  const markdownUrl = new URL(url);
  markdownUrl.pathname = publicPath === '/' ? '/index.md' : `${publicPath}.md`;
  const headers = new Headers(request.headers);
  headers.set('Accept', 'text/markdown');
  const markdownRequest = new Request(markdownUrl, { method: 'GET', headers });
  const response = await handleCachedRenderedMarkdown(markdownRequest, renderHtml, {
    cache,
    waitUntil,
    cacheEnabled: true,
  });
  if (!response) return null;

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Content-Location', markdownUrl.pathname);
  responseHeaders.set('x-high-signal-crawler-view', 'markdown');
  responseHeaders.set('Vary', mergeVary(responseHeaders.get('Vary'), 'User-Agent'));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export function isBulkAiCrawler(request) {
  if (request.cf?.verifiedBotCategory === 'AI Crawler') return true;
  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  return BULK_AI_CRAWLER_USER_AGENTS.some((crawler) => userAgent.includes(crawler));
}

function isCacheableRenderedMarkdown(response) {
  if (response?.status !== 200 || response.headers.has('set-cookie')) return false;
  return isMarkdownContentType(response.headers.get('content-type') ?? '');
}

function withEdgeCacheStatus(response, status) {
  const headers = new Headers(response.headers);
  // Cloudflare may apply a zone Browser Cache TTL to a Cache API hit. Keep the
  // public contract identical to a freshly rendered agent response.
  headers.set('Cache-Control', AGENT_CACHE_CONTROL);
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

function mergeVary(current, value) {
  const values = (current ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(', ');
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

export function htmlDocumentToMarkdown(html, canonicalUrl) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  let source = main?.[1] ?? body?.[1] ?? html;
  const codeBlocks = [];

  source = replaceHtmlWithMarkdown(source, canonicalUrl, codeBlocks);
  source = normalizeMarkdownSource(source);

  for (const [index, block] of codeBlocks.entries()) {
    source = source.replace(`@@CODE_BLOCK_${index}@@`, block);
  }

  if (!source) return '';
  return `${source}\n\n---\n\nCanonical HTML: ${canonicalUrl}\n`;
}

function replaceHtmlWithMarkdown(source, canonicalUrl, codeBlocks) {
  return replaceRichHtml(source, canonicalUrl, codeBlocks)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|aside|nav|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<(p|div|section|article|header|footer|aside|nav|ul|ol|table|tr)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(td|th)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');
}

function normalizeMarkdownSource(source) {
  return decodeHtml(source)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:^|\n)-\s*(?=\n|$)/g, '')
    .trim();
}

function replaceRichHtml(source, canonicalUrl, codeBlocks) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, block) => {
      const decoded = decodeHtml(stripTags(block)).trim();
      const token = `\n\n@@CODE_BLOCK_${codeBlocks.length}@@\n\n`;
      codeBlocks.push(`\`\`\`\n${decoded}\n\`\`\``);
      return token;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
      return `\n\n${'#'.repeat(Number(level))} ${inlineText(content)}\n\n`;
    })
    .replace(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, _quote, href, content) => {
      const label = inlineText(content);
      if (!label) return '';
      const target = absoluteLink(href, canonicalUrl);
      return target ? `[${label}](${target})` : label;
    })
    .replace(/<img\b[^>]*alt=(['"])(.*?)\1[^>]*>/gi, (_, _quote, alt) => decodeHtml(alt))
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, content) => {
      const value = inlineText(content);
      return value ? `**${value}**` : '';
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, content) => {
      const value = inlineText(content);
      return value ? `*${value}*` : '';
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
      const value = decodeHtml(stripTags(content)).trim();
      return value ? `\`${value}\`` : '';
    });
}

function inlineText(value) {
  return decodeHtml(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, '');
}

function absoluteLink(href, canonicalUrl) {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return href;
  try {
    return new URL(href, canonicalUrl).toString();
  } catch {
    return '';
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'");
}

export function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
}

function text(request, body, type, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': AGENT_CACHE_CONTROL,
      ...extra,
    },
  });
}

function json(request, data) {
  return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': AGENT_CACHE_CONTROL,
      ...RATE_LIMIT_HEADERS,
    },
  });
}
