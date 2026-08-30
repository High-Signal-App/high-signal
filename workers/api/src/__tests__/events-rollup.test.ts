import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { app } from '../app';
import { db } from '../db';
import {
  eventsRollupIsReady,
  readEventsRollupState,
  refreshEventsSourceRollup,
} from '../lib/events-rollup';

// Anchored to the wall clock: the live aggregates this change replaces split
// observed from future rows with SQL `unixepoch()`, so a fixture pinned to a
// fixed epoch could not exercise the future-dated branch at all.
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;

// Deliberately covers every branch of `sourceMatch`: a bare alias (`markets`),
// a `family:variant` sub-source, a GLOB-only `edgar_*` form, both halves of the
// china-news special case, and the `osv`/`package` aliases that fold into
// `packages`. A future-dated row exercises the observed/future split.
const EVENTS: Array<[string, number, number]> = [
  ['markets', NOW - 10 * DAY, NOW - 9 * DAY],
  ['markets:AAPL', NOW - 3 * DAY, NOW - 3 * DAY],
  ['market:legacy', NOW - 40 * DAY, NOW - 40 * DAY],
  ['edgar_10k', NOW - 2 * DAY, NOW - DAY],
  ['edgar_8k', NOW - DAY, NOW - DAY],
  ['china-news:caixin', NOW - 5 * DAY, NOW - 5 * DAY],
  ['news:china-news-yicai', NOW - 4 * DAY, NOW - 4 * DAY],
  ['scmp:tech', NOW - 6 * DAY, NOW - 6 * DAY],
  ['osv', NOW - 7 * DAY, NOW - 7 * DAY],
  ['package:npm', NOW - 8 * DAY, NOW - 8 * DAY],
  ['packages', NOW - DAY, NOW - DAY],
  ['hackernews', NOW - 12 * 3600, NOW - 11 * 3600],
  ['us-gov-api', NOW + 3600, NOW - DAY],
  ['regulations-gov', NOW - 20 * DAY, NOW - 20 * DAY],
];

function seedEvents(d1: TestD1, rows = EVENTS) {
  const values = rows
    .map(
      ([source, publishedAt, ingestedAt], index) =>
        `('e${index}-${publishedAt}','${source}','https://example.test/${index}-${publishedAt}',${publishedAt},'t${index}',NULL,NULL,'h${index}-${publishedAt}',${ingestedAt})`
    )
    .join(',');
  d1.exec(
    `INSERT INTO events (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at) VALUES ${values}`
  );
}

let d1: TestD1;
const env = () => ({ DB: d1.binding, ENVIRONMENT: 'test' });

beforeEach(() => {
  d1 = createSqliteD1();
  applyMigrations(d1);
  seedEvents(d1);
});

afterEach(() => {
  d1.close();
});

async function sourcesPayload() {
  const response = await app.fetch(new Request('http://test/data/sources'), env());
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  // The only field that legitimately differs between two reads.
  delete body['generatedAt'];
  return body;
}

async function sourceDetail(id: string) {
  const response = await app.fetch(new Request(`http://test/data/sources/${id}`), env());
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

const CATALOG_IDS = [
  'markets',
  'edgar',
  'china-news',
  'scmp',
  'packages',
  'hackernews',
  'us-gov-api',
  'regulations',
  'reddit',
];

describe('events source rollup', () => {
  it('serves the live aggregate until the cron has built the rollup', async () => {
    await expect(eventsRollupIsReady(db(d1.binding))).resolves.toBe(false);
    const body = await sourcesPayload();
    expect(body['available']).toBe(true);
    expect(body['total']).toBe(EVENTS.length);
  });

  it('serves identical /data/sources numbers before and after the rebuild', async () => {
    const before = await sourcesPayload();

    const result = await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    expect(result.rebuilt).toBe(true);
    expect(result.reason).toBe('bootstrap');
    await expect(eventsRollupIsReady(db(d1.binding))).resolves.toBe(true);

    const after = await sourcesPayload();
    expect(after).toEqual(before);
  });

  it('serves identical /data/sources/:id numbers before and after the rebuild', async () => {
    const before: Record<string, unknown> = {};
    for (const id of CATALOG_IDS) before[id] = await sourceDetail(id);

    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));

    for (const id of CATALOG_IDS) {
      expect(await sourceDetail(id), `family ${id}`).toEqual(before[id]);
    }
  });

  it('keeps the future-dated row out of the observed watermark', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    const detail = await sourceDetail('us-gov-api');
    expect(detail['total']).toBe(1);
    expect(detail['futureCount']).toBe(1);
    // The one stored row is future-dated, so there is no observed timestamp.
    expect(detail['latestObservedAt']).toBe(0);
    expect(detail['lastIngestedAt']).toBe(NOW - DAY);
  });

  it('still answers a ?date= request from events, not the rollup', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    const response = await app.fetch(
      new Request('http://test/data/sources/markets?date=1970-01-02'),
      env()
    );
    const body = (await response.json()) as Record<string, unknown>;
    // A day with no rows must report zero rather than the family lifetime total.
    expect(body['total']).toBe(0);
  });
});

