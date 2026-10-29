import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { qualifyPublicSitemap } from '../apps/web/public-sitemap.mjs';

const request = new Request('https://highsignal.app/sitemap.xml');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://highsignal.app/</loc></url>
<url><loc>https://highsignal.app/articles/source-mix</loc></url>
<url><loc>https://highsignal.app/case-studies/example</loc><lastmod>2026-09-07T00:00:00.000Z</lastmod></url>
<url><loc>https://highsignal.app/brief/2026-10-28</loc><lastmod>2026-10-28T18:00:00.000Z</lastmod></url>
<url><loc>https://highsignal.app/brief/2026-10-29</loc></url>
</urlset>`;
const cached = () =>
  new Response(xml, {
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, max-age=300, s-maxage=3600',
      etag: '"cached-before-midnight"',
      'content-length': String(xml.length),
      'content-encoding': 'gzip',
      'x-edge-cache': 'HIT',
    },
  });

const before = await qualifyPublicSitemap(request, cached(), new Date('2026-10-29T18:29:59Z'));
assert.equal(await before.text(), xml, 'yesterday remains public before IST midnight');
assert.equal(before.headers.get('cache-control'), 'public, max-age=1, s-maxage=1');

const after = await qualifyPublicSitemap(request, cached(), new Date('2026-10-29T18:30:00Z'));
const publicXml = await after.text();
assert.doesNotMatch(publicXml, /2026-10-28/, 'cached sitemap must drop newly protected history');
for (const path of ['/', '/articles/source-mix', '/case-studies/example', '/brief/2026-10-29']) {
  assert.ok(publicXml.includes(`<loc>https://highsignal.app${path}</loc>`), path);
}
assert.match(publicXml, /<lastmod>2026-09-07T00:00:00.000Z<\/lastmod>/);
assert.equal(after.headers.get('cache-control'), 'public, max-age=300, s-maxage=3600');
assert.equal(after.headers.get('x-edge-cache'), 'HIT');
for (const header of ['etag', 'content-length', 'content-encoding']) {
  assert.equal(after.headers.get(header), null, `${header} cannot describe changed XML bytes`);
}

const head = await qualifyPublicSitemap(
  new Request(request, { method: 'HEAD' }),
  cached(),
  new Date('2026-10-29T18:30:00Z')
);
assert.equal(await head.text(), '');
for (const [otherRequest, otherResponse] of [
  [new Request('https://highsignal.app/robots.txt'), cached()],
  [request, new Response('Unavailable', { status: 503 })],
  [request, Response.redirect('https://highsignal.app/', 308)],
  [request, new Response('html', { headers: { 'content-type': 'text/html' } })],
]) {
  assert.equal(await qualifyPublicSitemap(otherRequest, otherResponse), otherResponse);
}

const signal = {
  slug: 'dated-signal',
  reviewStatus: 'published',
  bodyMd: '# Signal\n\n'.padEnd(260, 'x'),
  evidenceUrls: ['https://one.example', 'https://two.example'],
  primaryEntityId: 'ACME',
  signalType: 'demand_shift',
  publishedAt: '2026-10-29T01:00:00.000Z',
};
const aliases = {
  '@/app/case-studies/data':
    'export const CASE_STUDIES = []; export const CASE_STUDIES_TOTAL_PAGES = 1; export const COMPANY_UNIVERSE_LAST_UPDATED = null;',
  '@/lib/site': 'export const SITE_URL = "https://highsignal.app";',
  '@/lib/api': `export const api = {
    signals: async () => ({ signals: ${JSON.stringify([signal, { ...signal, slug: 'undated-signal', publishedAt: 'unavailable' }])} }),
    entities: async () => ({ entities: [{id: "ACME"}] }),
    briefDates: async () => ({ dates: [] })
  };`,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return aliases[specifier]
      ? {
          url: `data:text/javascript,${encodeURIComponent(aliases[specifier])}`,
          shortCircuit: true,
        }
      : nextResolve(specifier, context);
  },
});
try {
  const { default: sitemap } = await import('../apps/web/src/app/sitemap.ts');
  const entries = await sitemap();
  const modified = entries.filter((entry) => entry.lastModified);
  assert.deepEqual(
    modified.map((entry) => [entry.url, entry.lastModified.toISOString()]),
    [['https://highsignal.app/signals/dated-signal', signal.publishedAt]],
    'only a known content update may become lastmod; generation time is not a content edit'
  );
  assert.ok(entries.some((entry) => entry.url === 'https://highsignal.app/'));
  assert.ok(entries.some((entry) => entry.url === 'https://highsignal.app/signals/undated-signal'));
} finally {
  hooks.deregister();
}

console.log('public sitemap rollover, cached-response, and lastmod tests passed');
