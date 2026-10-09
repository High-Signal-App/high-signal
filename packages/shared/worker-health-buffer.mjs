// Only bounded, plain telemetry values cross requests. SDK clients, fetches and
// delivery promises belong to the request which drains the buffer; no shared I/O.
export function createWorkerHealthBuffer(createClient, { delayMs = 5000, batchSize = 50 } = {}) {
  const buffers = new WeakMap();
  return {
    client(env, options) {
      let buffer = buffers.get(env);
      if (!buffer) {
        buffer = { items: [], scheduled: false };
        buffers.set(env, buffer);
      }
      const drain = async () => {
        const items = buffer.items.splice(0);
        if (!items.length) return;
        const client = createClient(options);
        for (const item of items) {
          if (item.type === 'event') client.record(item.value);
          else client.log(item.event, item.value);
        }
        await client.flush();
      };
      return {
        record(value) {
          if (buffer.items.length < batchSize * 2) {
            buffer.items.push({
              type: 'event',
              value: { ...value, timestamp: value.timestamp ?? Date.now() },
            });
          }
        },
        log(event, value) {
          if (buffer.items.length < batchSize * 2) buffer.items.push({ type: 'log', event, value });
        },
        async flush() {
          if (buffer.items.length >= batchSize) return drain();
          if (buffer.scheduled || !buffer.items.length) return;
          buffer.scheduled = true;
          // The caller attaches this promise to its own ctx.waitUntil. Partial
          // batches flush even if traffic stops; no timer without a lifetime.
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          buffer.scheduled = false;
          await drain();
        },
      };
    },
  };
}
