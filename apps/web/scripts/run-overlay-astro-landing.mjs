#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runOverlay } from './overlay-astro-landing.mjs';

await runOverlay({
  astroDist: 'landing-astro/dist',
  assets: '.open-next/assets',
  strict: process.argv.includes('--strict'),
});

const sourceRefreshes = new URL('../../../data/product-flow-refresh.jsonl', import.meta.url);
const sourceRefreshAsset = resolve('.open-next/assets/_private/daily-source-refreshes.jsonl');
await mkdir(dirname(sourceRefreshAsset), { recursive: true });
await copyFile(sourceRefreshes, sourceRefreshAsset);
console.log(`[overlay-data] copied daily source history → ${sourceRefreshAsset}`);
