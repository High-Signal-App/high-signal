import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumer = 'apps/web/landing-astro';
const consumerRequire = createRequire(path.join(root, consumer, 'package.json'));
const astroRequire = createRequire(consumerRequire.resolve('astro/package.json'));
const CachePolicy = astroRequire('http-cache-semantics');
const request = {
  url: 'https://cache-fixture.invalid/image',
  method: 'GET',
  headers: { host: 'cache-fixture.invalid' },
};
const cookie = { 'set-cookie': 'fictional-fixture=synthetic' };
const scenarios = [
  ['shared cookie without explicit opt-in', 'max-age=0', cookie, true, 1, false],
  [
    'shared cookie with stale-while-revalidate',
    'max-age=0, stale-while-revalidate=600',
    cookie,
    true,
    1,
    false,
  ],
  ['shared proxy revalidation', 'max-age=60, proxy-revalidate', {}, true, 61, false],
  ['response requires revalidation', 'no-cache', {}, true, 1, false],
  ['response cannot be stored', 'no-store', {}, true, 1, false],
  ['private response in shared cache', 'private, max-age=60', {}, true, 61, false],
  ['ordinary expired response', 'max-age=0', {}, true, 1, true],
  ['ordinary fresh response', 'max-age=60', {}, true, 1, true],
  ['explicitly public cookie', 'public, max-age=0', cookie, true, 1, true],
  ['explicitly immutable cookie', 'immutable, max-age=0', cookie, true, 1, true],
  ['cookie in private cache', 'max-age=0', cookie, false, 1, true],
  ['proxy directive in private cache', 'max-age=0, proxy-revalidate', {}, false, 1, true],
  ['must-revalidate remains enforced', 'max-age=0, must-revalidate', {}, true, 1, false],
];

for (const [name, cacheControl, extraHeaders, shared, age, expected] of scenarios) {
  for (const serialized of [false, true]) {
    test(`${consumer}: ${name}${serialized ? ' after serialization' : ''}`, () => {
      let policy = new CachePolicy(
        request,
        {
          status: 200,
          headers: { 'cache-control': cacheControl, ...extraHeaders },
        },
        { shared }
      );
      if (serialized) policy = CachePolicy.fromObject(policy.toObject());
      policy.now = () => policy._responseTime + age * 1000;
      const next = {
        ...request,
        headers: { ...request.headers, 'cache-control': 'max-stale=99999' },
      };
      assert.equal(policy.satisfiesWithoutRevalidation(next), expected);
      assert.equal(Boolean(policy.evaluateRequest(next).response), expected);
    });
  }
}

test(`${consumer}: max-stale still respects its age bound and request identity`, () => {
  const policy = new CachePolicy(request, {
    headers: { 'cache-control': 'max-age=10' },
  });
  policy.now = () => policy._responseTime + 15_000;
  assert.equal(
    policy.satisfiesWithoutRevalidation({
      ...request,
      headers: { ...request.headers, 'cache-control': 'max-stale=4' },
    }),
    false
  );
  assert.equal(
    policy.satisfiesWithoutRevalidation({
      ...request,
      headers: { ...request.headers, 'cache-control': 'max-stale=6' },
    }),
    true
  );
  assert.equal(
    policy.satisfiesWithoutRevalidation({
      ...request,
      url: 'https://cache-fixture.invalid/other',
      headers: { ...request.headers, 'cache-control': 'max-stale=99999' },
    }),
    false
  );
});

test(`${consumer}: in-memory unpatched 4.3.0 negative control reproduces protected max-stale hits`, () => {
  const source = readFileSync(astroRequire.resolve('http-cache-semantics'), 'utf8');
  const patchedGuard = `if (
            this._rescc['must-revalidate'] ||
            !this.storable() ||
            this._rescc['no-cache'] ||
            (this._isShared && (
                this._rescc['proxy-revalidate'] ||
                (this._resHeaders['set-cookie'] &&
                    !this._rescc.public && !this._rescc.immutable)
            ))
        ) {`;
  const originalGuard = "if (this._rescc['must-revalidate']) {";
  assert.ok(source.includes(patchedGuard), 'candidate does not contain exact reviewed patch guard');
  const unpatchedSource = source.replace(patchedGuard, originalGuard);
  const candidateModule = { exports: {} };
  runInNewContext(
    unpatchedSource,
    { module: candidateModule, exports: candidateModule.exports },
    { filename: astroRequire.resolve('http-cache-semantics') }
  );
  const UnpatchedCachePolicy = candidateModule.exports;
  const protectedNames = new Set([
    'shared cookie without explicit opt-in',
    'shared cookie with stale-while-revalidate',
    'shared proxy revalidation',
    'response requires revalidation',
    'response cannot be stored',
    'private response in shared cache',
  ]);
  const protectedScenarios = scenarios.filter(([name]) => protectedNames.has(name));
  assert.equal(protectedScenarios.length, 6);
  for (const [name, cacheControl, extraHeaders, shared, age, expected] of protectedScenarios) {
    assert.equal(expected, false, name);
    for (const serialized of [false, true]) {
      let policy = new UnpatchedCachePolicy(
        request,
        { status: 200, headers: { 'cache-control': cacheControl, ...extraHeaders } },
        { shared }
      );
      if (serialized) policy = UnpatchedCachePolicy.fromObject(policy.toObject());
      policy.now = () => policy._responseTime + age * 1000;
      const next = {
        ...request,
        headers: { ...request.headers, 'cache-control': 'max-stale=99999' },
      };
      assert.equal(
        policy.satisfiesWithoutRevalidation(next),
        true,
        `${name} baseline did not reproduce`
      );
      assert.equal(
        Boolean(policy.evaluateRequest(next).response),
        true,
        `${name} baseline result did not reproduce`
      );
    }
  }
});
