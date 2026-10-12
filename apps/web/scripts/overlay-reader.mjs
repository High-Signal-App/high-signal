import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(webRoot, '../reader/dist');
const target = resolve(webRoot, '.open-next/assets');
const manifest = JSON.parse(readFileSync(resolve(dist, 'reader-manifest.json'), 'utf8'));
if (manifest.schema !== 1 || manifest.profiles < 1)
  throw new Error('The reader build must contain completed profiles');
mkdirSync(resolve(target, '_private'), { recursive: true });
cpSync(resolve(dist, 'reader-artifacts'), resolve(target, '_private/reader'), { recursive: true });
cpSync(resolve(dist, '_astro'), resolve(target, '_astro'), { recursive: true });
// Brief HTML is protected by the request's current date, never a root static asset.
writeFileSync(
  resolve(webRoot, '.open-next/reader-build.mjs'),
  `export const READER_BUILD = ${JSON.stringify({
    schema: 1,
    source: manifest.source,
    profiles: manifest.profiles,
    indexableProfiles: manifest.indexableProfiles,
    assets: manifest.assets,
  })};\n`
);
console.log(`Packaged ${manifest.profiles} reader profiles; no public brief root asset.`);
