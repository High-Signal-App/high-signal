-- Separate observations from inference and make claim corroboration origin-aware.
ALTER TABLE signals ADD COLUMN observed_event TEXT;
ALTER TABLE signals ADD COLUMN direct_entity_impact TEXT;
ALTER TABLE signals ADD COLUMN supply_chain_impact TEXT;
ALTER TABLE signals ADD COLUMN business_inference TEXT;
ALTER TABLE signals ADD COLUMN inference_strength TEXT
  CHECK (inference_strength IN ('none', 'weak', 'moderate', 'strong'));
ALTER TABLE signals ADD COLUMN inference_evidence_urls TEXT NOT NULL DEFAULT '[]';

ALTER TABLE claim_records ADD COLUMN claim_entity_id TEXT;
ALTER TABLE claim_records ADD COLUMN claim_event TEXT;
ALTER TABLE claim_records ADD COLUMN claim_amount TEXT;
ALTER TABLE claim_records ADD COLUMN claim_date TEXT;
ALTER TABLE claim_records ADD COLUMN claim_direction TEXT
  CHECK (claim_direction IN ('up', 'down', 'neutral'));
ALTER TABLE claim_records ADD COLUMN claim_tuple_key TEXT;

ALTER TABLE claim_evidence_links ADD COLUMN originating_evidence_id TEXT;
ALTER TABLE claim_evidence_links ADD COLUMN semantic_alignment TEXT NOT NULL DEFAULT 'unverified'
  CHECK (semantic_alignment IN ('unverified', 'verified', 'rejected'));
CREATE INDEX IF NOT EXISTS claim_evidence_origin_idx
  ON claim_evidence_links (originating_evidence_id);
CREATE INDEX IF NOT EXISTS claim_records_tuple_idx ON claim_records (claim_tuple_key);