describe('events index coverage', () => {
  async function plan(sql: string) {
    const { results } = await d1.binding
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all<{ detail: string }>();
    return results.map((row) => row.detail).join('\n');
  }

  it("bounds the Daily Brief's evidence-input receipt to the day it asks for", async () => {
    // Verbatim from `loadMaterialEvidenceInputReceipt`. Without
    // `events_ingested_at_idx` this is a full scan of `events` on every
    // uncached `GET /data/daily`.
    const detail = await plan(
      'select "source", count(*), max("ingested_at") from "events" where ("events"."ingested_at" >= 1 and "events"."ingested_at" < 2) group by "events"."source"'
    );
    expect(detail).toContain('events_ingested_at_idx');
    expect(detail).not.toContain('SCAN events\n');
  });

  it('rebuilds the rollup from a covering index with no temp B-tree', async () => {
    const detail = await plan(
      'select source, count(*), max(case when published_at <= 1 then published_at end), max(ingested_at), sum(case when published_at > 1 then 1 else 0 end) from events group by source'
    );
    expect(detail).toContain('events_source_rollup_idx');
    expect(detail).not.toContain('TEMP B-TREE');
  });

  it('answers the rollup freshness probe without scanning events', async () => {
    const detail = await plan(
      'select ingested_at, id from events indexed by events_ingested_at_idx order by ingested_at desc, id desc limit 1'
    );
    expect(detail).toContain('events_ingested_at_idx');
  });

  it('bounds incremental rollup reads to the ingest cursor', async () => {
    const detail = await plan(
      "select source, count(*) from events indexed by events_ingested_at_idx where ingested_at > 1 or (ingested_at = 1 and id > 'cursor') group by source"
    );
    expect(detail).toContain('events_ingested_at_idx');
  });
});

describe('rollup refresh policy', () => {
  it('skips a rebuild when nothing could have changed', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    const second = await refreshEventsSourceRollup(
      env(),
      db(d1.binding),
      new Date((NOW + 1800) * 1000)
    );
    expect(second.rebuilt).toBe(false);
    expect(second.reason).toBe('unchanged');

    const state = await readEventsRollupState(db(d1.binding));
    expect(state?.rebuiltAt).toBe(NOW);
    expect(state?.refreshedAt).toBe(NOW + 1800);
  });

  it('rebuilds when new events land', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    seedEvents(d1, [['hackernews', NOW + 60, NOW + 60]]);

    const result = await refreshEventsSourceRollup(
      env(),
      db(d1.binding),
      new Date((NOW + 1800) * 1000)
    );
    expect(result.reason).toBe('new_events');

    const detail = await sourceDetail('hackernews');
    expect(detail['total']).toBe(2);
    expect(detail['latestObservedAt']).toBe(NOW + 60);
  });

  it('does not miss a row added at the cursor timestamp', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    const state = await readEventsRollupState(db(d1.binding));
    expect(state?.maxIngestedId).toBeTruthy();

    d1.exec(
      `INSERT INTO events
         (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at)
       VALUES ('zz-after-cursor', 'hackernews', 'https://example.test/after-cursor', ${NOW - 30},
               'late tie', NULL, NULL, 'h-after-cursor', ${state?.maxIngestedAt ?? 0})`
    );

    const result = await refreshEventsSourceRollup(
      env(),
      db(d1.binding),
      new Date((NOW + 1800) * 1000)
    );
    expect(result.reason).toBe('new_events');
    expect((await sourceDetail('hackernews'))['total']).toBe(2);
  });

  it('rebuilds when a future-dated row matures, with no new ingest', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    expect((await sourceDetail('us-gov-api'))['futureCount']).toBe(1);

    // Two hours later the row's published_at is in the past. No ingest
    // happened, so only the maturation probe can catch this.
    const later = new Date((NOW + 2 * 3600) * 1000);
    const result = await refreshEventsSourceRollup(env(), db(d1.binding), later);
    expect(result.reason).toBe('matured_events');

    const detail = await sourceDetail('us-gov-api');
    expect(detail['futureCount']).toBe(0);
    expect(detail['latestObservedAt']).toBe(NOW + 3600);
  });

  it('does not turn out-of-band deletes into a recurring full-table rebuild', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    d1.exec("DELETE FROM events WHERE source IN ('scmp:tech', 'us-gov-api')");

    const result = await refreshEventsSourceRollup(
      env(),
      db(d1.binding),
      new Date((NOW + 24 * 60 * 60) * 1000)
    );
    expect(result.reason).toBe('unchanged');
    // Explicit repair is required for unsupported out-of-band deletes.
    expect((await sourceDetail('scmp'))['total']).toBe(1);
  });
});
