-- Digg is a derived attention aggregator. It may influence discovery and
-- prominence, but never counts as evidence or changes confidence.
CREATE TABLE IF NOT EXISTS digg_feed_state (
  feed_kind TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT NOT NULL,
  last_retrieved_at INTEGER NOT NULL,
  last_generated_at INTEGER,
  last_raw_payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digg_feed_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  feed_kind TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  generated_at INTEGER,
  retrieved_at INTEGER NOT NULL,
  raw_payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS digg_feed_snapshots_observation_idx
  ON digg_feed_snapshots (feed_kind, retrieved_at, raw_payload_hash);
CREATE INDEX IF NOT EXISTS digg_feed_snapshots_retrieved_idx
  ON digg_feed_snapshots (retrieved_at);

CREATE TABLE IF NOT EXISTS digg_clusters (
  short_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  canonical_digg_url TEXT NOT NULL,
  title TEXT NOT NULL,
  digg_summary TEXT,
  created_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  retrieved_at INTEGER NOT NULL,
  position INTEGER,
  position_delta INTEGER,
  peak_position INTEGER,
  entry_status TEXT,
  badges TEXT NOT NULL DEFAULT '[]',
  source_posts TEXT NOT NULL DEFAULT '[]',
  source_urls TEXT NOT NULL DEFAULT '[]',
  contributing_accounts TEXT NOT NULL DEFAULT '[]',
  distinct_account_count INTEGER NOT NULL DEFAULT 0,
  primary_entity_id TEXT REFERENCES entities(id),
  source_class TEXT NOT NULL DEFAULT 'attention_aggregator'
    CHECK (source_class = 'attention_aggregator'),
  evidence_tier TEXT NOT NULL DEFAULT 'derived'
    CHECK (evidence_tier = 'derived'),
  confidence_contribution TEXT NOT NULL DEFAULT 'none'
    CHECK (confidence_contribution = 'none'),
  attention_contribution TEXT NOT NULL DEFAULT 'allowed'
    CHECK (attention_contribution = 'allowed'),
  external_generated_analysis TEXT,
  raw_payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS digg_clusters_retrieved_idx ON digg_clusters (retrieved_at);
CREATE INDEX IF NOT EXISTS digg_clusters_position_idx ON digg_clusters (position);
CREATE INDEX IF NOT EXISTS digg_clusters_entity_idx ON digg_clusters (primary_entity_id);

CREATE TABLE IF NOT EXISTS digg_cluster_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  short_id TEXT NOT NULL REFERENCES digg_clusters(short_id) ON DELETE CASCADE,
  feed_kind TEXT NOT NULL,
  generated_at INTEGER,
  retrieved_at INTEGER NOT NULL,
  position INTEGER,
  position_delta INTEGER,
  peak_position INTEGER,
  distinct_account_count INTEGER NOT NULL DEFAULT 0,
  attention_metrics TEXT NOT NULL DEFAULT '{}',
  raw_payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS digg_cluster_snapshots_observation_idx
  ON digg_cluster_snapshots (short_id, feed_kind, retrieved_at, raw_payload_hash);
CREATE INDEX IF NOT EXISTS digg_cluster_snapshots_short_retrieved_idx
  ON digg_cluster_snapshots (short_id, retrieved_at);

CREATE TABLE IF NOT EXISTS digg_signal_links (
  short_id TEXT NOT NULL REFERENCES digg_clusters(short_id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id),
  match_basis TEXT NOT NULL CHECK (match_basis IN ('evidence_url', 'entity')),
  match_confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (short_id, signal_id)
);
CREATE INDEX IF NOT EXISTS digg_signal_links_signal_idx ON digg_signal_links (signal_id);
CREATE INDEX IF NOT EXISTS digg_signal_links_entity_idx ON digg_signal_links (entity_id);
