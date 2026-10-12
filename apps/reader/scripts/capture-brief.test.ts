import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { captureBrief } from './capture-brief';
const { REGIONS, istDay, classifyUserAgent } = createRequire(import.meta.url)(
  '@high-signal/shared'
) as typeof import('@high-signal/shared');

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const now = new Date();
  try {
    // A challenge must produce the same truthful unavailable edition as Next,
    // without reading protected history through the dates fallback.
    globalThis.fetch = async (input, init) => {
      calls.push(new URL(String(input)));
      assert.equal(
        classifyUserAgent(new Headers(init?.headers).get('User-Agent') ?? ''),
        'automation'
      );
      return new Response('protected history', { status: 403 });
    };
    const captured = await captureBrief('https://reader-source.test', now);
    assert.equal(captured.entries.length, REGIONS.length * 2);
    assert.equal(calls.length, REGIONS.length * 2);
    assert.ok(calls.every((url) => url.pathname === '/brief/daily'));
    assert.equal(calls.filter((url) => !url.searchParams.has('date')).length, REGIONS.length);
    assert.equal(
      calls.filter((url) => url.searchParams.get('date') === istDay(now, -1)).length,
      REGIONS.length
    );
    const pairs = captured.entries.map(({ day, brief }) => {
      assert.equal(brief.editionDate, istDay(now, day === 'yesterday' ? -1 : 0));
      assert.equal(brief.publishStatus, 'pending');
      assert.deepEqual(brief.news, []);
      assert.equal(brief.categoryStates?.stocks.status, 'unavailable');
      return `${day}/${brief.region}`;
    });
    assert.equal(new Set(pairs).size, 20);
    for (const region of REGIONS) {
      assert.ok(pairs.includes(`today/${region}`));
      assert.ok(pairs.includes(`yesterday/${region}`));
    }
    const output = process.argv[2];
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(captured));
    }
    console.log('Reader capture: all public variants preserve the history challenge boundary.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
