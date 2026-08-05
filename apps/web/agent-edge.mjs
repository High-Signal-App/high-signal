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

const INDEX_MARKDOWN = `# High Signal

High Signal turns noisy public evidence into one daily synthesized brief across
technology, startups, markets, buyer intent, brand perception, and product
opportunities.

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
- [Mentions and AI visibility](https://highsignal.app/mentions)
- [Agent Eval](https://highsignal.app/agent-eval)
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

- Dated Daily Brief archives
- Published signal detail pages
- Entity and entity-month archives
- Signal-type taxonomies
- Qualified company-universe profiles

These Markdown responses are rendered from the same server-side product output
as the human page. Private review, admin, authentication, personal, delivery,
and JSON machinery is excluded.

## Data resources

- https://highsignal.app/signals/rss
- https://highsignal.app/signals/atom
- https://highsignal.app/digest/rss
- https://highsignal.app/digest/atom
- https://highsignal.app/signals.json
- https://highsignal.app/entities.json
- https://highsignal.app/data/hit-rate.json
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
        id: 'digest-rss',
        url: `${origin}/digest/rss`,
        kind: 'rss',
        description: 'Public digest feed.',
      },
      {
        id: 'hit-rate-json',
        url: `${origin}/data/hit-rate.json`,
        kind: 'json',
        description: 'Public hit-rate ledger data.',
      },
    ],
    auth: {
      public: true,
      notes:
        'Only public reader surfaces are cataloged. Review, admin, auth, personal, delivery, and private feeds are excluded.',
    },
  };
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

function isCacheableRenderedMarkdown(response) {
  if (response?.status !== 200 || response.headers.has('set-cookie')) return false;
  return isMarkdownContentType(response.headers.get('content-type') ?? '');
}

function withEdgeCacheStatus(response, status) {
  const headers = new Headers(response.headers);
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

export function htmlDisallowsIndexing(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => {
    const tag = match[0];
    const name = tag.match(/\bname\s*=\s*(['"])(.*?)\1/i)?.[2]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*(['"])(.*?)\1/i)?.[2]?.toLowerCase();
    return name === 'robots' && (content ?? '').split(/[\s,]+/).includes('noindex');
  });
}

export function htmlDocumentToMarkdown(html, canonicalUrl) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  let source = main?.[1] ?? body?.[1] ?? html;
  const codeBlocks = [];

  source = source
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
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|aside|nav|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<(p|div|section|article|header|footer|aside|nav|ul|ol|table|tr)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(td|th)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');

  source = decodeHtml(source)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:^|\n)-\s*(?=\n|$)/g, '')
    .trim();

  for (const [index, block] of codeBlocks.entries()) {
    source = source.replace(`@@CODE_BLOCK_${index}@@`, block);
  }

  if (!source) return '';
  return `${source}\n\n---\n\nCanonical HTML: ${canonicalUrl}\n`;
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

function wantsMarkdown(request) {
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
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      ...extra,
    },
  });
}

function json(request, data) {
  return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
