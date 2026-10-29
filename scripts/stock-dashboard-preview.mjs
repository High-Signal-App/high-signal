import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { file: { type: 'string' }, port: { type: 'string', default: '4317' } },
});
if (!values.file || !/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535)
  throw new Error('Usage: pnpm stock:preview --file .fleet-local/stock-preview.json [--port 4317]');
const input = realpathSync(values.file);
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    '--turbopack',
    '--hostname',
    '127.0.0.1',
    '--port',
    values.port,
  ],
  {
    cwd: fileURLToPath(new URL('../apps/web', import.meta.url)),
    stdio: 'inherit',
    env: {
      ...process.env,
      NSE_DASHBOARD_PREVIEW_FILE: input,
      NSE_DASHBOARD_PREVIEW_BINDING: '127.0.0.1',
    },
  }
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
