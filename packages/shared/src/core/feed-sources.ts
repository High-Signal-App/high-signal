import { z } from 'zod';

export const feedSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  feedUrl: z.string().url(),
  title: z.string(),
  format: z.enum(['rss', 'atom']),
  enabled: z.boolean(),
  sourceKey: z.string(),
  createdAt: z.number().int(),
  lastValidatedAt: z.number().int(),
  lastFetchedAt: z.number().int().nullable(),
  lastFetchCount: z.number().int().nonnegative().nullable(),
  lastFetchError: z.string().nullable(),
  lastPublishedAt: z.number().int().nullable(),
});

export type FeedSource = z.infer<typeof feedSourceSchema>;
export const feedSourceResponseSchema = z.object({ source: feedSourceSchema });
export const feedSourceErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export const feedSourcesResponseSchema = z.object({ sources: z.array(feedSourceSchema) });
export const addFeedSourceInputSchema = z
  .object({ url: z.string().trim().min(1).max(2048) })
  .strict();
export const addFeedSourceResponseSchema = z.object({
  source: feedSourceSchema,
  created: z.boolean(),
  articleCount: z.number().int().nonnegative(),
});
export const updateFeedSourceInputSchema = z.object({ enabled: z.boolean() }).strict();
export const feedFetchResultSchema = z
  .object({
    sourceKey: z
      .string()
      .regex(/^news:[a-zA-Z0-9_.-]+$/)
      .max(200),
    fetchedAt: z.number().int().positive(),
    count: z.number().int().min(0).max(5000),
    error: z.string().max(200).nullable(),
    lastPublishedAt: z.number().int().nullable(),
  })
  .strict();
