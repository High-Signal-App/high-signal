#!/usr/bin/env node

// Populates the OpenNext R2 incremental cache through the Cloudflare R2 REST
// API, so CI can use the R2-scoped token here and the Workers-scoped token for
// `wrangler deploy`. `opennextjs-cloudflare deploy` populates through a
// temporary remote-preview Worker, which needs one token with both Workers
// Scripts edit and R2 access; no deploy token has both.
//
// Mirrors @opennextjs/cloudflare's getCacheAssets + computeCacheKey so keys
// match what the r2-incremental-cache override reads at runtime.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCacheKey } from '@opennextjs/cloudflare/overrides/internal';

const BUCKET = 'high-signal-web-inc-cache';
const CONCURRENCY = 8;
const ATTEMPTS = 5;

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = resolve(webRoot, '.open-next/cache');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const prefix = process.env.NEXT_INC_CACHE_R2_PREFIX || undefined;

if (!(accountId && apiToken)) {
  throw new Error('populate-r2-cache: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function toEntry(fullPath) {
  const rel = relative(cacheDir, fullPath).split(sep).join('/');
  if (rel.startsWith('__fetch')) {
    const [, buildId, ...keyParts] = rel.split('/');
    if (!buildId || keyParts.length === 0) {
      throw new Error(`populate-r2-cache: invalid fetch cache path ${rel}`);
    }
    return {
      fullPath,
      key: computeCacheKey(`/${keyParts.join('/')}`, { prefix, buildId, cacheType: 'fetch' }),
    };
  }
  const [buildId, ...keyParts] = rel.slice(0, -'.cache'.length).split('/');
  if (!rel.endsWith('.cache') || !buildId || keyParts.length === 0) {
    throw new Error(`populate-r2-cache: invalid cache path ${rel}`);
  }
  return {
    fullPath,
    key: computeCacheKey(`/${keyParts.join('/')}`, { prefix, buildId, cacheType: 'cache' }),
  };
}

async function put({ fullPath, key }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${key}`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: readFileSync(fullPath),
      signal: AbortSignal.timeout(120_000),
    }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }));
    if (response.ok) {
      return;
    }
    const retryable = response.status === 0 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === ATTEMPTS) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(`populate-r2-cache: PUT ${key} failed (${response.status}): ${body}`);
    }
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
  }
}

const entries = listFiles(cacheDir).map(toEntry);
let next = 0;
async function worker() {
  while (next < entries.length) {
    const entry = entries[next++];
    await put(entry);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
console.log(`populate-r2-cache: wrote ${entries.length} entries to r2://${BUCKET}`);
