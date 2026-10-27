import { agentDiscoveryLinkHeader, wantsMarkdown } from './agent-edge.mjs';
import { hasAuthCookie, isTrackingParameter } from './worker-cache-policy.mjs';

export const READER_MANIFEST_KEY = 'reader/v1/current.json';
const READER_MAX_AGE_MS = 300_000;
const PRIVATE_READER_PREFIX = '/_private/reader/';
const cacheRequest = (origin, source, path) =>
  new Request(`${origin}/_private/reader-cache/${source}/${path}`);
const indexableBuilds = new WeakMap();
function indexableProfile(build, slug) {
  let profiles = indexableBuilds.get(build);
  if (!profiles) {
    profiles = new Set(build.indexableProfiles);
    indexableBuilds.set(build, profiles);
  }
  return profiles.has(slug);
}
const clockDay = (now, offset = 0) =>
  new Date(now + 19_800_000 + offset * 86_400_000).toISOString().slice(0, 10);

function publicReaderRequest(request) {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    !request.headers.has('authorization') &&
    !request.headers.has('cf-access-jwt-assertion') &&
    !hasAuthCookie(request) &&
    !request.headers.has('rsc') &&
    !request.headers.has('next-router-state-tree')
  );
}

function readerQuery(url, profile) {
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (isTrackingParameter(key)) continue;
    if (!profile && url.pathname === '/' && ['day', 'region'].includes(key)) continue;
    return false;
  }
  return true;
}

export function readerSelection(request) {
  if (!publicReaderRequest(request) || wantsMarkdown(request)) return null;
  const url = new URL(request.url);
  const profile = url.pathname.match(/^\/case-studies\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (!readerQuery(url, Boolean(profile))) return null;
  if (profile && profile[1] !== 'search')
    return {
      kind: 'profile',
      slug: profile[1],
      markdown: false,
    };
  if (url.pathname !== '/' || wantsMarkdown(request)) return null;
  const day = url.searchParams.get('day') ?? 'today';
  if (day !== 'today' && day !== 'yesterday') return null;
  return {
    kind: 'brief',
    day,
    region: (url.searchParams.get('region') ?? 'global').trim().toLowerCase(),
    markdown: false,
  };
}

export function freshReaderManifest(value, source, now = Date.now()) {
  const captured = Date.parse(value?.capturedAt);
  return (
    value?.schema === 1 &&
    value.source === source &&
    value.editionDay === clockDay(now) &&
    Number.isFinite(captured) &&
    captured <= now + 30_000 &&
    now - captured < READER_MAX_AGE_MS &&
    Array.isArray(value.briefs) &&
    value.briefs.length > 0 &&
    value.briefs.every(
      (entry) =>
        entry &&
        ['today', 'yesterday'].includes(entry.day) &&
        typeof entry.region === 'string' &&
        typeof entry.html?.key === 'string' &&
        /^[a-f0-9]{64}$/.test(entry.html?.sha256 ?? '')
    )
  );
}

async function currentManifest(env, cache, buildId, ctx, origin) {
  const key = cacheRequest(origin, buildId, 'manifest');
  const cached = await cache?.match(key);
  if (cached) return cached.json();
  const object = await env.NEXT_INC_CACHE_R2_BUCKET?.get(READER_MANIFEST_KEY);
  if (!object) return null;
  const text = await object.text();
  const value = JSON.parse(text);
  ctx.waitUntil(
    cache?.put(
      key,
      new Response(text, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      })
    ) ?? Promise.resolve()
  );
  return value;
}

async function readPublishedBody(bucket, entry, format = 'html') {
  const object = await bucket.get(entry[format].key);
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  // Slots are reused. A pointer cached during rotation must never read another generation.
  if (digest !== entry[format].sha256) return null;
  return new Response(bytes, { headers: { ETag: object.httpEtag } });
}

