import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createReaderRuntime, seedReaderBrief } from './reader-runtime.mjs';

const mf = await createReaderRuntime();
if (process.argv[2]) await seedReaderBrief(mf, resolve(process.argv[2]));
const server = createServer(async (request, response) => {
  try {
    const result = await mf.dispatchFetch(new URL(request.url, 'https://highsignal.app').href, {
      method: request.method,
      headers: request.headers,
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500);
    response.end(error.message);
  }
});
server.listen(8899, '127.0.0.1', () => console.log('Reader preview: http://127.0.0.1:8899'));
async function stop() {
  server.close();
  await mf.dispose();
  process.exit();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
