import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { require as tsxRequire } from 'tsx/cjs/api';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.React = React;
const { default: ArticlesPage } = tsxRequire('../src/app/articles/page.tsx', import.meta.url);
const { ARTICLES } = tsxRequire('../src/data/articles.ts', import.meta.url);
const { INTELLIGENCE_GUIDE_LINKS, INTELLIGENCE_GUIDES } = tsxRequire(
  '../src/data/intelligence-guides.ts',
  import.meta.url
);
const html = renderToStaticMarkup(createElement(ArticlesPage));
const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

for (const entry of [
  ...ARTICLES.map((article) => ({ href: article.path })),
  ...INTELLIGENCE_GUIDE_LINKS,
]) {
  const matching = links.filter((link) => link[1] === entry.href);
  assert.equal(matching.length, 1, `${entry.href} must have one crawlable server-rendered anchor`);
  assert.ok(matching[0][2].replace(/<[^>]*>/g, '').trim().length > 0);
}
assert.equal(INTELLIGENCE_GUIDE_LINKS.length, 5);
assert.equal(ARTICLES.length, 11);
assert.equal(links.length, ARTICLES.length + INTELLIGENCE_GUIDE_LINKS.length + 1);
for (const guide of Object.values(INTELLIGENCE_GUIDES)) {
  const anchor = links.find((link) => link[1] === guide.slug);
  const description = renderToStaticMarkup(createElement('span', null, guide.metaDescription));
  assert.ok(anchor[2].includes(description.slice('<span>'.length, -'</span>'.length)));
}
console.log('Article hub renders all 11 articles and 5 guides as crawlable anchors');
