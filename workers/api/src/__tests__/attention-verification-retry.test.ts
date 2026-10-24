import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTENTION_VERIFICATION_ELIGIBILITY_SQL,
  recordVerificationResults,
} from '../lib/attention-admin';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';

type Table = 'digg_clusters' | 'mts_situations';
const tables = ['digg_clusters', 'mts_situations'] as const;
const idColumn = (table: Table): 'short_id' | 'situation_id' =>
  table === 'digg_clusters' ? 'short_id' : 'situation_id';
let database: TestD1 | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
  vi.restoreAllMocks();
});

async function seed(
  table: Table,
  id: string,
  status: string,
  attempts: number,
  startedAt: number | null
) {
  const now = Math.floor(Date.now() / 1000);
  if (table === 'digg_clusters') {
    await database!.binding
      .prepare(`INSERT INTO digg_clusters
      (short_id,source_id,canonical_digg_url,title,first_seen_at,retrieved_at,raw_payload_hash,raw_payload)
      VALUES(?,?,'https://digg.com/ai/test','Public discovery',?,?,'hash','{}')`)
      .bind(id, id, now, now)
      .run();
  } else {
    await database!.binding
      .prepare(`INSERT INTO mts_situations
      (situation_id,canonical_mts_url,title,first_seen_at,retrieved_at,payload_hash)
      VALUES(?,'https://mts.now/situation/test','Public discovery',?,?,'hash')`)
      .bind(id, now, now)
      .run();
  }
  await database!.binding
    .prepare(`UPDATE ${table} SET verification_status=?,
    verification_attempts=?,verification_started_at=? WHERE ${idColumn(table)}=?`)
    .bind(status, attempts, startedAt, id)
    .run();
}

async function eligible(table: Table, now: number) {
  // Only the SQLite clock expression changes; both production queue queries
  // use this exact shared eligibility predicate.
  const predicate = ATTENTION_VERIFICATION_ELIGIBILITY_SQL.replaceAll('unixepoch()', String(now));
  const result = await database!.binding
    .prepare(`SELECT ${idColumn(table)} AS id FROM ${table}
    WHERE ${predicate} ORDER BY ${idColumn(table)}`)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

describe.each(tables)('%s verification recovery against actual SQLite', (table) => {
  it('keeps initial retries, uses six-hour spacing after the cap, and excludes verified candidates', async () => {
    database = createSqliteD1();
    applyMigrations(database);
    const now = Math.floor(Date.now() / 1000);
    await seed(table, 'initial-failed', 'failed', 2, now);
    await seed(table, 'initial-running-blocked', 'running', 2, now - 2699);
    await seed(table, 'initial-running-stale', 'running', 2, now - 2700);
    await seed(table, 'capped-failed-blocked', 'failed', 3, now - 21599);
    await seed(table, 'capped-failed-ready', 'failed', 3, now - 21600);
    await seed(table, 'capped-insufficient-ready', 'insufficient_evidence', 4, now - 21600);
    await seed(table, 'capped-running-blocked', 'running', 3, now - 2700);
    await seed(table, 'capped-running-ready', 'running', 3, now - 21600);
    await seed(table, 'capped-stale-feed', 'failed', 3, now - 86400);
    await seed(table, 'capped-unknown-start', 'failed', 3, null);
    await seed(table, 'initial-stale-feed', 'failed', 2, now - 86400);
    await database.binding
      .prepare(`UPDATE ${table} SET retrieved_at=? WHERE ${idColumn(table)} IN (?,?)`)
      .bind(now - 86401, 'capped-stale-feed', 'initial-stale-feed')
      .run();
    await seed(table, 'verified-initial', 'verified_candidate', 2, now - 86400);
    await seed(table, 'verified-capped', 'verified_candidate', 4, now - 86400);
    expect(await eligible(table, now)).toEqual([
      'capped-failed-ready',
      'capped-insufficient-ready',
      'capped-running-ready',
      'initial-failed',
      'initial-running-stale',
      'initial-stale-feed',
    ]);
  });

  it('increments lifetime attempts and refreshes the running timestamp before enforcing the next cooldown', async () => {
    database = createSqliteD1();
    applyMigrations(database);
    const now = Math.floor(Date.now() / 1000);
    await seed(table, 'retry', 'failed', 3, now - 21600);
    expect(await eligible(table, now)).toEqual(['retry']);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    await recordVerificationResults(database.binding, table, idColumn(table), [
      { shortId: 'retry', status: 'running' },
    ]);
    expect(
      await database.binding
        .prepare(`SELECT verification_attempts,verification_started_at FROM ${table}`)
        .first()
    ).toEqual({ verification_attempts: 4, verification_started_at: now });
    expect(await eligible(table, now + 2700)).toEqual([]);
    expect(await eligible(table, now + 21599)).toEqual([]);
    await recordVerificationResults(database.binding, table, idColumn(table), [
      { shortId: 'retry', status: 'failed' },
    ]);
    expect(await eligible(table, now + 21599)).toEqual([]);
    expect(await eligible(table, now + 21600)).toEqual(['retry']);
    clock.mockReturnValue((now + 21600) * 1000);
    await recordVerificationResults(database.binding, table, idColumn(table), [
      { shortId: 'retry', status: 'running' },
    ]);
    expect(
      await database.binding
        .prepare(`SELECT verification_attempts,verification_started_at FROM ${table}`)
        .first()
    ).toEqual({ verification_attempts: 5, verification_started_at: now + 21600 });
    expect(await eligible(table, now + 21601)).toEqual([]);
    await recordVerificationResults(database.binding, table, idColumn(table), [
      { shortId: 'retry', status: 'verified_candidate', candidateSlug: 'proven-candidate' },
    ]);
    expect(await eligible(table, now + 86400)).toEqual([]);
  });
});
