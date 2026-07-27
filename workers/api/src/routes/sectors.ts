import { Hono } from 'hono';

type Env = { DB: D1Database };

interface SectorRow {
  sector: string;
  signal_count: number;
  up_count: number;
  down_count: number;
  neutral_count: number;
  hits: number;
  misses: number;
  pushes: number;
  net_direction: number;
  top_entities: string;
}

export const sectorsRoute = new Hono<{ Bindings: Env }>();

sectorsRoute.get('/', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 60), 365);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  // Confidence-weighted directional score per sector. Time-decay drops linearly
  // to 0.3 over the window so recent signals dominate.
  const rows = (await c.env.DB.prepare(
    `WITH s_w AS (
      SELECT
        e.sector AS sector,
        s.primary_entity_id,
        s.direction,
        s.confidence,
        s.published_at,
        (CASE s.confidence WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.6 ELSE 0.3 END) AS conf_w,
        (1.0 - 0.7 * ((unixepoch() - s.published_at) * 1.0 / (? * 86400))) AS time_w
      FROM signals s
      JOIN entities e ON e.id = s.primary_entity_id
      WHERE s.review_status = 'published'
        AND e.sector IS NOT NULL
        AND s.published_at >= ?
    )
    SELECT
      sector,
      COUNT(*) AS signal_count,
      SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END) AS up_count,
      SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END) AS down_count,
      SUM(CASE WHEN direction = 'neutral' THEN 1 ELSE 0 END) AS neutral_count,
      ROUND(SUM(CASE
        WHEN direction = 'up' THEN conf_w * time_w
        WHEN direction = 'down' THEN -conf_w * time_w
        ELSE 0 END), 3) AS net_direction,
      (
        SELECT GROUP_CONCAT(entity_id, ',') FROM (
          SELECT primary_entity_id AS entity_id
          FROM s_w sw2
          WHERE sw2.sector = s_w.sector
          GROUP BY primary_entity_id
          ORDER BY COUNT(*) DESC
          LIMIT 5
        )
      ) AS top_entities,
      0 AS hits, 0 AS misses, 0 AS pushes
    FROM s_w
    GROUP BY sector
    ORDER BY ABS(net_direction) DESC`
  )
    .bind(days, since)
    .all()) as { results: SectorRow[] };

  const scoreRows = (await c.env.DB.prepare(
    `SELECT e.sector AS sector,
            SUM(CASE sr.outcome WHEN 'hit' THEN 1 ELSE 0 END) AS hits,
            SUM(CASE sr.outcome WHEN 'miss' THEN 1 ELSE 0 END) AS misses,
            SUM(CASE sr.outcome WHEN 'push' THEN 1 ELSE 0 END) AS pushes
     FROM score_runs sr
     JOIN signals s ON s.id = sr.signal_id
     JOIN entities e ON e.id = s.primary_entity_id
     WHERE s.published_at >= ?
     GROUP BY e.sector`
  )
    .bind(since)
    .all()) as {
    results: Array<{ sector: string; hits: number; misses: number; pushes: number }>;
  };

  const scoresBySector = new Map(scoreRows.results.map((r) => [r.sector, r]));

  const sectors = (rows.results ?? []).map((r) => {
    const sc = scoresBySector.get(r.sector) ?? { hits: 0, misses: 0, pushes: 0 };
    const total = (sc.hits ?? 0) + (sc.misses ?? 0);
    return {
      sector: r.sector,
      signalCount: r.signal_count,
      upCount: r.up_count ?? 0,
      downCount: r.down_count ?? 0,
      neutralCount: r.neutral_count ?? 0,
      netDirection: r.net_direction ?? 0,
      topEntities: (r.top_entities ?? '').split(',').filter(Boolean),
      hits: sc.hits ?? 0,
      misses: sc.misses ?? 0,
      pushes: sc.pushes ?? 0,
      hitRate: total > 0 ? (sc.hits ?? 0) / total : null,
    };
  });

  return c.json({ days, sectors });
});

export default sectorsRoute;
