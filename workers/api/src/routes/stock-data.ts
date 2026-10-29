import { Hono } from 'hono';
import {
  currentStockData,
  type StockDataset,
} from '../../../../packages/shared/src/stock-data/public';
import { publicationRightsCurrent } from '../lib/stock-data-contract';

export const stockDataRoute = new Hono<{ Bindings: { DB: D1Database } }>();

stockDataRoute.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  const audience = c.req.query('export') === '1' ? 'export' : 'display';
  const row = await c.env.DB.prepare(
    'SELECT payload_json FROM stock_data_publications WHERE audience=? ORDER BY as_of DESC,publication_id DESC LIMIT 1'
  )
    .bind(audience)
    .first<{ payload_json: string }>();
  if (!row)
    return c.json(
      { error: 'stock_data_unavailable', coverage: 'unavailable', freshness: 'unavailable' },
      503
    );
  const retained = JSON.parse(row.payload_json) as StockDataset;
  if (!(await publicationRightsCurrent(c.env.DB, retained)))
    return c.json(
      { error: 'stock_data_rights_changed', coverage: 'unavailable', freshness: 'unavailable' },
      503
    );
  const dataset = currentStockData(retained);
  const requestedSnapshot = c.req.query('snapshot');
  c.header('Cache-Control', 'no-store');
  if (requestedSnapshot && requestedSnapshot !== dataset.snapshot_id) {
    return c.json({ error: 'snapshot_unavailable', snapshotId: dataset.snapshot_id }, 409);
  }
  const entity = c.req.query('entity');
  if (entity) {
    dataset.valuations = dataset.valuations.filter((value) => value.parent_entity_id === entity);
    const inputs = new Set(dataset.valuations.flatMap((value) => value.input_fact_ids));
    dataset.facts = dataset.facts.filter(
      (fact) => fact.entity_id === entity || inputs.has(fact.id)
    );
    dataset.changes = dataset.changes.filter((change) => change.entity_id === entity);
    const entities = new Set([entity, ...dataset.facts.map((fact) => fact.entity_id)]);
    dataset.entities = dataset.entities.filter((row) => entities.has(row.id));
    dataset.securities = dataset.securities.filter((row) => entities.has(row.entity_id));
    const evidenceIds = new Set(dataset.facts.map((fact) => fact.evidence_id));
    for (const change of dataset.changes) {
      if (change.before) evidenceIds.add(change.before.evidence_id);
      if (change.after) evidenceIds.add(change.after.evidence_id);
    }
    dataset.evidence = dataset.evidence.filter((record) => evidenceIds.has(record.id));
  }
  return c.json({
    ...dataset,
    adapter: 'techdata.readonly.v1',
    capabilities: ['read'],
    servedAt: new Date().toISOString(),
    numericalClaims: 'observations; no investment recommendation',
  });
});
