/**
 * Per-source rollup of the `events` table (migration 0025).
 *
 * `GET /data/sources` and `GET /data/sources/:id` used to recompute a
 * whole-table aggregate over `events` on every cache miss. On the production
 * 440k-row table that is ~440k rows read per execution (~875k for the grouped
 * variant, which also builds a temp B-tree), and those two routes were ~73M of
 * the database's ~97M D1 rows read per day.
 *
 * This module maintains a tiny materialized table — one row per raw `source`
 * value — and the cron refreshes it. Reads then cost ~55 rows instead of ~440k.
 *
 * Refresh policy:
 *
 *  - Bootstrap performs one covering-index scan to seed existing data.
 *  - Later ticks merge only rows after a stable `(ingested_at, id)` cursor.
 *  - Future-dated rows that became observable are adjusted with a bounded
 *    `published_at` range scan.
 *  - Out-of-band deletes require an explicit repair; a recurring full rebuild
 *    would recreate the D1 cost problem this rollup exists to remove.
 *
 * Staleness bound: served counts are at most one cron interval old (30 min),
 * the same bound the brief precompute already accepts.
 */

import { sql } from 'drizzle-orm';
import type { DB } from '../db';
import { schema } from '../db';

/** The state table holds exactly one row, pinned to this id. */
const EVENTS_ROLLUP_STATE_ID = 1;

export interface EventsRollupState {
  maxIngestedAt: number;
  maxIngestedId: string;
  rebuiltAt: number;
  refreshedAt: number;
}

type RollupRefreshReason = 'bootstrap' | 'new_events' | 'matured_events' | 'unchanged';

export interface RollupRefreshResult {
  rebuilt: boolean;
  reason: RollupRefreshReason;
  sources: number;
  observedAt: number;
}

/** Reads the single control row, or null when the rollup has never been built. */
export async function readEventsRollupState(database: DB): Promise<EventsRollupState | null> {
  const [row] = await database
    .select({
      maxIngestedAt: schema.eventsRollupState.maxIngestedAt,
      maxIngestedId: schema.eventsRollupState.maxIngestedId,
      rebuiltAt: schema.eventsRollupState.rebuiltAt,
      refreshedAt: schema.eventsRollupState.refreshedAt,
    })
    .from(schema.eventsRollupState)
    .where(sql`${schema.eventsRollupState.id} = ${EVENTS_ROLLUP_STATE_ID}`)
    .limit(1);
  return row ?? null;
}

/** True once a rebuild has populated the rollup, so reads may trust it. */
export async function eventsRollupIsReady(database: DB): Promise<boolean> {
  try {
    const state = await readEventsRollupState(database);
    return (state?.rebuiltAt ?? 0) > 0;
  } catch {
    // Migration 0025 not applied yet — callers fall back to the live query.
    return false;
  }
}

interface IngestCursor {
  ingestedAt: number;
  id: string;
}

async function readLatestIngestCursor(database: DB): Promise<IngestCursor> {
  const [row] = await database.all<{ ingestedAt: number; id: string }>(sql`
    SELECT ingested_at AS ingestedAt, id
    FROM events INDEXED BY events_ingested_at_idx
    ORDER BY ingested_at DESC, id DESC
    LIMIT 1`);
  return {
    ingestedAt: Number(row?.ingestedAt ?? 0),
    id: row?.id ?? '',
  };
}

/**
 * Rows whose `published_at` moved from the future into the past since the last
 * rebuild. Those change `latest_observed_at` and `future_count` without any
 * new ingest, so they must force a rebuild.
 */
async function countMaturedSince(database: DB, since: number, now: number): Promise<number> {
  const [row] = await database
    .select({ matured: sql<number>`count(*)` })
    .from(schema.events)
    .where(sql`${schema.events.publishedAt} > ${since} AND ${schema.events.publishedAt} <= ${now}`);
  return Number(row?.matured ?? 0);
}

function decideReason(
  state: EventsRollupState | null,
  cursor: IngestCursor
): RollupRefreshReason | 'check_matured' {
  if (!state || state.rebuiltAt <= 0 || !state.maxIngestedId) return 'bootstrap';
  if (cursor.ingestedAt !== state.maxIngestedAt || cursor.id !== state.maxIngestedId) {
    return 'new_events';
  }
  return 'check_matured';
}

/**
 * Recomputes the rollup when it would change, and records what it reflects.
 *
 * `now` is the instant `latest_observed_at` / `future_count` are evaluated
 * against — the same role `unixepoch()` played in the route aggregates.
 */
