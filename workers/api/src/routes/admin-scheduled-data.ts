import { Hono } from 'hono';

type Env = { DB: D1Database };

const MAX_BACKTEST_EVENTS = 25_000;
const MAX_BACKTEST_SIGNALS = 5_000;

export const scheduledDataAdminRoute = new Hono<{ Bindings: Env }>();

scheduledDataAdminRoute.get('/backtest', async (c) => {
  const requestedDays = Number.parseInt(c.req.query('days') ?? '21', 10);
  if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 90) {
    return c.json({ error: 'days_must_be_between_1_and_90' }, 400);
  }
  const cutoff = Math.floor(Date.now() / 1000) - requestedDays * 86_400;
  const [events, signals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT primary_entity_id, source, published_at
       FROM events
       WHERE primary_entity_id IS NOT NULL AND published_at >= ?
       LIMIT ${MAX_BACKTEST_EVENTS + 1}`
    )
      .bind(cutoff)
      .all(),
    c.env.DB.prepare(
      `SELECT primary_entity_id, published_at, review_status, signal_type
       FROM signals
       WHERE published_at >= ?
       LIMIT ${MAX_BACKTEST_SIGNALS + 1}`
    )
      .bind(cutoff)
      .all(),
  ]);
  if (
    (events.results?.length ?? 0) > MAX_BACKTEST_EVENTS ||
    (signals.results?.length ?? 0) > MAX_BACKTEST_SIGNALS
  ) {
    return c.json({ error: 'backtest_dataset_exceeds_safe_limit' }, 409);
  }
  return c.json({
    days: requestedDays,
    generatedAt: new Date().toISOString(),
    events: events.results ?? [],
    signals: signals.results ?? [],
  });
});
