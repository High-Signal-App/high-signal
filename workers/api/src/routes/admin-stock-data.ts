import { Hono } from 'hono';
import {
  boundedBody,
  publicationRightsCurrent,
  validPublication,
  validRecord,
  type StockRecord,
} from '../lib/stock-data-contract';
import type { StockDataset } from '../../../../packages/shared/src/stock-data/public';

export const stockDataAdminRoute = new Hono<{ Bindings: { DB: D1Database } }>();
const MAX_BYTES = 1_500_000;

stockDataAdminRoute.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

stockDataAdminRoute.get('/records', async (c) => {
  const after = Number(c.req.query('after') ?? '0');
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'invalid_cursor' }, 400);
  const sizes = await c.env.DB.prepare(
    'SELECT sequence,length(CAST(payload_json AS BLOB)) AS bytes FROM stock_data_records WHERE sequence>? ORDER BY sequence LIMIT 1000'
  )
    .bind(after)
    .all<{ sequence: number; bytes: number }>();
  let cursor = after;
  let bytes = 0;
  for (const row of sizes.results) {
    if (bytes + row.bytes > 900_000 && cursor !== after) break;
    bytes += row.bytes;
    cursor = row.sequence;
    if (bytes > 900_000) break;
  }
  const records = await c.env.DB.prepare(
    'SELECT kind,id,payload_json FROM stock_data_records WHERE sequence>? AND sequence<=? ORDER BY sequence'
  )
    .bind(after, cursor)
    .all<{ kind: string; id: string; payload_json: string }>();
  return c.json({
    records: records.results.map((row) => ({
      kind: row.kind,
      id: row.id,
      payload: JSON.parse(row.payload_json),
    })),
    cursor,
  });
});

stockDataAdminRoute.get('/publications/current', async (c) => {
  const publications: Record<string, StockDataset | null> = {};
  for (const audience of ['display', 'export']) {
    const row = await c.env.DB.prepare(
      'SELECT payload_json FROM stock_data_publications WHERE audience=? ORDER BY julianday(as_of) DESC,as_of DESC,publication_id DESC LIMIT 1'
    )
      .bind(audience)
      .first<{ payload_json: string }>();
    publications[audience] = row ? JSON.parse(row.payload_json) : null;
  }
  return c.json(publications);
});

stockDataAdminRoute.post('/records', async (c) => {
  const raw = await boundedBody(c.req.raw, MAX_BYTES);
  if (raw === null) return c.json({ error: 'batch_too_large' }, 413);
  let records: StockRecord[];
  try {
    records = JSON.parse(raw).records;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(records) || !records.length || records.length > 500)
    return c.json({ error: 'invalid_records' }, 400);
  try {
    for (const record of records)
      if (!(await validRecord(record))) return c.json({ error: 'invalid_record_identity' }, 400);
  } catch {
    return c.json({ error: 'invalid_record' }, 400);
  }
  await c.env.DB.batch(
    records.map((record) =>
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO stock_data_records(kind,id,payload_json) VALUES(?,?,?)'
      ).bind(record.kind, record.id, JSON.stringify(record.payload))
    )
  );
  return c.json({ accepted: records.map((record) => record.id) });
});

stockDataAdminRoute.post('/publications', async (c) => {
  const raw = await boundedBody(c.req.raw, MAX_BYTES);
  if (raw === null) return c.json({ error: 'publication_too_large' }, 413);
  let payload: { display: StockDataset; export: StockDataset };
  try {
    payload = JSON.parse(raw);
    if (
      payload.display.audience !== 'display' ||
      payload.export.audience !== 'export' ||
      payload.display.as_of !== payload.export.as_of ||
      !(await validPublication(payload.display)) ||
      !(await validPublication(payload.export))
    )
      throw new Error();
  } catch {
    return c.json({ error: 'invalid_publication_or_rights' }, 400);
  }
  const datasets = [payload.display, payload.export];
  for (const value of datasets) {
    if (!(await publicationRightsCurrent(c.env.DB, value)))
      return c.json({ error: 'rights_changed' }, 409);
    const references = new Set([
      value.snapshot_id,
      ...value.facts.map((fact) => fact.id),
      ...value.evidence.map((item) => item.id),
      ...value.changes
        .flatMap((change) => [change.before?.id, change.after?.id])
        .filter((id): id is string => Boolean(id)),
    ]);
    const ids = [...references];
    for (let offset = 0; offset < ids.length; offset += 90) {
      const group = ids.slice(offset, offset + 90);
      const count = await c.env.DB.prepare(
        `SELECT count(*) AS total FROM stock_data_records WHERE id IN (${group.map(() => '?').join(',')})`
      )
        .bind(...group)
        .first<{ total: number }>();
      if (count?.total !== group.length) return c.json({ error: 'input_not_retained' }, 409);
    }
  }
  await c.env.DB.batch(
    datasets.map((value) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO stock_data_publications VALUES(?,?,?,?,?)').bind(
        value.publication_id,
        value.snapshot_id,
        value.audience,
        value.as_of,
        JSON.stringify(value)
      )
    )
  );
  return c.json({ accepted: datasets.map((value) => value.publication_id) });
});
