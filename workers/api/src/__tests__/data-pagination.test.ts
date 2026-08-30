import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { app } from '../app';
import { db } from '../db';
import { decodeKeysetCursor, encodeKeysetCursor } from '../lib/cursor';
import { refreshEventsSourceRollup } from '../lib/events-rollup';

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;

/**
 * Rows shaped like production, where the tie problem actually lives: ingest
 * writes a whole batch under one `published_at`, so `markets` here has 12 rows
 * across only two distinct timestamps. Any page smaller than a tie block has
 * both of its boundaries inside undefined order.
 */
function tiedBatch(source: string, publishedAt: number, count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(3, '0')}`,
    source,
    publishedAt,
    ingestedAt: publishedAt + 60,
  }));
}

const EVENTS = [
  ...tiedBatch('markets', NOW - DAY, 8, 'mk-a'),
  ...tiedBatch('market:legacy', NOW - DAY, 4, 'mk-b'),
  ...tiedBatch('markets', NOW - 2 * DAY, 6, 'mk-c'),
  // A sparse family whose rows are the oldest in the table: the time-ordered
  // plan has to walk everything above them to find these.
  ...tiedBatch('legistar:phoenix', NOW - 30 * DAY, 3, 'lg-a'),
  ...tiedBatch('legistar:mesa', NOW - 31 * DAY, 2, 'lg-b'),
  ...tiedBatch('china-news:caixin', NOW - 10 * DAY, 2, 'cn-a'),
  ...tiedBatch('news:china-news-yicai', NOW - 11 * DAY, 2, 'cn-b'),
  ...tiedBatch('edgar_10k', NOW - 5 * DAY, 2, 'ed-a'),
  ...tiedBatch('osv', NOW - 6 * DAY, 1, 'ov-a'),
];

function seedEvents(d1: TestD1, rows = EVENTS) {
  const values = rows
    .map(
      (r) =>
        `('${r.id}','${r.source}','https://example.test/${r.id}',${r.publishedAt},'t-${r.id}',NULL,NULL,'h-${r.id}',${r.ingestedAt})`
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

async function get(path: string) {
  const response = await app.fetch(new Request(`http://test${path}`), env());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface PageEvent {
  url: string;
  source: string;
  publishedAt: number;
}

/** Walks every page with `?cursor=` and returns the concatenated rows. */
async function walkByCursor(id: string, limit: number, extra = '') {
  const seen: PageEvent[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const { body } = await get(`/data/sources/${id}?limit=${limit}${extra}${query}`);
    seen.push(...(body['events'] as PageEvent[]));
    cursor = body['nextCursor'] as string | null;
    if (!body['hasMore']) {
      expect(cursor).toBeNull();
      return seen;
    }
    expect(cursor).toBeTypeOf('string');
  }
  throw new Error('cursor walk did not terminate');
}

/** Walks every page with `?offset=` and returns the concatenated rows. */
async function walkByOffset(id: string, limit: number, extra = '') {
  const seen: PageEvent[] = [];
  for (let offset = 0; offset < 500; offset += limit) {
    const { body } = await get(`/data/sources/${id}?limit=${limit}&offset=${offset}${extra}`);
    seen.push(...(body['events'] as PageEvent[]));
    if (!body['hasMore']) return seen;
  }
  throw new Error('offset walk did not terminate');
}

describe('keyset cursor codec', () => {
  it('round-trips a position', () => {
    const cursor = { publishedAt: NOW, id: 'evt-1' };
    expect(decodeKeysetCursor(encodeKeysetCursor(cursor))).toEqual(cursor);
  });

  it('round-trips an id containing the field separator', () => {
    const cursor = { publishedAt: 1, id: 'a.b.c' };
    expect(decodeKeysetCursor(encodeKeysetCursor(cursor))).toEqual(cursor);
  });

  it('is opaque rather than a readable position', () => {
    expect(encodeKeysetCursor({ publishedAt: 1234, id: 'evt-1' })).not.toContain('1234');
  });

  it('rejects malformed, truncated, and wrong-version tokens', () => {
    expect(decodeKeysetCursor('not-base64!!')).toBeNull();
    expect(decodeKeysetCursor(btoa('1.123'))).toBeNull();
    expect(decodeKeysetCursor(btoa('2.123.evt-1'))).toBeNull();
    expect(decodeKeysetCursor(btoa('1.abc.evt-1'))).toBeNull();
    expect(decodeKeysetCursor(btoa('1.123.'))).toBeNull();
  });
});

