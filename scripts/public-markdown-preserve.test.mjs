import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../apps/web/package.json', import.meta.url))('typescript');
const registry = readFileSync('apps/web/src/lib/public-source-pages.ts', 'utf8');
const files = [
  ...new Set(
    [...registry.matchAll(/from ['"]@\/app\/(.*?)['"]/g)].map(
      (match) => `apps/web/src/app/${match[1]}.tsx`
    )
  ),
];
function defaultBody(source, filename) {
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const declaration = parsed.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  );
  assert.ok(declaration?.body, `Default page component body is inspectable: ${filename}`);
  const nodes = [];
  function visit(node) {
    nodes.push([
      node.kind,
      ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
        ? node.text
        : null,
    ]);
    ts.forEachChild(node, visit);
  }
  visit(declaration.body);
  return nodes;
}
for (const filename of files) {
  const original = execFileSync('git', ['show', `HEAD:${filename}`], { encoding: 'utf8' });
  const current = readFileSync(filename, 'utf8');
  assert.deepEqual(
    defaultBody(current, filename),
    defaultBody(original, filename),
    `Public HTML component behavior changed: ${filename}`
  );
}
const layout = 'apps/reader/src/layouts/ReaderLayout.astro';
const original = execFileSync('git', ['show', `HEAD:${layout}`], { encoding: 'utf8' });
assert.equal(
  readFileSync(layout, 'utf8').match(/<body[\s\S]*<\/body>/)?.[0],
  original.match(/<body[\s\S]*<\/body>/)?.[0]
);
const copy = readFileSync('apps/web/src/components/history/history-gate-copy.ts', 'utf8');
for (const phrase of [
  'protected history',
  'verify to read earlier signals',
  'Today and yesterday stay open and fast. A quick human check unlocks older briefs and their signal proof pages for 12 hours.',
  'one check · 12 hours of access',
])
  assert.ok(copy.includes(phrase));
console.log(
  `HTML behavior preserved in ${files.length} page component bodies and reader layout; public history copy unchanged.`
);