export async function refreshEventsSourceRollup(
  env: { DB: D1Database },
  database: DB,
  now: Date = new Date()
): Promise<RollupRefreshResult> {
  const observedAt = Math.floor(now.getTime() / 1000);
  const state = await readEventsRollupState(database);
  const cursor = await readLatestIngestCursor(database);

  let reason = decideReason(state, cursor);
  if (reason === 'check_matured') {
    const matured = await countMaturedSince(database, state?.rebuiltAt ?? 0, observedAt);
    reason = matured > 0 ? 'matured_events' : 'unchanged';
  }

  if (reason === 'unchanged') {
    await env.DB.prepare(
      `UPDATE events_rollup_state SET refreshed_at = ?1 WHERE id = ${EVENTS_ROLLUP_STATE_ID}`
    )
      .bind(observedAt)
      .run();
    return { rebuilt: false, reason, sources: 0, observedAt };
  }

  if (reason === 'bootstrap') {
    // One D1 batch is one transaction, so readers never observe a half-built
    // rollup. This is the only full-table aggregation and runs once after the
    // migration (or during an explicit repair), never on the recurring cron.
    const results = await env.DB.batch([
      env.DB.prepare('DELETE FROM events_source_rollup'),
      env.DB.prepare(
        `INSERT INTO events_source_rollup
         (source, event_count, latest_observed_at, last_ingested_at, future_count, refreshed_at)
       SELECT source,
              count(*),
              max(case when published_at <= ?1 then published_at end),
              max(ingested_at),
              sum(case when published_at > ?1 then 1 else 0 end),
              ?1
       FROM events
       -- d1-scan: reviewed-unbounded issue=#145 reason=one-time rollup bootstrap or explicit repair only
       GROUP BY source`
      ).bind(observedAt),
      env.DB.prepare(
        `INSERT INTO events_rollup_state
           (id, max_ingested_at, max_ingested_id, rebuilt_at, refreshed_at)
       VALUES (${EVENTS_ROLLUP_STATE_ID}, ?1, ?2, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET
         max_ingested_at = excluded.max_ingested_at,
         max_ingested_id = excluded.max_ingested_id,
         rebuilt_at = excluded.rebuilt_at,
         refreshed_at = excluded.refreshed_at`
      ).bind(cursor.ingestedAt, cursor.id, observedAt),
    ]);
    const written = results[1]?.meta?.rows_written;
    return {
      rebuilt: true,
      reason,
      sources: typeof written === 'number' ? written : 0,
      observedAt,
    };
  }

  const previous = state as EventsRollupState;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events_source_rollup
         (source, event_count, latest_observed_at, last_ingested_at, future_count, refreshed_at)
       SELECT source,
              count(*),
              max(case when published_at <= ?1 then published_at end),
              max(ingested_at),
              sum(case when published_at > ?1 then 1 else 0 end),
              ?1
       FROM events INDEXED BY events_ingested_at_idx
       WHERE ingested_at > ?2 OR (ingested_at = ?2 AND id > ?3)
       GROUP BY source
       ON CONFLICT(source) DO UPDATE SET
         event_count = events_source_rollup.event_count + excluded.event_count,
         latest_observed_at = CASE
           WHEN events_source_rollup.latest_observed_at IS NULL THEN excluded.latest_observed_at
           WHEN excluded.latest_observed_at IS NULL THEN events_source_rollup.latest_observed_at
           ELSE max(events_source_rollup.latest_observed_at, excluded.latest_observed_at)
         END,
         last_ingested_at = max(events_source_rollup.last_ingested_at, excluded.last_ingested_at),
         future_count = events_source_rollup.future_count + excluded.future_count,
         refreshed_at = excluded.refreshed_at`
    ).bind(observedAt, previous.maxIngestedAt, previous.maxIngestedId),
    env.DB.prepare(
      `INSERT INTO events_source_rollup
         (source, event_count, latest_observed_at, last_ingested_at, future_count, refreshed_at)
       SELECT source, 0, max(published_at), max(ingested_at), -count(*), ?1
       FROM events
       WHERE published_at > ?2 AND published_at <= ?1
         AND (ingested_at < ?3 OR (ingested_at = ?3 AND id <= ?4))
       GROUP BY source
       ON CONFLICT(source) DO UPDATE SET
         latest_observed_at = CASE
           WHEN events_source_rollup.latest_observed_at IS NULL THEN excluded.latest_observed_at
           ELSE max(events_source_rollup.latest_observed_at, excluded.latest_observed_at)
         END,
         future_count = max(0, events_source_rollup.future_count + excluded.future_count),
         refreshed_at = excluded.refreshed_at`
    ).bind(observedAt, previous.rebuiltAt, previous.maxIngestedAt, previous.maxIngestedId),
    env.DB.prepare(
      `UPDATE events_rollup_state
       SET max_ingested_at = ?1,
           max_ingested_id = ?2,
           rebuilt_at = ?3,
           refreshed_at = ?3
       WHERE id = ${EVENTS_ROLLUP_STATE_ID}`
    ).bind(cursor.ingestedAt, cursor.id, observedAt),
  ]);

  const touched = results.slice(0, 2).reduce((sum, result) => {
    const rows = result?.meta?.rows_written;
    return sum + (typeof rows === 'number' ? rows : 0);
  }, 0);
  return {
    rebuilt: true,
    reason,
    sources: touched,
    observedAt,
  };
}
