#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerConfig = readFileSync(resolve(root, 'apps/web/wrangler.toml'), 'utf8');
const historyPage = readFileSync(
  resolve(root, 'apps/web/src/app/history/page.tsx'),
  'utf8'
);

const workerFirstMatch = wranglerConfig.match(/run_worker_first\s*=\s*\[([\s\S]*?)\]/);
assert.ok(workerFirstMatch, 'wrangler.toml must declare assets.run_worker_first');

const workerFirstRoutes = [...workerFirstMatch[1].matchAll(/"([^"]+)"/g)].map(
  ([, route]) => route
);

assert.equal(
  workerFirstRoutes[0],
  '/*',
  'application routes must remain Worker-first by default'
);
assert.ok(
  !workerFirstRoutes.includes('!/*'),
  'wrangler.toml must not bypass the Worker for all application routes'
);

const requiredAssetBypasses = [
  '!/',
  '!/_next/static/*',
  '!/_astro/*',
  '!/docs',
  '!/docs/*',
  '!/.well-known/security.txt',
  '!/api-ai.json',
  '!/llms.txt',
  '!/llms-full.txt',
  '!/apple-touch-icon.png',
  '!/favicon-32.png',
  '!/favicon.ico',
  '!/favicon.svg',
  '!/icon.svg',
];

for (const route of requiredAssetBypasses) {
  assert.ok(
    workerFirstRoutes.includes(route),
    `wrangler.toml must bypass Worker-first execution for ${route.slice(1)}`
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

console.log('Worker routing contract passed.');
