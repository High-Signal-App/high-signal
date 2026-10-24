CREATE TABLE feed_sources_archive_upgrade (
  id TEXT PRIMARY KEY NOT NULL,
  url TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('rss', 'atom', 'archive')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_key TEXT NOT NULL,
  last_validated_at INTEGER NOT NULL,
  last_fetched_at INTEGER,
  last_fetch_count INTEGER CHECK (last_fetch_count >= 0),
  last_fetch_error TEXT,
  last_published_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO feed_sources_archive_upgrade (id, url, feed_url, title, format, enabled, source_key, last_validated_at, last_fetched_at, last_fetch_count, last_fetch_error, last_published_at, created_at, updated_at)
SELECT id, url, feed_url, title, format, enabled, source_key, last_validated_at, last_fetched_at, last_fetch_count, last_fetch_error, last_published_at, created_at, updated_at FROM feed_sources;
DROP TABLE feed_sources;
ALTER TABLE feed_sources_archive_upgrade RENAME TO feed_sources;
