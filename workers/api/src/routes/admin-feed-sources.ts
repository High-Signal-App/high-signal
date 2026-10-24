import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import {
  addFeedSourceInputSchema,
  feedFetchResultSchema,
  updateFeedSourceInputSchema,
  type FeedSource,
} from '@high-signal/shared';
import { db, schema } from '../db';
import { sha16 } from '../lib/ids';
import {
  FEED_SOURCE_MIGRATION,
  FEED_SOURCE_ARCHIVE_MIGRATION,
  initializeFeedSourceSchema,
} from '../lib/feed-source-migration';
import { discoverPublicFeed, publicFeedIdentity, PublicFeedError } from '../lib/public-feeds';

type Env = { DB: D1Database };
type FeedRow = typeof schema.feedSources.$inferSelect;

function seconds(value: Date | null): number | null {
  return value === null ? null : Math.floor(value.getTime() / 1000);
}

function toFeedSource(row: FeedRow): FeedSource {
  return {
    id: row.id,
    url: row.url,
    feedUrl: row.feedUrl,
    title: row.title,
    format: row.format,
    enabled: row.enabled,
    sourceKey: row.sourceKey,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    lastValidatedAt: Math.floor(row.lastValidatedAt.getTime() / 1000),
    lastFetchedAt: seconds(row.lastFetchedAt),
    lastFetchCount: row.lastFetchCount,
    lastFetchError: row.lastFetchError,
    lastPublishedAt: seconds(row.lastPublishedAt),
  };
}

// Mounted only below adminRoute's bearer-token middleware.
export const feedSourcesAdminRoute = new Hono<{ Bindings: Env }>();
feedSourcesAdminRoute.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

const initializationInput = z
  .object({ migration: z.enum([FEED_SOURCE_MIGRATION.name, FEED_SOURCE_ARCHIVE_MIGRATION.name]) })
  .strict();

// Fixed release operations: callers select only a compiled, named feed-registry migration.
feedSourcesAdminRoute.post('/initialize', async (c) => {
  const parsed = initializationInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_feed_initialization' }, 400);
  try {
    const applied = await initializeFeedSourceSchema(c.env.DB, parsed.data.migration);
    return c.json({ ok: true, migration: parsed.data.migration, applied });
  } catch {
    return c.json({ error: 'feed_initialization_failed' }, 503);
  }
});

feedSourcesAdminRoute.get('/', async (c) => {
  const rows = await db(c.env.DB)
    .select()
    .from(schema.feedSources)
    .orderBy(desc(schema.feedSources.createdAt))
    .limit(500);
  return c.json({ sources: rows.map(toFeedSource) });
});

feedSourcesAdminRoute.post('/', async (c) => {
  const parsed = addFeedSourceInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'invalid_source', message: 'Enter a website or feed URL.' }, 400);
  try {
    const feed = await discoverPublicFeed(parsed.data.url);
    const database = db(c.env.DB);
    const id = `feed-${await sha16(publicFeedIdentity(feed.feedUrl))}`;
    const existing = await database
      .select({ id: schema.feedSources.id })
      .from(schema.feedSources)
      .limit(500);
    if (existing.length >= 500 && !existing.some((row) => row.id === id)) {
      return c.json(
        { error: 'source_limit', message: 'The publication feed registry is full.' },
        409
      );
    }
    const now = new Date();
    const metadata = {
      feedUrl: feed.feedUrl,
      title: feed.title,
      format: feed.format,
      lastValidatedAt: now,
      ...(feed.lastPublishedAt === null
        ? {}
        : { lastPublishedAt: new Date(feed.lastPublishedAt * 1000) }),
    };
    const [inserted] = await database
      .insert(schema.feedSources)
      .values({
        id,
        url: feed.url,
        sourceKey: `news:${id}`,
        ...metadata,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted)
      return c.json(
        { source: toFeedSource(inserted), created: true, articleCount: feed.articleCount },
        201
      );
    const [updated] = await database
      .update(schema.feedSources)
      .set({ ...metadata, updatedAt: now })
      .where(eq(schema.feedSources.id, id))
      .returning();
    if (!updated) return c.json({ error: 'source_unavailable' }, 503);
    return c.json({
      source: toFeedSource(updated),
      created: false,
      articleCount: feed.articleCount,
    });
  } catch (error) {
    if (error instanceof PublicFeedError)
      return c.json({ error: 'feed_unavailable', message: error.message }, 400);
    return c.json(
      {
        error: 'feed_check_failed',
        message: 'Could not check or save this feed. Please try again.',
      },
      503
    );
  }
});

feedSourcesAdminRoute.patch('/:id', async (c) => {
  const parsed = updateFeedSourceInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_source_update' }, 400);
  const [row] = await db(c.env.DB)
    .update(schema.feedSources)
    .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
    .where(eq(schema.feedSources.id, c.req.param('id')))
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ source: toFeedSource(row) });
});

/** Collection receipts are separate from URL validation and publication approval. */
feedSourcesAdminRoute.post('/:id/fetch-result', async (c) => {
  const parsed = feedFetchResultSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.fetchedAt > Math.floor(Date.now() / 1000) + 300) {
    return c.json({ error: 'invalid_fetch_result' }, 400);
  }
  const result = parsed.data;
  const fetchedAt = new Date(result.fetchedAt * 1000);
  const [row] = await db(c.env.DB)
    .update(schema.feedSources)
    .set({
      sourceKey: result.sourceKey,
      lastFetchedAt: fetchedAt,
      lastFetchCount: result.count,
      lastFetchError: result.error,
      ...(result.lastPublishedAt === null
        ? {}
        : { lastPublishedAt: new Date(result.lastPublishedAt * 1000) }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.feedSources.id, c.req.param('id')),
        or(
          isNull(schema.feedSources.lastFetchedAt),
          lte(schema.feedSources.lastFetchedAt, fetchedAt)
        )
      )
    )
    .returning();
  return c.json({ ok: true, applied: Boolean(row) });
});
