import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Check Next's compiled output, rather than assuming revalidate enables ISR.
const manifestPath =
  process.argv[2] ?? new URL('../.next/prerender-manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const profile = manifest.dynamicRoutes?.['/case-studies/[slug]'];

assert.ok(profile, 'Company profiles must enter the ISR cache instead of rendering per request');
assert.equal(profile.fallback, null, 'New company profiles must populate ISR on first access');
console.log('Company-profile on-demand ISR build contract passed.');
