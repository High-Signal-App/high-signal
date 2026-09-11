#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(
  process.env.CACHE_BUILD_WEB_ROOT ?? fileURLToPath(new URL('..', import.meta.url))
);
const buildIdPath = resolve(webRoot, '.open-next/assets/BUILD_ID');
const generatedPath = resolve(webRoot, '.open-next/cache-build-id.mjs');

let buildId;
try {
  buildId = readFileSync(buildIdPath, 'utf8').trim();
} catch (error) {
  throw new Error(`cache build namespace: cannot read ${buildIdPath}`, { cause: error });
}

if (!/^[A-Za-z0-9._-]{1,128}$/.test(buildId)) {
  throw new Error(`cache build namespace: malformed BUILD_ID in ${buildIdPath}`);
}

writeFileSync(generatedPath, `export const CACHE_BUILD_ID = ${JSON.stringify(buildId)};\n`);
console.log(`cache build namespace: wrote ${generatedPath}`);
