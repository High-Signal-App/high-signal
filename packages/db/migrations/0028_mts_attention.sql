-- MTS Situations is a derived attention aggregator. It may influence discovery
-- and prominence, but never counts as evidence or changes confidence.
CREATE TABLE IF NOT EXISTS mts_feed_state (
  feed_key TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT NOT NULL,
  last_retrieved_at INTEGER NOT NULL,
  last_payload_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mts_feed_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  feed_key TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  retrieved_at INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS mts_feed_snapshots_observation_idx
  ON mts_feed_snapshots (feed_key, retrieved_at, payload_hash);
CREATE INDEX IF NOT EXISTS mts_feed_snapshots_retrieved_idx
  ON mts_feed_snapshots (retrieved_at);

CREATE TABLE IF NOT EXISTS mts_situations (
  situation_id TEXT PRIMARY KEY NOT NULL,
  canonical_mts_url TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  retrieved_at INTEGER NOT NULL,
  position INTEGER,
  position_delta INTEGER,
  peak_position INTEGER,
  rank_score REAL,
  criticality TEXT,
  lifecycle TEXT,
  event_type TEXT,
  genre TEXT,
  confirmation_inferred INTEGER NOT NULL DEFAULT 0,
  entities TEXT NOT NULL DEFAULT '[]',
  topics TEXT NOT NULL DEFAULT '[]',
  source_references TEXT NOT NULL DEFAULT '[]',
  distinct_source_count INTEGER NOT NULL DEFAULT 0,
  attention_metrics TEXT NOT NULL DEFAULT '{}',
  primary_entity_id TEXT REFERENCES entities(id),
  source_class TEXT NOT NULL DEFAULT 'attention_aggregator'
    CHECK (source_class = 'attention_aggregator'),
  evidence_tier TEXT NOT NULL DEFAULT 'derived'
    CHECK (evidence_tier = 'derived'),
  confidence_contribution TEXT NOT NULL DEFAULT 'none'
    CHECK (confidence_contribution = 'none'),
  attention_contribution TEXT NOT NULL DEFAULT 'allowed'
    CHECK (attention_contribution = 'allowed'),
  verification_status TEXT
    CHECK (verification_status IN ('requested', 'running', 'verified_candidate', 'insufficient_evidence', 'failed')),
  verification_reason TEXT,
  verification_requested_at INTEGER,
  verification_started_at INTEGER,
  verified_at INTEGER,
  verification_candidate_slug TEXT,
  verification_error TEXT,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mts_situations_retrieved_idx ON mts_situations (retrieved_at);
CREATE INDEX IF NOT EXISTS mts_situations_position_idx ON mts_situations (position);
CREATE INDEX IF NOT EXISTS mts_situations_entity_idx ON mts_situations (primary_entity_id);
CREATE INDEX IF NOT EXISTS mts_situations_verification_status_idx
  ON mts_situations (verification_status, verification_requested_at);

CREATE TABLE IF NOT EXISTS mts_situation_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  situation_id TEXT NOT NULL REFERENCES mts_situations(situation_id) ON DELETE CASCADE,
  retrieved_at INTEGER NOT NULL,
  position INTEGER,
  position_delta INTEGER,
  peak_position INTEGER,
  rank_score REAL,
  distinct_source_count INTEGER NOT NULL DEFAULT 0,
  attention_metrics TEXT NOT NULL DEFAULT '{}',
  payload_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mts_situation_snapshots_observation_idx
  ON mts_situation_snapshots (situation_id, retrieved_at, payload_hash);
CREATE INDEX IF NOT EXISTS mts_situation_snapshots_situation_retrieved_idx
  ON mts_situation_snapshots (situation_id, retrieved_at);

CREATE TABLE IF NOT EXISTS mts_signal_links (
  situation_id TEXT NOT NULL REFERENCES mts_situations(situation_id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id),
  match_basis TEXT NOT NULL CHECK (match_basis IN ('evidence_url', 'entity')),
  match_confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (situation_id, signal_id)
);
CREATE INDEX IF NOT EXISTS mts_signal_links_signal_idx ON mts_signal_links (signal_id);
CREATE INDEX IF NOT EXISTS mts_signal_links_entity_idx ON mts_signal_links (entity_id);
