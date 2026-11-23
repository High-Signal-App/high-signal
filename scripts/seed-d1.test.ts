import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  addEntitiesSql,
  assertNoRosterIdentityCollisions,
  parseCsv,
  requestedAddIds,
  wranglerSeedArgs,
} from './seed-d1.ts';

const crowdstrike = {
  id: 'CRWD',
  ticker: 'CRWD',
  name: 'CrowdStrike Holdings Inc.',
  type: 'public',
  country: 'US',
  sector: 'security',
  subsector: 'endpoint-cloud-security',
  aliases: 'CrowdStrike|CrowdStrike Holdings',
  wiki_url: 'https://en.wikipedia.org/wiki/CrowdStrike',
  ir_url: 'https://ir.crowdstrike.com',
};

const zscaler = {
  id: 'ZS',
  ticker: 'ZS',
  name: 'Zscaler Inc.',
  type: 'public',
  country: 'US',
  sector: 'security',
  subsector: 'cloud-security-sase',
  aliases: 'Zscaler|Zscaler Inc',
  wiki_url: 'https://en.wikipedia.org/wiki/Zscaler',
  ir_url: 'https://ir.zscaler.com',
};

const apiSeed = JSON.parse(
  readFileSync(new URL('../workers/api/src/lib/seed-entities.json', import.meta.url), 'utf8')
) as Array<Record<string, string>>;
for (const entity of [crowdstrike, zscaler]) {
  const apiEntity = apiSeed.find((row) => row.id === entity.id);
  assert.ok(apiEntity, `API seed includes ${entity.id}`);
  for (const field of [
    'ticker',
    'name',
    'type',
    'country',
    'sector',
    'subsector',
    'aliases',
    'wiki_url',
    'ir_url',
  ]) {
    assert.equal(
      apiEntity[field],
      entity[field],
      `${entity.id} API/Python seed ${field} stays in sync`
    );
  }
}

const roster = parseCsv(
  readFileSync(
    new URL('../python/ingest/src/high_signal_ingest/seed/ai_infra_entities.csv', import.meta.url),
    'utf8'
  )
);
const curatedRows = ['CRWD', 'ZS'].map((id) => roster.find((row) => row.id === id));
assert.ok(
  curatedRows.every((row) => row),
  'both curated IDs exist in the canonical CSV roster'
);
assertNoRosterIdentityCollisions(curatedRows as Array<Record<string, string>>, roster);
assert.throws(
  () =>
    assertNoRosterIdentityCollisions(
      [crowdstrike],
      [
        crowdstrike,
        { id: 'OTHER', ticker: 'OTHER', name: 'Other Security Firm', aliases: 'CrowdStrike' },
      ]
    ),
  /identity collision/
);
assert.deepEqual(wranglerSeedArgs('--remote', '/tmp/seed.sql', '/tmp/wrangler.toml'), [
  '--filter',
  '@high-signal/api',
  'exec',
  'wrangler',
  'd1',
  'execute',
  'high-signal-db',
  '--remote',
  '--file=/tmp/seed.sql',
  '--config=/tmp/wrangler.toml',
]);
assert.deepEqual(requestedAddIds(['--remote', '--add-entities=CRWD,ZS']), ['CRWD', 'ZS']);
assert.throws(
  () => requestedAddIds(['--add-entities', 'CRWD', '--add-entities', 'ZS']),
  /only be specified once/
);

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE entities (
    id TEXT PRIMARY KEY NOT NULL,
    ticker TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    country TEXT,
    sector TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO entities VALUES
    ('OTHER','OTHER','Unrelated row','public','US','software','{}',10,10)`);
  return db;
}

function rows(db: DatabaseSync): unknown[] {
  return db
    .prepare('SELECT id,ticker,name,created_at,updated_at FROM entities ORDER BY id')
    .all()
    .map((row) => ({ ...row }));
}

const db = database();
const sql = addEntitiesSql([crowdstrike, zscaler]);
assert.match(sql, /^INSERT INTO entities/);
assert.doesNotMatch(sql, /INSERT OR REPLACE/i);
db.exec(sql);
const first = rows(db);
assert.equal(first.length, 3);
assert.deepEqual(
  first.map((row) => (row as { id: string }).id),
  ['CRWD', 'OTHER', 'ZS']
);
db.exec(sql);
assert.deepEqual(rows(db), first, 'repeated additive seed preserves all row values and timestamps');
db.close();

const collisionDb = database();
collisionDb.exec(`INSERT INTO entities VALUES
  ('CRWD','CRWD','Different company identity','public','US','security','{}',20,20)`);
assert.throws(() => collisionDb.exec(sql), /constraint/i);
assert.deepEqual(
  rows(collisionDb),
  [
    {
      id: 'CRWD',
      ticker: 'CRWD',
      name: 'Different company identity',
      created_at: 20,
      updated_at: 20,
    },
    { id: 'OTHER', ticker: 'OTHER', name: 'Unrelated row', created_at: 10, updated_at: 10 },
  ],
  'a conflicting ID aborts the whole multi-row statement and leaves unrelated rows untouched'
);
collisionDb.close();

assert.throws(() => addEntitiesSql([crowdstrike, crowdstrike]), /unique, non-empty ids/);
console.log('✓ additive entity seed is idempotent, collision-safe, and isolated');
