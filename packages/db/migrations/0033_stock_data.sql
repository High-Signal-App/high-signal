-- Canonical records are private. Public projections have a separate rights gate.
CREATE TABLE stock_data_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE stock_data_publications (
  publication_id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('display', 'export')),
  as_of TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX stock_data_records_kind ON stock_data_records(kind, sequence DESC);
--> statement-breakpoint
CREATE INDEX stock_data_publications_current ON stock_data_publications(audience, as_of DESC);
--> statement-breakpoint
CREATE TRIGGER stock_data_records_immutable_update BEFORE UPDATE ON stock_data_records BEGIN
  SELECT RAISE(ABORT, 'stock records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER stock_data_records_immutable_delete BEFORE DELETE ON stock_data_records BEGIN
  SELECT RAISE(ABORT, 'stock records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER stock_data_publications_immutable_update BEFORE UPDATE ON stock_data_publications BEGIN
  SELECT RAISE(ABORT, 'stock publications are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER stock_data_publications_immutable_delete BEFORE DELETE ON stock_data_publications BEGIN
  SELECT RAISE(ABORT, 'stock publications are append-only');
END;
