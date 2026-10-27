import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE_URL, SITE_IDENTITY } from '../src/lib/site.ts';
import { absoluteMarkdownLinks } from '../agent-surfaces/format.mjs';
const root = resolve(import.meta.dirname, '../../..');
const assets = resolve(root, 'apps/web/.open-next/assets');
const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const decode = (value) =>
  value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'))?.[2];
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]
  );
}
export function finalizePublicDocs() {
  const published = JSON.parse(
    readFileSync(resolve(root, 'docs-site/.blume/src/generated/data.json'), 'utf8')
  ).routes;
  const routes = [];
  const documents = [];
  for (const file of walk(resolve(assets, 'docs')).filter((file) => file.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) ?? [];
    const meta = (name) =>
      attr(tags.find((tag) => attr(tag, 'name') === name) ?? '', 'content') ?? '';
    if (/noindex/i.test(meta('robots')) || /(?:^|\/)404(?:\/index)?\.html$/.test(file)) continue;
    const declared = attr(tags.find((tag) => attr(tag, 'rel') === 'canonical') ?? '', 'href');
    if (!declared) throw new Error(`Published docs missing canonical: ${relative(assets, file)}`);
    const url = new URL(declared, SITE_URL);
    if (url.origin !== SITE_URL || !url.pathname.startsWith('/docs'))
      throw new Error('Unexpected docs canonical');
    const rel = relative(resolve(assets, 'docs'), file);
    const routePath = url.pathname.replace(/^\/docs/, '').replace(/\/$/, '') || '/';
    const record = published.find(
      (record) => record.path === routePath && record.indexable && !record.draft
    );
    const sourceFile = record?.entryId ? resolve(root, 'docs', record.entryId) : null;
    if (
      !sourceFile ||
      !sourceFile.startsWith(resolve(root, 'docs') + '/') ||
      !existsSync(sourceFile)
    )
      throw new Error(`Published docs lack authored source: ${rel}`);
    if (/(?:^|\/)(?:archive|prds|openspec)\//.test(relative(resolve(root, 'docs'), sourceFile)))
      continue;
    const source = readFileSync(sourceFile, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const title =
      source.match(/^#\s+(.+)$/m)?.[1] ??
      decode(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? 'High Signal documentation');
    const description = decode(meta('description')) || title;
    const md = url.pathname.replace(/\/$/, '') + '.md';
    const route = {
      path: url.pathname,
      url: url.href,
      md: SITE_URL + md,
      assetPath: md,
      title,
      description,
      kind: 'docs',
    };
    routes.push(route);
    documents.push({ file, html, sourceFile, source, route });
  }
  const sourceUrls = new Map(documents.map((doc) => [doc.sourceFile, doc.route.url]));
  for (const doc of documents) {
    const body = absoluteMarkdownLinks(
      doc.source.replace(/^#\s+[^\n]+\n*/, '').trim(),
      doc.route.url,
      {
        resolveLink(href) {
          if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return undefined;
          const local = new URL(href, pathToFileURL(doc.sourceFile));
          const target = fileURLToPath(local);
          if (sourceUrls.has(target)) return sourceUrls.get(target) + local.search + local.hash;
          if (existsSync(target) && target.startsWith(root + '/'))
            return (
              `https://github.com/High-Signal-App/high-signal/blob/main/${relative(root, target)}` +
              local.hash
            );
          return undefined;
        },
      }
    );
    const output = resolve(assets, '.' + doc.route.assetPath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      `# ${doc.route.title}\n\n> ${doc.route.description}\n\nCanonical: ${doc.route.url}\n\n${body}\n`
    );
    const head = `<meta name="ai-summary" content="${escape(doc.route.description)}"><link rel="alternate" type="text/markdown" href="${escape(doc.route.md)}">`;
    writeFileSync(
      doc.file,
      doc.html
        .replace(/<meta\b[^>]*name=["']ai-summary["'][^>]*>/gi, '')
        .replace(/<link\b[^>]*type=["']text\/markdown["'][^>]*>/gi, '')
        .replace('</head>', head + '</head>')
    );
  }
  mkdirSync(resolve(assets, 'api/md'), { recursive: true });
  writeFileSync(resolve(assets, 'api/md/_docs'), JSON.stringify(routes));
  writeFileSync(resolve(assets, 'api/md/_identity'), JSON.stringify(SITE_IDENTITY));
  console.log(`Registered ${routes.length} source-derived public docs pages.`);
  return routes;
}
