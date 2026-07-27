import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db';

type Env = { DB: D1Database };

export const marketsRoute = new Hono<{ Bindings: Env }>();

// Full quote history for a single entity. Use ?entity=<id>.
marketsRoute.get('/', async (c) => {
  const entity = c.req.query('entity');
  if (!entity) return c.json({ error: 'missing_entity' }, 400);

  const rows = await db(c.env.DB)
    .select()
    .from(schema.marketQuotes)
    .where(eq(schema.marketQuotes.entityId, entity))
    .orderBy(desc(schema.marketQuotes.fetchedAt));

  return c.json({ entity, quotes: rows });
});
