import assert from 'node:assert/strict';
import { createPing } from '../src/lib/ping';

const originalFetch = globalThis.fetch;

let resolveDelivery!: (response: Response) => void;
let deliveryStarted!: () => void;
const started = new Promise<void>((resolve) => {
  deliveryStarted = resolve;
});
globalThis.fetch = (async () => {
  deliveryStarted();
  return new Promise<Response>((resolve) => {
    resolveDelivery = resolve;
  });
}) as typeof fetch;

async function main(): Promise<void> {
  try {
    const ping = createPing({ key: 'test-key', endpoint: 'https://ingest.example/v1/ingest' });
    let settled = false;
    const result = ping.info('history.unlocked').then((value) => {
      settled = true;
      return value;
    });
    await started;
    assert.equal(settled, false, 'ping must remain pending until its delivery resolves');
    resolveDelivery(new Response(null, { status: 202 }));
    assert.equal(await result, true);

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    assert.equal(await createPing()('history.unlocked'), false);
    assert.equal(called, false, 'missing key must be a silent no-op');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main()
  .then(() => console.log('ping lifetime tests passed'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
