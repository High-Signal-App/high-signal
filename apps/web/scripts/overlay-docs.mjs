#!/usr/bin/env node
// Overlay the Blume docs build into the OpenNext static assets at /docs, so
// highsignal.app/docs is served as static files by the Worker's ASSETS binding
// (see wrangler.toml run_worker_first excludes for /docs/*). Mirrors the
// landing-astro overlay pattern. The canonical docs source is repo docs/;
// docs-site/ is the Blume presentation project.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const scriptDir = import.meta.dirname; // apps/web/scripts
const repoRoot = resolve(scriptDir, '../../..'); // high-signal/
const docsSite = resolve(repoRoot, 'docs-site');
const assetsDocs = resolve(scriptDir, '..', '.open-next/assets/docs');

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
