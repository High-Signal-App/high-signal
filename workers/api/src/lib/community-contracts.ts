/**
 * Shared row→contract mappers for the community lens.
 *
 * The community surface is split across two routers: public digest reads live
 * in routes/products.ts, and the operator-only tracked-community registry lives
 * in routes/admin.ts (behind the ADMIN_TOKEN bearer). Both need these mappers,
 * so they live here rather than being duplicated or exported across routers.
 */

import { normalizeCommunitySummary } from '@high-signal/shared';
import type { CommunityDigestSnapshot, TrackedCommunity } from '@high-signal/shared';
import { schema } from '../db';

export function toTrackedCommunity(
  row: typeof schema.trackedCommunities.$inferSelect
): TrackedCommunity {
  return {
    id: row.id,
    ownerId: row.ownerId,
    subreddit: row.subreddit,
    prompt: row.prompt,
    period: row.period,
    isPublic: row.isPublic,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCommunityDigestSnapshot(
  row: typeof schema.communityDigestSnapshots.$inferSelect
): CommunityDigestSnapshot {
  return {
    id: row.id,
    subreddit: row.subreddit,
    period: row.period,
    snapshotDate: row.snapshotDate.toISOString(),
    summaryText: row.summaryText,
    summary: normalizeCommunitySummary(row.summary),
    promptUsed: row.promptUsed,
    sourceCount: row.sourceCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function isRedditPeriod(value: string): value is 'day' | 'week' | 'month' {
  return ['day', 'week', 'month'].includes(value);
}

export function clampedLimit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}
