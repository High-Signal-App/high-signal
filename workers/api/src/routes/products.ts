/**
 * Community evidence consumed by the Daily Brief.
 *
 * This file used to host Mentions, Agent Eval history, and a per-owner product
 * dashboard. Those were removed when High Signal went fully public — see the
 * ADR on removing per-user features. Everything left here is anonymous and
 * cacheable.
 *
 * The operator-only tracked-community registry that produces these digests
 * moved to routes/admin.ts, behind the ADMIN_TOKEN bearer.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import {
  clampedLimit,
  isRedditPeriod,
  toCommunityDigestSnapshot,
} from '../lib/community-contracts';

type Env = { DB: D1Database };

export const productsRoute = new Hono<{ Bindings: Env }>();

function publicDigestRows(
  database: ReturnType<typeof db>,
  period: 'day' | 'week' | 'month',
  limit: number,
  subreddit?: string
) {
  const conditions = [
    eq(schema.trackedCommunities.isPublic, true),
    eq(schema.communityDigestSnapshots.period, period),
  ];
  if (subreddit) {
    conditions.push(eq(schema.communityDigestSnapshots.subreddit, subreddit));
  }

  return database
    .select({ digest: schema.communityDigestSnapshots })
    .from(schema.communityDigestSnapshots)
    .innerJoin(
      schema.trackedCommunities,
      eq(schema.communityDigestSnapshots.trackedCommunityId, schema.trackedCommunities.id)
    )
    .where(and(...conditions))
    .orderBy(desc(schema.communityDigestSnapshots.snapshotDate))
    .limit(limit);
}

productsRoute.get('/communities/:subreddit/:period/digests', async (c) => {
  const subreddit = c.req.param('subreddit');
  const period = c.req.param('period');
  if (!isRedditPeriod(period)) return c.json({ error: 'invalid_period' }, 400);

  const rows = await publicDigestRows(
    db(c.env.DB),
    period,
    clampedLimit(c.req.query('limit'), 12, 50),
    subreddit
  );

  return c.json({ digests: rows.map((row) => toCommunityDigestSnapshot(row.digest)) });
});

productsRoute.get('/communities/discover', async (c) => {
  const period = c.req.query('period') ?? 'week';
  if (!isRedditPeriod(period)) return c.json({ error: 'invalid_period' }, 400);

  const rows = await publicDigestRows(
    db(c.env.DB),
    period,
    clampedLimit(c.req.query('limit'), 25, 100)
  );

  return c.json({ items: rows.map((row) => toCommunityDigestSnapshot(row.digest)) });
});
