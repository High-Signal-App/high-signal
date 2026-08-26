import { Hono } from 'hono';
import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { recentHistoryStart } from '@high-signal/shared';
import { db, schema } from '../db';

type Env = { DB: D1Database };

export const entitiesRoute = new Hono<{ Bindings: Env }>();

entitiesRoute.get('/', async (c) => {
  const sector = c.req.query('sector');
  const q = db(c.env.DB).select().from(schema.entities);
  const rows = sector ? await q.where(eq(schema.entities.sector, sector)) : await q;
  return c.json({ entities: rows });
});

entitiesRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [entity] = await db(c.env.DB)
    .select()
    .from(schema.entities)
    .where(eq(schema.entities.id, id))
    .limit(1);
  if (!entity) return c.json({ error: 'not_found' }, 404);

  const rels = await db(c.env.DB)
    .select()
    .from(schema.relationships)
    .where(or(eq(schema.relationships.fromEntityId, id), eq(schema.relationships.toEntityId, id)));

  const signals = await db(c.env.DB)
    .select()
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.primaryEntityId, id),
        eq(schema.signals.reviewStatus, 'published'),
        sql`${schema.signals.bodyMd} NOT LIKE '> _backfill_%'`,
        gte(schema.signals.publishedAt, recentHistoryStart())
      )
    )
    .orderBy(desc(schema.signals.publishedAt))
    .limit(20);

  const marketQuotes = await db(c.env.DB)
    .select()
    .from(schema.marketQuotes)
    .where(eq(schema.marketQuotes.entityId, id))
    .orderBy(desc(schema.marketQuotes.fetchedAt))
    .limit(10);

  return c.json({ entity, relationships: rels, signals, marketQuotes });
});
