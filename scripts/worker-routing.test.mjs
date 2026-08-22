#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerConfig = readFileSync(resolve(root, 'apps/web/wrangler.toml'), 'utf8');
const workerSource = readFileSync(resolve(root, 'apps/web/worker.mjs'), 'utf8');
const cachePolicySource = readFileSync(resolve(root, 'apps/web/worker-cache-policy.mjs'), 'utf8');
const webPackage = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'));
const historyPage = readFileSync(resolve(root, 'apps/web/src/app/history/page.tsx'), 'utf8');

const workerFirstMatch = wranglerConfig.match(/run_worker_first\s*=\s*\[([\s\S]*?)\]/);
assert.ok(workerFirstMatch, 'wrangler.toml must declare assets.run_worker_first');

const workerFirstRoutes = [...workerFirstMatch[1].matchAll(/"([^"]+)"/g)].map(([, route]) => route);

assert.ok(
  workerFirstRoutes.includes('/*'),
  'application routes must remain Worker-first by default'
);
assert.ok(
  !workerFirstRoutes.includes('!/*'),
  'wrangler.toml must not bypass the Worker for all application routes'
);

const requiredAssetBypasses = [
  '!/_next/static/*',
  '!/_astro/*',
  '!/docs',
  '!/docs/*',
  '!/.well-known/security.txt',
  '!/apple-touch-icon.png',
  '!/favicon-32.png',
  '!/favicon.ico',
  '!/favicon.svg',
  '!/icon.svg',
];

assert.ok(
  !workerFirstRoutes.includes('!/'),
  'the canonical Daily Brief root must remain Worker-first instead of serving the Astro overlay'
);
assert.doesNotMatch(
  workerSource,
  /env\.ASSETS\s*&&\s*url\.pathname\s*===\s*['"]\/['"]/,
  'the Worker must not replace the canonical Daily Brief root with a static asset'
);
assert.match(
  cachePolicySource,
  /ROOT_EDGE_CACHE_CONTROL\s*=\s*['"]public, max-age=60, s-maxage=300['"]/,
  'the current Daily Brief must use the short edge-cache policy'
);
assert.match(
  cachePolicySource,
  /ROOT_CACHE_SCHEMA\s*=\s*['"]daily-brief-v2['"]/,
  'the Daily Brief root cache key must be versioned away from prior documents'
);
assert.match(
  cachePolicySource,
  /ROOT_CLIENT_CACHE_CONTROL\s*=\s*['"]private, no-cache['"]/,
  'the current edition must revalidate in browsers while the edge cache remains shared'
);
assert.match(
  workerSource,
  /cacheKeyForRequest\(request\)/,
  'the versioned Daily Brief cache key must be used for edge reads and writes'
);
assert.match(
  workerSource,
  /hit\.headers\.set\(['"]Cache-Control['"], clientCacheControlForRequest\(request\)\)/,
  'Daily Brief edge hits must not leak the shared-cache TTL to browsers'
);
assert.match(
  workerSource,
  /cacheable\.headers\.set\(['"]Cache-Control['"], clientCacheControlForRequest\(request\)\)/,
  'Daily Brief edge misses must not leak the shared-cache TTL to browsers'
);
assert.match(
  cachePolicySource,
  /isPublicCachePath\(pathname\)/,
  'the cache must share the canonical public-route registry'
);
assert.doesNotMatch(
  cachePolicySource,
  /['"]\/brief['"]/,
  'the /brief compatibility redirect must remain outside the public cache policy'
);
assert.doesNotMatch(
  webPackage.scripts['cf:build'],
  /build:landing|overlay-astro-landing/,
  'the production build must not upload the retired Astro landing as the root asset'
);
assert.match(
  cachePolicySource,
  /pathname\.startsWith\(['"]\/feeds\/['"]\)/,
  'anonymous feed HTML must enter the guarded public edge cache'
);
assert.match(
  cachePolicySource,
  /FRESH_HTML_CACHE_CONTROL\s*=\s*['"]public, max-age=60, s-maxage=3600['"]/,
  'feed HTML must use the bounded shared-cache policy'
);
assert.match(
  cachePolicySource,
  /['"]\/sitemap\.xml['"]/,
  'the sitemap must retain its explicit cache policy'
);
assert.match(
  cachePolicySource,
  /['"]\/daily\/range\.json['"]/,
  'the Daily Brief range endpoint must retain its explicit cache policy'
);
assert.match(
  cachePolicySource,
  /contentType\.includes\(['"]text\/x-component['"]\)/,
  'anonymous Next.js RSC payloads must be cacheable with their complete URL key'
);
assert.doesNotMatch(
  cachePolicySource,
  /stale-while-revalidate/,
  'Cache API policies must not claim unsupported stale-while-revalidate behavior'
);
assert.match(
  workerSource,
  /handleCachedCrawlerMarkdown/,
  'bulk AI crawlers must use the cached agent-readable representation'
);

const highFanoutLinkSources = [
  'apps/web/src/components/system/PrimaryNav.tsx',
  'apps/web/src/components/system/SiteFooter.tsx',
  'apps/web/src/components/molecules/SignalCard.tsx',
  'apps/web/src/app/case-studies/CompanyUniverseList.tsx',
  'apps/web/src/app/case-studies/CompanyUniverseTable.tsx',
  'apps/web/src/app/explore/page.tsx',
];
for (const sourcePath of highFanoutLinkSources) {
  const source = readFileSync(resolve(root, sourcePath), 'utf8');
  assert.match(
    source,
    /prefetch=\{false\}/,
    `${sourcePath} must not fan out speculative RSC requests`
  );
}

for (const route of requiredAssetBypasses) {
  assert.ok(
    workerFirstRoutes.includes(route),
    `wrangler.toml must bypass Worker-first execution for ${route.slice(1)}`
  );
}

for (const route of ['/api-ai.json', '/llms.txt', '/llms-full.txt']) {
  assert.ok(
    !workerFirstRoutes.includes(`!${route}`),
    `${route} must remain Worker-first so the generated agent contract is authoritative`
  );
}

assert.match(
  historyPage,
  /export const dynamic = ['"]force-static['"];/,
  '/history must be explicitly prerendered'
);
assert.doesNotMatch(
  historyPage,
  /export const dynamic = ['"]force-dynamic['"];/,
  '/history must not force request-time rendering'
);
assert.doesNotMatch(
  historyPage,
  /being worked on|planned/i,
  '/history must not expose work-in-progress copy'
);

for (const route of ['/track-record', '/daily/history', '/markets/history', '/brief/archive']) {
  assert.ok(historyPage.includes(route), `/history must link to the live ${route} surface`);
}

console.log('Worker routing contract passed.');
