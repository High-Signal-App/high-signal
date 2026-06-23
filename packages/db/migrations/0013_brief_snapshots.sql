-- Precomputed daily brief snapshots, populated by cron.
-- Eliminates 5-14 sequential D1 queries per /brief/daily request.
CREATE TABLE IF NOT EXISTS daily_brief_snapshots (
  date TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  brief_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (date, region)
);

-- Precomputed signal hit rates per type/family, refreshed hourly.
CREATE TABLE IF NOT EXISTS signal_hit_rate_cache (
  signal_type TEXT NOT NULL,
  family TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  pushes INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (signal_type, family)
);
