import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshReaderManifest, READER_MANIFEST_KEY } from '../../web/reader-artifacts.mjs';

const hash = (body) => createHash('sha256').update(body).digest('hex');
function publicationBodies(directory, objects, editionDay) {
  const yesterday = new Date(Date.parse(`${editionDay}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  let bytes = 0;
  return objects.map((file) => {
    const body = readFileSync(resolve(directory, 'reader-artifacts', file.path));
    bytes += body.length;
    if (bytes > 8 * 1024 * 1024) throw new Error('Reader publication exceeds its storage bound');
    if (hash(body) !== file.sha256) throw new Error('Reader artifact checksum mismatch');
    const date = body.toString().match(/data-edition-date="([0-9-]+)"/)?.[1];
    if (
      !body.includes('data-high-signal-reader="brief-v1"') ||
      ![editionDay, yesterday].includes(date)
    )
      throw new Error('Reader artifact lacks a complete public edition');
    return { ...file, body };
  });
}
export function validatePublication(manifest, deployed, now = Date.now()) {
  if (!freshReaderManifest(manifest, deployed.source, now) || manifest.briefs.length !== 20)
    throw new Error('Reader publication is incomplete, expired or from a different source');
  if (!/^[a-f0-9]{40}$/.test(manifest.source)) throw new Error('Invalid publication source');
  for (const [path, digest] of Object.entries(manifest.assets)) {
    if (deployed.assets?.[path] !== digest)
      throw new Error(`Reader asset is not deployed: ${path}`);
  }
  const pairs = new Set();
  const regions = new Set();
  for (const entry of manifest.briefs) {
    const pair = `${entry.day}/${entry.region}`;
    if (pairs.has(pair)) throw new Error('Duplicate reader variant');
    pairs.add(pair);
    regions.add(entry.region);
    for (const [format, extension] of [
      ['html', 'html'],
      ['markdown', 'md'],
    ]) {
      const file = entry[format];
      if (
        file?.path !== `brief/${entry.day}/${entry.region}.${extension}` ||
        !/^[a-z-]+$/.test(entry.region) ||
        !/^[a-f0-9]{64}$/.test(file?.sha256 ?? '') ||
        file.key !== `reader/v1/${manifest.source}/${file.sha256}.${extension}`
      )
        throw new Error('Invalid reader object path');
    }
  }
  if (
    regions.size !== 10 ||
    !regions.has('global') ||
    [...regions].some(
      (region) => !pairs.has(`today/${region}`) || !pairs.has(`yesterday/${region}`)
    )
  )
    throw new Error('Reader publication must include both days for every region');
}

export async function publishArtifacts({
  directory,
  deployed,
  put,
  recheck,
  getCurrent = async () => null,
  now = Date.now,
}) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'reader-manifest.json'), 'utf8'));
  validatePublication(manifest, deployed, now());
  const current = await getCurrent();
  if (
    freshReaderManifest(current, manifest.source, now()) &&
    current.briefs.length === 20 &&
    [0, 1].includes(current.slot) &&
    now() - Date.parse(current.capturedAt) < 120_000
  )
    return 0;
  const slot = current?.slot === 0 ? 1 : 0;
  const briefs = manifest.briefs.map(({ day, region, html }) => ({
    day,
    region,
    html: { ...html, key: `reader/v1/slots/${slot}/${day}/${region}.html` },
  }));
  // Two slots bound storage across refreshes and renderer releases. Only HTML
  // is published; root Markdown remains the existing agent catalog.
  const objects = publicationBodies(
    directory,
    briefs.map((entry) => entry.html),
    manifest.editionDay
  );
  let index = 0;
  async function upload() {
    while (index < objects.length) {
      const file = objects[index++];
      await put(file.key, file.body);
    }
  }
  await Promise.all(Array.from({ length: 4 }, upload));
  // A renderer deploy during upload must not promote incompatible HTML.
  validatePublication(manifest, await recheck(), now());
  if (JSON.stringify(await getCurrent()) !== JSON.stringify(current))
    throw new Error('Another reader publication changed the current pointer');
  const pointer = {
    schema: 1,
    source: manifest.source,
    slot,
    capturedAt: manifest.capturedAt,
    editionDay: manifest.editionDay,
    briefs,
  };
  await put(READER_MANIFEST_KEY, Buffer.from(JSON.stringify(pointer)));
  return objects.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const webBuild = async () => {
    const response = await fetch('https://highsignal.app/api/reader-build', {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Reader build lookup returned ${response.status}`);
    return response.json();
  };
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Existing R2 publication credentials are required');
  const directory = fileURLToPath(new URL('../dist/', import.meta.url));
  const objectUrl = (key) =>
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/high-signal-web-inc-cache/objects/${key}`;
  const count = await publishArtifacts({
    directory,
    deployed: await webBuild(),
    recheck: webBuild,
    getCurrent: async () => {
      const response = await fetch(objectUrl(READER_MANIFEST_KEY), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Reader pointer lookup returned ${response.status}`);
      return response.json();
    },
    put: async (key, body) => {
      const response = await fetch(objectUrl(key), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Reader object upload returned ${response.status}`);
    },
  });
  console.log(
    count
      ? `Published ${count} reader variants in a bounded slot, then the current pointer.`
      : 'Skipped a duplicate reader refresh within two minutes.'
  );
}
