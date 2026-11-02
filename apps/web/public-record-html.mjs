import { agentDiscoveryLinkHeader, resolvePublicMarkdownTarget } from './agent-edge.mjs';
import { publicRecordId, validateRecord } from './public-record-document.mjs';
import { hasAuthCookie, isTrackingParameter } from './worker-cache-policy.mjs';
import { SITE_NAME, SITE_URL } from './src/lib/site.ts';
import {
  recordDateTime,
  recordMetadata,
  retainedTextExplanation,
} from './src/lib/retained-record.ts';

const SHELL_PATH = '/_private/reader/record-shell.reader';

export function publicRecordHtmlSelection(request) {
  if (
    !['GET', 'HEAD'].includes(request.method) ||
    resolvePublicMarkdownTarget(request) ||
    request.headers.has('authorization') ||
    request.headers.has('cf-access-jwt-assertion') ||
    hasAuthCookie(request) ||
    request.headers.has('rsc') ||
    request.headers.has('next-router-state-tree') ||
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-url')
  )
    return null;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !isTrackingParameter(key))) return null;
  const id = publicRecordId(url.pathname);
  return id ? { id, path: `/data/records/${encodeURIComponent(id)}` } : null;
}

async function recordState(env, id) {
  try {
    if (!env.API) return { state: 'unavailable', record: null };
    const response = await env.API.fetch(
      new Request(`https://api/data/records/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
      })
    );
    if (response.status === 404) return { state: 'missing', record: null };
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json'))
      return { state: 'unavailable', record: null };
    const record = await response.json();
    validateRecord(record, id);
    return { state: 'available', record };
  } catch {
    return { state: 'unavailable', record: null };
  }
}

async function recordShell(env, cache, ctx, origin, buildId) {
  const key = new Request(`${origin}/_private/reader-cache/${buildId}/record-shell`);
  const cached = await cache?.match(key);
  const response =
    cached ?? (await env.ASSETS.fetch(new Request(`https://assets.local${SHELL_PATH}`)));
  if (response.status !== 200) return null;
  const shell = await response.text();
  // Fixed build output, never a live reader page or a fallback asset document.
  if (shell.length > 262_144 || !shell.includes('data-record-reader="v1"')) return null;
  if (!cached)
    ctx.waitUntil(
      cache?.put(
        key,
        new Response(shell, {
          headers: { 'Cache-Control': 'public, max-age=86400' },
        })
      ) ?? Promise.resolve()
    );
  return shell;
}

function safeSourceUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value, SITE_URL).protocol) ? value : null;
  } catch {
    return null;
  }
}

function recordFields(record) {
  if (!record) return {};
  return {
    title: record.title ?? record.url,
    family: record.family,
    source: record.source !== record.family ? ` (${record.source})` : null,
    published: `published ${recordDateTime(record.publishedAt)}`,
    ingested: `ingested ${recordDateTime(record.ingestedAt)}`,
    entity: record.entity ? (record.entityName ?? record.entity) : null,
    extract: record.content && record.content !== record.retainedText ? record.content : null,
    'retained-heading': `retained text${record.retainedTextTruncated ? ' (truncated)' : ''}`,
    retained: record.retainedText || null,
    unretained: record.retainedText
      ? null
      : retainedTextExplanation(record.retainedTextUnavailableReason),
    fetched: record.documentFetchedAt
      ? `document fetched ${recordDateTime(record.documentFetchedAt)}${record.canonicalUrl && record.canonicalUrl !== record.url ? ` · canonical ${record.canonicalUrl}` : ''}`
      : null,
  };
}

function rewriteRecord(shell, selected, state, record, headers) {
  const canonical = new URL(selected.path, SITE_URL).href;
  const { title, description } = recordMetadata(record, selected.id);
  const fields = recordFields(record);
  const links = record
    ? {
        family: `/data/${encodeURIComponent(record.family)}`,
        entity: record.entity ? `/entities/${encodeURIComponent(record.entity)}` : null,
        original: safeSourceUrl(record.url),
      }
    : {};
  return new HTMLRewriter()
    .on('title', { element: (element) => element.setInnerContent(`${title} — ${SITE_NAME}`) })
    .on(
      'meta[name="description"], meta[name="ai-summary"], meta[property="og:description"], meta[name="twitter:description"]',
      {
        element: (element) => element.setAttribute('content', description),
      }
    )
    .on('meta[property="og:title"], meta[name="twitter:title"]', {
      element: (element) => element.setAttribute('content', `${title} — ${SITE_NAME}`),
    })
    .on('meta[property="og:url"]', {
      element: (element) => element.setAttribute('content', canonical),
    })
    .on('link[rel="canonical"]', { element: (element) => element.setAttribute('href', canonical) })
    .on('link[rel="alternate"][type="text/markdown"]', {
      element: (element) => element.setAttribute('href', `${canonical}.md`),
    })
    .on('[data-record-state]', {
      element: (element) => {
        if (element.getAttribute('data-record-state') !== state) element.remove();
      },
    })
    .on('[data-record-group="extract"]', {
      element: (element) => {
        if (fields.extract === null) element.remove();
      },
    })
    .on('[data-record-text]', {
      element: (element) => {
        const value = fields[element.getAttribute('data-record-text')];
        if (value === null || value === undefined) element.remove();
        else element.setInnerContent(value); // Text is escaped by HTMLRewriter.
      },
    })
    .on('[data-record-link]', {
      element: (element) => {
        const href = links[element.getAttribute('data-record-link')];
        if (href) element.setAttribute('href', href);
        else element.removeAttribute('href');
      },
    })
    .transform(new Response(shell, { headers }));
}

/** Compile the shared reader chrome once; project public record fields without Next. */
export async function handlePublicRecordHtml(request, env, ctx, { cache, cacheBuildId } = {}) {
  const selected = publicRecordHtmlSelection(request);
  if (!selected) return null;
  if (typeof cacheBuildId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(cacheBuildId))
    throw new Error('A record HTML cache build namespace is required');
  const origin = new URL(request.url).origin;
  const key = new Request(
    `${origin}/_private/reader-cache/${cacheBuildId}/record/${encodeURIComponent(selected.id)}`
  );
  const cached = await cache?.match(key);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-edge-cache', 'HIT');
    if (request.method === 'HEAD') await cached.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : cached.body, { headers });
  }
  const shell = await recordShell(env, cache, ctx, origin, cacheBuildId).catch(() => null);
  if (!shell) return null; // An incomplete deployment retains the existing reader.
  const { state, record } = await recordState(env, selected.id);
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control':
      state === 'available' ? 'public, max-age=60, s-maxage=300' : 'private, no-store',
    'x-reader-renderer': 'astro-record',
    'x-edge-cache': 'MISS',
    Link: agentDiscoveryLinkHeader(SITE_URL, selected.path),
    Vary: 'Accept, User-Agent',
  });
  // Existing record HTML uses 200 with a visible missing/unavailable explanation.
  // Those states must never enter the public response cache.
  if (request.method === 'HEAD') return new Response(null, { headers });
  const response = rewriteRecord(shell, selected, state, record, headers);
  if (state === 'available') ctx.waitUntil(cache?.put(key, response.clone()) ?? Promise.resolve());
  return response;
}
