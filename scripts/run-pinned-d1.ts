import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

interface RunPinnedD1Options {
  projectRoot: string;
  flag: '--local' | '--remote';
  sqlFile: string;
  logPrefix: string;
}

export async function runPinnedD1Execute(options: RunPinnedD1Options): Promise<number> {
  const proc = spawn(
    'pnpm',
    [
      '--filter',
      '@high-signal/db',
      'exec',
      'wrangler',
      'd1',
      'execute',
      'high-signal-db',
      options.flag,
      `--file=${options.sqlFile}`,
      `--config=${resolve(options.projectRoot, 'workers/api/wrangler.toml')}`,
    ],
    { stdio: 'inherit', cwd: options.projectRoot }
  );

  return new Promise((resolveExit) => {
    proc.on('error', (error) => {
      console.error(`${options.logPrefix} failed to start pinned Wrangler: ${error.message}`);
      resolveExit(1);
    });
    proc.on('close', (code) => {
      if (code) {
        console.error(
          `${options.logPrefix} remote D1 write failed. Review the Wrangler error above; authorization failures require CLOUDFLARE_API_TOKEN to target CLOUDFLARE_ACCOUNT_ID with Account:D1:Edit.`
        );
      }
      resolveExit(code ?? 1);
    });
  });
}
