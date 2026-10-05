import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedPatchPath = 'patches/http-cache-semantics@4.3.0.patch';
const expectedPatchHash = '1bde1fe699a4c0f618ade5961734d1d414333292a27feacc6780a501009c0c74';
const expectedRegressionHash = 'f06a00b4e5c1517f9ba740adf2ab322844e41b5b2eca6f80b331fd5187e832fb';
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.packageManager, 'pnpm@10.33.2');
assert.equal(manifest.pnpm?.overrides?.['http-cache-semantics'], '4.3.0');
assert.equal(
  manifest.pnpm?.patchedDependencies?.['http-cache-semantics@4.3.0'],
  expectedPatchPath,
  'the owned package patch declaration changed'
);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const patch = readFileSync(path.join(root, expectedPatchPath));
assert.equal(sha256(patch), expectedPatchHash, 'the reviewed local patch changed or is missing');
const regressionPath = path.join(root, 'scripts', 'http-cache-security.test.mjs');
const regression = readFileSync(regressionPath);
assert.equal(
  sha256(regression),
  expectedRegressionHash,
  'the reviewed consumer and negative-control cases changed'
);

const lock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const lockPatch = lock.match(
  /^\x20{2}http-cache-semantics@4\.3\.0:\n\x20{4}hash: ([a-f0-9]{64})\n\x20{4}path: patches\/http-cache-semantics@4\.3\.0\.patch$/m
);
assert.ok(lockPatch, 'the lockfile does not register the exact reviewed patch');
assert.equal(
  lockPatch[1],
  expectedPatchHash,
  'the lockfile patch hash differs from the reviewed patch'
);
assert.ok(
  lock.includes(`http-cache-semantics: 4.3.0(patch_hash=${expectedPatchHash})`),
  'the Astro dependency graph is not locked to the exact patched package'
);

const landingRequire = createRequire(
  path.join(root, 'apps', 'web', 'landing-astro', 'package.json')
);
const astroPackagePath = landingRequire.resolve('astro/package.json');
const astro = JSON.parse(readFileSync(astroPackagePath, 'utf8'));
assert.equal(
  astro.version,
  '7.2.8',
  'the tested landing consumer changed; requalify it explicitly'
);
const astroRequire = createRequire(astroPackagePath);
const cacheEntry = astroRequire.resolve('http-cache-semantics');
const cachePath = path.join(path.dirname(cacheEntry), 'package.json');
const cachePackage = JSON.parse(readFileSync(cachePath, 'utf8'));
assert.equal(cachePackage.version, '4.3.0');
assert.ok(
  cacheEntry.includes(`http-cache-semantics@4.3.0_patch_hash=${expectedPatchHash}`),
  'the landing Astro consumer did not resolve the exact patched pnpm package'
);

console.log(
  'Verified reviewed patch and regression bytes, lock hash, and landing Astro resolution; the security regression suite runs separately.'
);
