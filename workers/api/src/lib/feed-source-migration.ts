/** Runtime mirror of migration 0030; its parity test keeps the SQL file canonical. */
export const FEED_SOURCE_MIGRATION = {
  name: '0030_feed_sources.sql',
  sql: `CREATE TABLE feed_sources (
  id TEXT PRIMARY KEY NOT NULL,
  url TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('rss', 'atom')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_key TEXT NOT NULL,
  last_validated_at INTEGER NOT NULL,
  last_fetched_at INTEGER,
  last_fetch_count INTEGER CHECK (last_fetch_count >= 0),
  last_fetch_error TEXT,
  last_published_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);`,
} as const;

// Validate the expected shape before recording success, including on retries.
const CHECK_SCHEMA = `SELECT id, url, feed_url, title, format, enabled, source_key,
  last_validated_at, last_fetched_at, last_fetch_count, last_fetch_error,
  last_published_at, created_at, updated_at FROM feed_sources LIMIT 0`;

/** Exactly one additive migration through the Worker's existing authorized D1 binding. */
export async function initializeFeedSourceSchema(binding: D1Database): Promise<boolean> {
  const recorded = await binding
    .prepare('SELECT id FROM d1_migrations WHERE name = ? LIMIT 1')
    .bind(FEED_SOURCE_MIGRATION.name)
    .first();
  if (recorded) {
    // Missing schema after a recorded migration is drift, not a fresh database.
    // Recreating an empty registry here could silently resume paused sources.
    await binding.prepare(CHECK_SCHEMA).all();
    return false;
  }
  const results = await binding.batch([
    binding.prepare(
      FEED_SOURCE_MIGRATION.sql.replace(
        'CREATE TABLE feed_sources',
        'CREATE TABLE IF NOT EXISTS feed_sources'
      )
    ),
    binding.prepare(CHECK_SCHEMA),
    binding
      .prepare(`INSERT INTO d1_migrations (name)
      SELECT ? WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = ?)`)
      .bind(FEED_SOURCE_MIGRATION.name, FEED_SOURCE_MIGRATION.name),
  ]);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}