describe('GET /data/sources/:id pagination', () => {
  it('pages a tie block without dropping or repeating a row', async () => {
    // 12 `markets` rows share one `published_at`; a 5-row page lands inside it.
    const walked = await walkByCursor('markets', 5);
    const urls = walked.map((e) => e.url);
    expect(urls).toHaveLength(18);
    expect(new Set(urls).size).toBe(18);

    const { body } = await get('/data/sources/markets?limit=200');
    expect(urls).toEqual((body['events'] as PageEvent[]).map((e) => e.url));
  });

  it('returns a strictly descending total order across page boundaries', async () => {
    const walked = await walkByCursor('markets', 3);
    for (let i = 1; i < walked.length; i++) {
      const prev = walked[i - 1] as PageEvent;
      const next = walked[i] as PageEvent;
      expect(prev.publishedAt).toBeGreaterThanOrEqual(next.publishedAt);
      if (prev.publishedAt === next.publishedAt) {
        // The tiebreaker, not chance, is what orders rows inside a tie block.
        expect(prev.url > next.url).toBe(true);
      }
    }
  });

  it('does not repeat rows when an ingest lands between two page fetches', async () => {
    // The failure `OFFSET` cannot avoid: four new rows arrive above the window
    // after page 1 has been served, so `OFFSET 5` now points five rows into a
    // list that grew at the head, and page 2 re-serves what page 1 returned.
    const insertMidWalk = () => seedEvents(d1, tiedBatch('markets', NOW, 4, 'mk-new'));

    const offsetPage1 = await get('/data/sources/markets?limit=5&offset=0');
    insertMidWalk();
    const offsetPage2 = await get('/data/sources/markets?limit=5&offset=5');
    const offsetUrls = [
      ...(offsetPage1.body['events'] as PageEvent[]),
      ...(offsetPage2.body['events'] as PageEvent[]),
    ].map((e) => e.url);
    expect(new Set(offsetUrls).size).toBeLessThan(offsetUrls.length);

    // Same interleaving, keyset cursor: the cursor names a position in the
    // data, not a count of rows, so nothing the insert did can shift it.
    d1.exec("DELETE FROM events WHERE id LIKE 'mk-new-%'");
    const cursorPage1 = await get('/data/sources/markets?limit=5');
    insertMidWalk();
    const cursorPage2 = await get(
      `/data/sources/markets?limit=5&cursor=${encodeURIComponent(cursorPage1.body['nextCursor'] as string)}`
    );
    const cursorUrls = [
      ...(cursorPage1.body['events'] as PageEvent[]),
      ...(cursorPage2.body['events'] as PageEvent[]),
    ].map((e) => e.url);
    expect(new Set(cursorUrls).size).toBe(cursorUrls.length);
  });

  it('serves the same rows through the cursor and the offset walk', async () => {
    for (const id of ['markets', 'legistar', 'china-news', 'packages']) {
      expect(await walkByCursor(id, 2), `family ${id}`).toEqual(await walkByOffset(id, 2));
    }
  });

  it('reports hasMore exactly rather than inferring it from a stale total', async () => {
    // 18 markets rows: an 18-row page is the last page even though a caller
    // cannot know that from `total` alone.
    const exact = await get('/data/sources/markets?limit=18');
    expect((exact.body['events'] as PageEvent[]).length).toBe(18);
    expect(exact.body['hasMore']).toBe(false);
    expect(exact.body['nextCursor']).toBeNull();

    const short = await get('/data/sources/markets?limit=17');
    expect(short.body['hasMore']).toBe(true);
    expect(short.body['nextCursor']).toBeTypeOf('string');
  });

  it('rejects a malformed cursor instead of silently serving page one', async () => {
    const { status, body } = await get('/data/sources/markets?cursor=garbage!');
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_cursor');
  });

  it('ignores offset alongside a cursor rather than compounding them', async () => {
    const first = await get('/data/sources/markets?limit=5');
    const cursor = encodeURIComponent(first.body['nextCursor'] as string);
    const withOffset = await get(`/data/sources/markets?limit=5&offset=5&cursor=${cursor}`);
    const withoutOffset = await get(`/data/sources/markets?limit=5&cursor=${cursor}`);
    expect(withOffset.body['events']).toEqual(withoutOffset.body['events']);
  });
});

describe('GET /data/sources/:id filters', () => {
  it('narrows to one raw source inside the family, in SQL', async () => {
    const { body } = await get('/data/sources/markets?source=market:legacy&limit=200');
    const events = body['events'] as PageEvent[];
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.source))).toEqual(new Set(['market:legacy']));
    // Totals describe the filtered set, not the whole family.
    expect(body['total']).toBe(4);
  });

  it('will not read outside the family through the source filter', async () => {
    const { body } = await get('/data/sources/markets?source=legistar:phoenix&limit=200');
    expect(body['events']).toEqual([]);
    expect(body['total']).toBe(0);
  });

  it('combines the source filter with the day filter', async () => {
    const day = new Date((NOW - DAY) * 1000).toISOString().slice(0, 10);
    const { body } = await get(`/data/sources/markets?source=markets&date=${day}&limit=200`);
    for (const event of body['events'] as PageEvent[]) expect(event.source).toBe('markets');
  });

  it('paginates a day-filtered listing over the same total order', async () => {
    const day = new Date((NOW - DAY) * 1000).toISOString().slice(0, 10);
    const walked = await walkByCursor('markets', 3, `&date=${day}`);
    expect(new Set(walked.map((e) => e.url)).size).toBe(walked.length);
  });
});

