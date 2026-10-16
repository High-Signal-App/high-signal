import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { sourceKeyPagePlan, sourcePageWorthResolving } from '../lib/source-event-page';

const sources = ['us-gov-api:a', 'us-gov-api:b', 'US-GOV-API:C'];
let d1: TestD1;

beforeEach(() => {
  d1 = createSqliteD1();
  applyMigrations(d1);
  const rows = Array.from({ length: 90 }, (_, i) => {
    const id = `e-${String(i).padStart(3, '0')}`;
    return `('${id}','${sources[i % 3]}','https://example.test/${id}',${1000 + Math.floor(i / 9)},'${id}','body-${id}','hash-${id}',2000)`;
  });
  d1.exec(
    `INSERT INTO events (id, source, source_url, published_at, title, content, raw_hash, ingested_at) VALUES ${rows.join(',')}`
  );
  d1.exec(
    "INSERT INTO events (id,source,source_url,published_at,raw_hash,ingested_at) VALUES ('unrelated','other','https://example.test/other',9999,'other',9999)"
  );
});

afterEach(() => d1.close());

type Input = Parameters<typeof sourceKeyPagePlan>[1];
const base: Input = { limit: 5, offset: 0, range: null, cursor: null };

async function reference(input: Input) {
  const where = ['source IN (?,?,?)'];
  const params: Array<string | number> = [...sources];
  if (input.range) {
    where.push('published_at >= ? AND published_at < ?');
    params.push(input.range.start.getTime() / 1000, input.range.end.getTime() / 1000);
  }
  if (input.cursor) {
    where.push('(published_at < ? OR (published_at = ? AND id < ?))');
    params.push(input.cursor.publishedAt, input.cursor.publishedAt, input.cursor.id);
  }
  params.push(input.limit + 1, input.offset);
  return d1.binding
    .prepare(
      `SELECT id,title,content,source_url AS url,source,primary_entity_id AS entity,published_at AS publishedAt FROM events WHERE ${where.join(' AND ')} ORDER BY published_at DESC,id DESC LIMIT ? OFFSET ?`
    )
    .bind(...params)
    .all();
}

describe('source-key page selection', () => {
  it('keeps shallow government pages on their current plan and selects deep offsets', () => {
    expect(sourcePageWorthResolving(6, 42764, 629511, 51)).toBe(false);
    expect(sourcePageWorthResolving(6, 42764, 629511, 551)).toBe(false);
    expect(sourcePageWorthResolving(6, 42764, 629511, 5051)).toBe(false);
    expect(sourcePageWorthResolving(6, 42764, 629511, 20051)).toBe(true);
    expect(sourcePageWorthResolving(91, 42764, 629511, 40051)).toBe(false);
    expect(sourcePageWorthResolving(6, 42764, null, 40051)).toBe(false);
  });
  it.each<Input>([
    base,
    { ...base, offset: 7 },
    { ...base, range: { start: new Date(1002_000), end: new Date(1006_000) } },
    { ...base, cursor: { publishedAt: 1005, id: 'e-050' } },
    {
      ...base,
      offset: 3,
      range: { start: new Date(1002_000), end: new Date(1006_000) },
      cursor: { publishedAt: 1005, id: 'e-050' },
    },
    { ...base, cursor: { publishedAt: 1, id: 'none' } },
  ])('preserves exact rows, ties and half-open filters: %j', async (input) => {
    const plan = sourceKeyPagePlan(sources, input)!;
    const actual = await d1.binding
      .prepare(plan.query)
      .bind(...plan.params)
      .all();
    expect(actual.results).toEqual((await reference(input)).results);
  });

  it('uses per-source index seeks instead of walking unrelated newer events', async () => {
    const plan = sourceKeyPagePlan(sources, base)!;
    const result = await d1.binding
      .prepare(`EXPLAIN QUERY PLAN ${plan.query}`)
      .bind(...plan.params)
      .all<{ detail: string }>();
    const detail = result.results.map((row) => row.detail).join('\n');
    expect(detail).toContain('events_source_rollup_idx');
    expect(detail).not.toContain('SCAN events USING INDEX events_published_id_idx');
    expect(detail).toContain('SEARCH events USING INDEX sqlite_autoindex_events_1');
  });

  it('stays within the D1 bind limit at the widest bounded merge', async () => {
    const plan = sourceKeyPagePlan(
      Array.from({ length: 90 }, (_, i) => `source-${i}`),
      { ...base, limit: 49 }
    )!;
    expect(plan.params).toHaveLength(96);
    expect(
      (
        await d1.binding
          .prepare(plan.query)
          .bind(...plan.params)
          .all()
      ).results
    ).toEqual([]);
  });

  it('retains the existing plan for wide families and invalid bounds', () => {
    expect(sourceKeyPagePlan(Array(91).fill('source'), base)).toBeNull();
    expect(sourceKeyPagePlan(sources, { ...base, limit: 201 })).toBeNull();
    expect(sourceKeyPagePlan(sources, { ...base, offset: 0.5 })).toBeNull();
    expect(sourceKeyPagePlan(['single'], base)).toBeNull();
    expect(sourceKeyPagePlan(null, base)).toBeNull();
  });

  it('binds source and cursor text without treating it as SQL', async () => {
    const plan = sourceKeyPagePlan(["x' OR 1=1 --", 'missing'], {
      ...base,
      cursor: { publishedAt: 99999, id: "z' OR 1=1 --" },
    })!;
    expect(
      (
        await d1.binding
          .prepare(plan.query)
          .bind(...plan.params)
          .all()
      ).results
    ).toEqual([]);
  });
});
