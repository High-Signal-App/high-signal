#!/usr/bin/env tsx

import { DATA_PARITY_REFERENCES } from '@high-signal/shared';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const catalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'apps/web/src/lib/source-catalog.json'), 'utf8')
) as { sources: Array<{ id: string }> };
const sourceIds = new Set(catalog.sources.map((source) => source.id));

assert.equal(DATA_PARITY_REFERENCES.length, 7, 'the approved reference set stays bounded');

let assertions = 1;
for (const reference of DATA_PARITY_REFERENCES) {
  assert.match(reference.officialUrl, /^https:\/\//, `${reference.name} needs an official URL`);
  assert.match(reference.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `${reference.name} needs a date`);
  assert.ok(reference.capabilities.length > 0, `${reference.name} needs a capability`);
  assertions += 3;

  for (const capability of reference.capabilities) {
    assert.ok(capability.limitation.trim().length > 20, `${capability.id} needs a real limitation`);
    assertions++;
    if (capability.mappingKind === 'product-capability') {
      assert.ok(
        capability.productCapability,
        `${capability.id} needs an owning product capability`
      );
      assertions++;
      continue;
    }
    if (capability.status === 'covered') {
      assert.ok(
        capability.highSignalSourceIds.length > 0,
        `${capability.id} needs source mappings`
      );
      assert.ok(
        capability.highSignalSourceIds.some((id) => sourceIds.has(id)),
        `${capability.id} lost every mapped source from the generated catalog`
      );
      assertions += 2;
    }
    if (capability.status === 'unavailable') {
      assert.equal(
        capability.highSignalSourceIds.length,
        0,
        `${capability.id} cannot map sources while unavailable`
      );
      assertions++;
    }
  }
}

console.log(`feed data parity: ${assertions} assertions passed`);
