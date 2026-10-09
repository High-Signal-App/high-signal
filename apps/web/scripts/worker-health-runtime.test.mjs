import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Miniflare } = createRequire(require.resolve('wrangler'))('miniflare');
const bufferSource = readFileSync(
  new URL('../../../packages/shared/worker-health-buffer.mjs', import.meta.url),
  'utf8'
);
const batches = [];
const mf = new Miniflare({
  modules: true,
  compatibilityDate: '2026-04-25',
  script:
    bufferSource +
    `
    const createClient=()=>{const events=[];return {record(e){events.push(e)},log(){},async flush(){await fetch('https://ingest.test/v1/ingest',{method:'POST',body:JSON.stringify(events)});}};};
    const buffered=createWorkerHealthBuffer(createClient,{delayMs:500,batchSize:50});
    export default {fetch(request,env,ctx){const client=buffered.client(env,{});client.record({method:'GET',route:'/example/:id',status_code:200,duration_ms:1});ctx.waitUntil(client.flush());return new Response('ok');}};
  `,
  outboundService: async (request) => {
    batches.push(await request.json());
    return new Response(null, { status: 202 });
  },
});
try {
  const responses = await Promise.all(
    Array.from({ length: 200 }, () => mf.dispatchFetch('https://worker.test/example'))
  );
  assert.ok(responses.every((r) => r.status === 200));
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(
    batches.flat().length,
    200,
    'Workers runtime must preserve every event across contexts'
  );
  assert.equal(batches.length, 4, 'Workers runtime must send four 50-event batches');
  await mf.dispatchFetch('https://worker.test/example');
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(batches.flat().length, 201, 'one final event flushes without subsequent traffic');
  assert.equal(batches.length, 5);
  console.log('Workers runtime: 200 requests -> 4 batches; isolated final event delivered.');
} finally {
  await mf.dispose();
}