describe('GET /data/sources/:id response contract', () => {
  const LEGACY_FIELDS = [
    'id',
    'total',
    'latestObservedAt',
    'lastIngestedAt',
    'futureCount',
    'events',
    'hasMore',
    'available',
  ];

  it('adds nextCursor and changes nothing else for an unparameterised call', async () => {
    const { body } = await get('/data/sources/markets');
    for (const field of LEGACY_FIELDS) expect(body, field).toHaveProperty(field);
    expect(Object.keys(body).sort()).toEqual([...LEGACY_FIELDS, 'nextCursor'].sort());
    const [event] = body['events'] as Array<Record<string, unknown>>;
    // `id` is selected to build the cursor but must not leak into the payload.
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'content',
      'entity',
      'publishedAt',
      'source',
      'title',
      'url',
    ]);
  });

  it('still returns the whole family with no pagination parameters', async () => {
    // No implicit default limit was introduced: `limit` keeps its old default
    // of 50, so a call that fitted in one page before still does.
    const { body } = await get('/data/sources/markets');
    expect((body['events'] as PageEvent[]).length).toBe(18);
    expect(body['hasMore']).toBe(false);
  });

  it('answers identically whether or not the rollup has been built', async () => {
    const before: Record<string, unknown> = {};
    for (const id of ['markets', 'legistar', 'china-news', 'packages', 'edgar']) {
      before[id] = (await get(`/data/sources/${id}?limit=200`)).body;
    }
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    for (const id of ['markets', 'legistar', 'china-news', 'packages', 'edgar']) {
      expect((await get(`/data/sources/${id}?limit=200`)).body, `family ${id}`).toEqual(before[id]);
    }
  });

  it('answers an empty family without reading events at all', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    // A catalogued family with no stored rows resolves to no source values, so
    // there is nothing to seek and nothing to scan.
    const { body } = await get('/data/sources/hackernews?limit=200');
    expect(body['events']).toEqual([]);
    expect(body['total']).toBe(0);
    expect(body['hasMore']).toBe(false);
    expect(body['nextCursor']).toBeNull();
    expect(body['available']).toBe(true);
  });

  it('finds a source value that first appeared after the last rebuild', async () => {
    await refreshEventsSourceRollup(env(), db(d1.binding), new Date(NOW * 1000));
    // A brand-new sub-source, so the rollup has never seen this `source` value.
    seedEvents(d1, tiedBatch('legistar:tucson', NOW - DAY, 2, 'lg-new'));
    const { body } = await get('/data/sources/legistar?limit=200');
    const sources = new Set((body['events'] as PageEvent[]).map((e) => e.source));
    expect(sources).toContain('legistar:tucson');
    expect((body['events'] as PageEvent[]).length).toBe(7);
  });
});

describe('events pagination index coverage', () => {
  async function plan(sql: string) {
    const { results } = await d1.binding.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{
      detail: string;
    }>();
    return results.map((row) => row.detail).join('\n');
  }

  it('orders by the tiebreaker from the index, not a temp B-tree', async () => {
    const detail = await plan(
      'select title, source_url from events order by published_at desc, id desc limit 51'
    );
    expect(detail).toContain('events_published_id_idx');
    expect(detail).not.toContain('TEMP B-TREE FOR ORDER BY');
  });

  it('seeks straight to the cursor rather than re-walking skipped rows', async () => {
    const detail = await plan(
      `select title from events where (published_at < ${NOW} or (published_at = ${NOW} and id < 'z')) order by published_at desc, id desc limit 51`
    );
    expect(detail).toContain('events_published_id_idx');
  });

  it('serves the sparse-family listing by seeking on source', async () => {
    const detail = await plan(
      "select title from events where source in ('legistar:phoenix','legistar:mesa') order by published_at desc, id desc limit 51"
    );
    expect(detail).toContain('events_source_rollup_idx');
    expect(detail).not.toContain('SCAN events');
  });

  it('resolves new source values from the ingest index, not a table scan', async () => {
    // `INDEXED BY` is load-bearing: left to choose, SQLite reads
    // `SELECT DISTINCT source` and picks the source-leading index, which scans
    // the whole table. This asserts the pin survives.
    const detail = await plan(
      `select distinct source from events indexed by events_ingested_at_idx where ingested_at >= ${NOW}`
    );
    expect(detail).toContain('events_ingested_at_idx');
    expect(detail).not.toContain('events_source_rollup_idx');
  });

  it('still serves published_at range queries after the index swap', async () => {
    // Migration 0026 dropped `events_published_idx`; `(published_at, id)` has
    // it as a leading prefix, so the rollup's maturation probe is unaffected.
    const detail = await plan(
      `select count(*) from events where published_at > ${NOW - DAY} and published_at <= ${NOW}`
    );
    expect(detail).toContain('events_published_id_idx');
    expect(detail).toContain('SEARCH');
  });
});
