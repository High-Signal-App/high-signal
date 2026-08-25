-- Durable receipts for threshold-triggered verification of Digg discoveries.
-- Digg remains attention-only; verification fetches independent original URLs.
ALTER TABLE digg_clusters ADD COLUMN verification_status TEXT
  CHECK (verification_status IN ('requested', 'running', 'verified_candidate', 'insufficient_evidence', 'failed'));
ALTER TABLE digg_clusters ADD COLUMN verification_reason TEXT;
ALTER TABLE digg_clusters ADD COLUMN verification_requested_at INTEGER;
ALTER TABLE digg_clusters ADD COLUMN verification_started_at INTEGER;
ALTER TABLE digg_clusters ADD COLUMN verified_at INTEGER;
ALTER TABLE digg_clusters ADD COLUMN verification_candidate_slug TEXT;
ALTER TABLE digg_clusters ADD COLUMN verification_error TEXT;
ALTER TABLE digg_clusters ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS digg_clusters_verification_status_idx
  ON digg_clusters (verification_status, verification_requested_at);