/** Published bytes only. A miss or expired edition delegates to the existing renderer. */
export async function serveReaderArtifact(request, env, ctx, build, cache, now = Date.now()) {
  const selected = readerSelection(request);
  if (!selected) return null;
  const url = new URL(request.url);
  if (selected.kind === 'profile' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
    return Response.redirect(url.href, 308);
  }
  const origin = url.origin;
  let key;
  let load;
  let canonical;
  let root = false;
  if (selected.kind === 'profile') {
    if (!build.profiles) return null;
    const file = `${PRIVATE_READER_PREFIX}profiles/${selected.slug}.reader`;
    key = `profile/${selected.slug}/html`;
    canonical = `/case-studies/${selected.slug}`;
    load = () => env.ASSETS.fetch(new Request(`https://assets.local${file}`));
  } else {
    let manifest;
    try {
      manifest = await currentManifest(env, cache, build.source, ctx, origin);
    } catch {
      return null;
    }
    if (!freshReaderManifest(manifest, build.source, now)) return null;
    const region = manifest.briefs.some((item) => item.region === selected.region)
      ? selected.region
      : 'global';
    const entry = manifest.briefs.find(
      (item) => item.day === selected.day && item.region === region
    );
    if (
      !entry?.html?.key ||
      ![0, 1].includes(manifest.slot) ||
      entry.html.key !== `reader/v1/slots/${manifest.slot}/${entry.day}/${entry.region}.html`
    )
      return null;
    key = `brief/${entry.html.sha256}`;
    canonical = '/';
    root = true;
    load = () => readPublishedBody(env.NEXT_INC_CACHE_R2_BUCKET, entry);
  }
  const cacheKey = cacheRequest(origin, build.source, key);
  const cached = await cache?.match(cacheKey);
  const response = cached ?? (await load().catch(() => null));
  if (!response || response.status !== 200) return null;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', root ? 'private, no-cache' : 'public, max-age=60, s-maxage=3600');
  headers.set('x-reader-renderer', 'astro');
  headers.set('x-edge-cache', cached ? 'HIT' : 'MISS');
  headers.set('Link', agentDiscoveryLinkHeader('https://highsignal.app', canonical));
  headers.set('Vary', 'Accept, User-Agent');
  if (selected.kind === 'profile' && !indexableProfile(build, selected.slug))
    headers.set('X-Robots-Tag', 'noindex, follow');
  const result = new Response(request.method === 'HEAD' ? null : response.body, { headers });
  if (request.method === 'HEAD') await response.body?.cancel();
  if (!cached && request.method === 'GET') {
    const stored = result.clone();
    stored.headers.set('Cache-Control', 'public, max-age=3600');
    ctx.waitUntil(cache?.put(cacheKey, stored) ?? Promise.resolve());
  }
  return result;
}

/** Match the public homepage's published HTML generation, never scrape its body. */
export async function loadPublishedBriefMarkdown(
  request,
  env,
  ctx,
  build,
  cache,
  now = Date.now()
) {
  if (!publicReaderRequest(request) || new URL(request.url).search) return undefined;
  const origin = new URL(request.url).origin;
  let manifest;
  try {
    manifest = await currentManifest(env, cache, build.source, ctx, origin);
  } catch {
    return undefined;
  }
  if (!freshReaderManifest(manifest, build.source, now)) return undefined;
  const entry = manifest.briefs.find((item) => item.day === 'today' && item.region === 'global');
  if (
    ![0, 1].includes(manifest.slot) ||
    entry?.html?.key !== `reader/v1/slots/${manifest.slot}/today/global.html`
  )
    return undefined;
  const htmlKey = cacheRequest(origin, build.source, `brief/${entry.html.sha256}`);
  const html =
    (await cache?.match(htmlKey)) ??
    (await readPublishedBody(env.NEXT_INC_CACHE_R2_BUCKET, entry).catch(() => null));
  if (!html) return undefined; // The HTML route also delegates when this generation is unavailable.
  await html.body?.cancel();
  if (
    entry.markdown?.key !== `reader/v1/slots/${manifest.slot}/today/global.md` ||
    !/^[a-f0-9]{64}$/.test(entry.markdown?.sha256 ?? '')
  )
    throw new Error('Published brief has no paired Markdown');
  const markdownKey = cacheRequest(
    origin,
    build.source,
    `brief-markdown/${entry.html.sha256}/${entry.markdown.sha256}`
  );
  const cached = await cache?.match(markdownKey);
  const response =
    cached ?? (await readPublishedBody(env.NEXT_INC_CACHE_R2_BUCKET, entry, 'markdown'));
  if (!response)
    throw new Error('Published brief Markdown is unavailable or from another generation');
  const markdown = await response.text();
  if (
    !markdown.startsWith('# ') ||
    !markdown.includes('Canonical: https://highsignal.app/') ||
    ![clockDay(now), clockDay(now, -1)].some((day) =>
      markdown.includes(`data-edition-date="${day}"`)
    ) ||
    !markdown.includes('data-region="global"')
  )
    throw new Error('Invalid published brief Markdown');
  if (!cached)
    ctx.waitUntil(
      cache?.put(
        markdownKey,
        new Response(markdown, {
          headers: { 'Content-Type': 'text/markdown', 'Cache-Control': 'public, max-age=3600' },
        })
      ) ?? Promise.resolve()
    );
  return markdown;
}
