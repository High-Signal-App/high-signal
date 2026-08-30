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
 *  - A rebuild is a full recompute. There is no incremental merge, so the
 *    rollup can never drift away from `events`.
 *  - A tick that would recompute the identical answer is skipped. That is
 *    decided from two O(1)-ish probes: the table's `max(ingested_at)` (an
 *    index max) and whether any row's `published_at` crossed "now" since the
 *    last rebuild (a bounded range scan of the maturation window). If neither
 *    changed, every per-source aggregate is provably unchanged.
 *  - A rebuild is forced anyway once `ROLLUP_MAX_AGE_SECONDS` has passed, so
 *    an out-of-band `DELETE FROM events` (the documented ingest escape hatch)
 *    self-heals instead of leaving the rollup wrong indefinitely.
 *
 * Staleness bound: served counts are at most one cron interval old (30 min),
 * the same bound the brief precompute already accepts.
 */

import { sql } from 'drizzle-orm';
import type { DB } from '../db';
import { schema } from '../db';

/** The state table holds exactly one row, pinned to this id. */
const EVENTS_ROLLUP_STATE_ID = 1;

/** Force a rebuild at least this often even when nothing looks changed. */
export const ROLLUP_MAX_AGE_SECONDS = 6 * 60 * 60;

export interface EventsRollupState {
  maxIngestedAt: number;
  rebuiltAt: number;
  refreshedAt: number;
}

type RollupRefreshReason = 'bootstrap' | 'new_events' | 'matured_events' | 'max_age' | 'unchanged';

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

async function readMaxIngestedAt(database: DB): Promise<number> {
  const [row] = await database
    .select({ maxIngestedAt: sql<number | null>`max(${schema.events.ingestedAt})` })
    .from(schema.events);
  return Number(row?.maxIngestedAt ?? 0);
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
  maxIngestedAt: number,
  now: number
): RollupRefreshReason | 'check_matured' {
  if (!state || state.rebuiltAt <= 0) return 'bootstrap';
  if (maxIngestedAt !== state.maxIngestedAt) return 'new_events';
  if (now - state.rebuiltAt >= ROLLUP_MAX_AGE_SECONDS) return 'max_age';
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
  const maxIngestedAt = await readMaxIngestedAt(database);

  let reason = decideReason(state, maxIngestedAt, observedAt);
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

  // One D1 batch is one transaction, so readers never observe a half-built
  // rollup: the delete, the recompute, and the control row land together.
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
       GROUP BY source`
    ).bind(observedAt),
    env.DB.prepare(
      `INSERT INTO events_rollup_state (id, max_ingested_at, rebuilt_at, refreshed_at)
       VALUES (${EVENTS_ROLLUP_STATE_ID}, ?1, ?2, ?2)
       ON CONFLICT(id) DO UPDATE SET
         max_ingested_at = excluded.max_ingested_at,
         rebuilt_at = excluded.rebuilt_at,
         refreshed_at = excluded.refreshed_at`
    ).bind(maxIngestedAt, observedAt),
  ]);

  const written = results[1]?.meta?.rows_written;
  return {
    rebuilt: true,
    reason,
    sources: typeof written === 'number' ? written : 0,
    observedAt,
  };
}
