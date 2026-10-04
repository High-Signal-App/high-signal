import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sha256 = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex');

test('public art and local OFL font mirrors match recorded public hashes and contain no private paths', () => {
  const artPath = 'apps/web/public/footer-art/high-signal.webp';
  const artInfoPath = 'apps/web/public/footer-art/high-signal-provenance.json';
  const artInfo = JSON.parse(read(artInfoPath));
  assert.equal(sha256(artPath), artInfo.sha256);
  assert.equal(
    artInfo.originalSha256,
    '9cffa708973cd10362542e8b65f48693fc0be1779d00b2e05b8bb21e38323849'
  );
  assert.equal(artInfo.sha256, '073b92cd7e9d6e90a77f21c46aad762544406b606019fc4c40ecb898ae528bf2');
  assert.doesNotMatch(read(artInfoPath), /\/Users\/|generated_images|Agent Workspaces/i);

  const rootFonts = 'apps/web/public/fonts/fleet-footer-precise-v1';
  const provenance = JSON.parse(read(`${rootFonts}/provenance.json`));
  for (const font of provenance.fonts) {
    assert.equal(sha256(`${rootFonts}/${font.asset}`), font.sha256, `${font.family} hash`);
    assert.ok(read(`${rootFonts}/${font.license}`).includes('SIL OPEN FONT LICENSE'));
  }
  assert.doesNotMatch(read(`${rootFonts}/provenance.json`), /\/Users\/|Agent Workspaces/i);
});
