import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as recordView from '../src/lib/retained-record.ts';
import { SITE_NAME, SITE_URL } from '../src/lib/site.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = ts.transpileModule(
  readFileSync(resolve(root, 'src/components/data/RecordContent.tsx'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }
);
const component = {};
new Function('require', 'exports', source.outputText)((name) => {
  if (name === 'react/jsx-runtime') return require(name);
  assert.equal(name, '@/lib/retained-record');
  return recordView;
}, component);

/** Compare the actual shared component with the actual compiled Worker response. */
export function assertRecordHtmlContract(actual, record, id, missing = false) {
  const expected = renderToStaticMarkup(
    createElement(component.RecordContent, { record, missing })
  );
  const [left, right] = JSON.parse(
    execFileSync('python3', [resolve(root, 'scripts/record_html_contract.py')], {
      input: JSON.stringify([expected, actual]),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  );
  assert.deepEqual(right.main, left.main, `complete shared record markup: ${id}`);
  const metadata = recordView.recordMetadata(record, id);
  const title = `${metadata.title} — ${SITE_NAME}`;
  assert.equal(right.title, title, id);
  assert.equal(right.canonical, `${SITE_URL}/data/records/${encodeURIComponent(id)}`, id);
  for (const name of ['description', 'ai-summary', 'og:description', 'twitter:description'])
    assert.equal(right.meta[name], metadata.description, name);
  for (const name of ['og:title', 'twitter:title']) assert.equal(right.meta[name], title, name);
  assert.deepEqual(right.unsafeScripts, []);
  assert.deepEqual(right.unsafeUrls, []);
}
