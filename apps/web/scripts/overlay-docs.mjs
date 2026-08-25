#!/usr/bin/env node
// Overlay the Blume docs build into the OpenNext static assets at /docs, so
// highsignal.app/docs is served as static files by the Worker's ASSETS binding
// (see wrangler.toml run_worker_first excludes for /docs/*). Mirrors the
// landing-astro overlay pattern. The canonical docs source is repo docs/;
// docs-site/ is the Blume presentation project.
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const scriptDir = import.meta.dirname; // apps/web/scripts
const repoRoot = resolve(scriptDir, '../../..'); // high-signal/
const docsSite = resolve(repoRoot, 'docs-site');
const assetsDocs = resolve(scriptDir, '..', '.open-next/assets/docs');
const sourceRefreshes = resolve(repoRoot, 'data/product-flow-refresh.jsonl');
const sourceRefreshAsset = resolve(
  scriptDir,
  '..',
  '.open-next/assets/_private/daily-source-refreshes.jsonl'
);

if (!existsSync(docsSite)) {
  console.error(`overlay-docs: docs-site not found at ${docsSite}`);
  process.exit(1);
}

execSync('npm install', { cwd: docsSite, stdio: 'inherit' });
execSync('npm run build', { cwd: docsSite, stdio: 'inherit' });

const built = resolve(docsSite, 'dist');
if (!existsSync(resolve(built, 'index.html'))) {
  console.error('overlay-docs: Blume build produced no dist/index.html');
  process.exit(1);
}

rmSync(assetsDocs, { recursive: true, force: true });
mkdirSync(assetsDocs, { recursive: true });
cpSync(built, assetsDocs, { recursive: true });
console.log(`overlay-docs: copied Blume docs -> ${assetsDocs}`);

mkdirSync(dirname(sourceRefreshAsset), { recursive: true });
copyFileSync(sourceRefreshes, sourceRefreshAsset);
console.log(`overlay-data: copied daily source history -> ${sourceRefreshAsset}`);
