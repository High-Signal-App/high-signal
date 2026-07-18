#!/usr/bin/env node
// docs-check.mjs — broken-internal-link + sanity checker for the docs knowledge base.
//
// Scans committed Markdown for internal links/images and verifies the target
// file exists. External (http/https/mailto) links and intra-page anchors are
// not fetched. Reports broken links with file + line and exits non-zero on any
// failure. Intentionally dependency-free (Node 22 built-ins only) so it runs
// fast in CI without an install step beyond the repo.
//
// Run: pnpm docs:check    (or: node scripts/docs-check.mjs)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Directories we never scan or resolve into.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.open-next',
  '.wrangler',
  '.cf-pages-bundle',
  'dist',
  'out',
  'build',
  '.turbo',
  '.tmp',
  'coverage',
  'playwright-report',
  'test-results',
  '.vercel',
  '.pytest_cache',
  '.ruff_cache',
  // Local agent-tooling runtime artifacts (git-ignored, not product code).
  '.commandcode',
  '.omx',
  '.symphony',
  '.clawpatch',
  '.codex',
]);

const MD_EXT = new Set(['.md', '.mdx']);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && MD_EXT.has(extname(e.name))) out.push(p);
  }
}

// Collect every markdown file under root so link targets resolve anywhere in-repo.
const allMd = [];
walk(ROOT, allMd);
const rootSet = new Set(allMd.map((p) => relative(ROOT, p)));

// Markdown link/image regex. Matches [text](url) and ![](url) and reference-style
// is intentionally skipped (rare in this repo). Captures the URL only.
const LINK_RE = /(?:!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))/g;

// Files we actually audit: docs/ + root agent/status/spec/readme files.
function isAudited(p) {
  const rel = relative(ROOT, p);
  if (rel.startsWith('docs/')) return true;
  // Root-level operating docs that agents read first.
  return (
    rel === 'agents.md' ||
    rel === 'STATUS.md' ||
    rel === 'PROJECT_STATUS.md' ||
    rel === 'README.md' ||
    rel === 'SPEC.md' ||
    rel === 'CLAUDE.md'
  );
}

const audited = allMd.filter(isAudited);

let broken = 0;
const errors = [];

function stripAnchor(url) {
  const i = url.indexOf('#');
  return i === -1
    ? { path: url, anchor: null }
    : { path: url.slice(0, i), anchor: url.slice(i + 1) };
}

function checkFile(auditedPath, rawUrl, lineNo) {
  // Skip external and non-path schemes.
  if (/^(https?:|mailto:|tel:|ftp:|data:|javascript:)/i.test(rawUrl)) return;
  // Skip bare anchors (intra-page).
  if (rawUrl.startsWith('#')) return;

  const { path: urlPath } = stripAnchor(rawUrl);
  if (!urlPath) return; // pure anchor, already handled

  // Decode percent-encoding for filesystem lookup.
  const decoded = decodeURIComponent(urlPath);

  // Resolve relative to the audited file's directory.
  const abs = normalize(join(dirname(auditedPath), decoded));
  const rel = relative(ROOT, abs);

  if (!existsSync(abs)) {
    errors.push(
      `${relative(ROOT, auditedPath)}:${lineNo}: broken link -> ${rawUrl} (resolved: ${rel || rel})`
    );
    broken++;
  }
}

for (const file of audited) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(`could not read ${relative(ROOT, file)}: ${e.message}`);
    broken++;
    continue;
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(lines[i])) !== null) {
      checkFile(file, m[2], i + 1);
    }
  }
}

// Sanity check: every directory under docs/ must contain at least one .md file
// (no empty placeholder folders).
function findEmptyDirs(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const subdirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
  const hasMd = entries.some((e) => e.isFile() && MD_EXT.has(extname(e.name)));
  if (!hasMd && subdirs.length === 0 && dir !== join(ROOT, 'docs')) {
    acc.push(relative(ROOT, dir));
  }
  for (const s of subdirs) findEmptyDirs(join(dir, s.name), acc);
}

const emptyDirs = [];
findEmptyDirs(join(ROOT, 'docs'), emptyDirs);
for (const d of emptyDirs) {
  errors.push(`empty docs directory with no markdown: ${d}`);
  broken++;
}

if (errors.length) {
  console.error(`\n docs-check: ${broken} problem(s) found\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  process.exit(1);
}

console.log(
  `docs-check: OK — ${audited.length} file(s) audited, no broken internal links, no empty docs dirs.`
);
