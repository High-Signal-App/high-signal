import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlDisallowsIndexing } from '../../web/agent-edge.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const list = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(resolve(dir, entry.name)) : [resolve(dir, entry.name)]
  );
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = list(resolve(dist, 'reader-artifacts'));
let profiles = 0;
const indexableProfiles = [];
const briefs = [];
for (const file of files.filter((name) => name.endsWith('.html'))) {
  const path = relative(resolve(dist, 'reader-artifacts'), file).replaceAll('\\', '/');
  const html = readFileSync(file, 'utf8');
  const profile = path.match(/^profiles\/([^/]+)\.reader\.html$/);
  const brief = path.match(/^brief\/(today|yesterday)\/([^/]+)\.html$/);
  if (!profile && !brief) throw new Error(`Unexpected reader output: ${path}`);
  const canonical = profile
    ? `https://highsignal.app/case-studies/${profile[1]}`
    : 'https://highsignal.app/';
  const indexable = !htmlDisallowsIndexing(html);
  // Profiles use the same public source projection for all three Markdown forms.
  // Only published brief HTML needs a paired artifact in the R2 snapshot.
  const markdown = brief ? readFileSync(file.replace(/\.html$/, '.md'), 'utf8') : null;
  if (
    !html.includes('<main') ||
    (brief && (!markdown?.startsWith('# ') || !markdown.includes(`Canonical: ${canonical}`)))
  )
    throw new Error(`Incomplete reader source output: ${path}`);
  if (profile && !html.includes('company-profile-v1'))
    throw new Error(`Missing completed profile: ${path}`);
  // A non-HTML extension avoids redirects inside the Static Assets binding.
  writeFileSync(profile ? file.replace(/\.html$/, '') : file.replace(/\.html$/, '.reader'), html);
  if (profile) {
    profiles++;
    if (indexable) indexableProfiles.push(profile[1]);
  } else
    briefs.push({
      day: brief[1],
      region: brief[2],
      html: { path, key: `reader/v1/${source}/${hash(html)}.html`, sha256: hash(html) },
      markdown: {
        path: path.replace(/\.html$/, '.md'),
        key: `reader/v1/${source}/${hash(markdown)}.md`,
        sha256: hash(markdown),
      },
    });
}
const inputPath = process.env.READER_BRIEF_INPUT ?? resolve(root, '.generated/brief-input.json');
let input;
try {
  if (briefs.length) input = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch {
  /* Profile-only builds need no live source. */
}
const assets = Object.fromEntries(
  list(resolve(dist, '_astro')).map((file) => [
    relative(dist, file).replaceAll('\\', '/'),
    hash(readFileSync(file)),
  ])
);
const manifest = {
  schema: 1,
  source,
  profiles,
  indexableProfiles,
  assets,
  capturedAt: input?.capturedAt ?? null,
  editionDay: input?.editionDay ?? null,
  briefs,
};
mkdirSync(dirname(resolve(dist, 'reader-manifest.json')), { recursive: true });
writeFileSync(resolve(dist, 'reader-manifest.json'), `${JSON.stringify(manifest)}\n`);
console.log(
  `Reader artifacts: ${profiles} profiles, ${briefs.length} brief variants, ${Object.keys(assets).length} assets.`
);
