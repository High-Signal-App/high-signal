-- Raw-source preservation boundary.
-- Source adapters still emit normalized events, but this table stores the
-- document-level payload that produced each event so richer source structure
-- does not leak into the signal tables.

CREATE TABLE `source_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `canonical_url` text NOT NULL,
  `fetched_at` integer NOT NULL,
  `published_at` integer,
  `raw_hash` text NOT NULL,
  `raw_text` text,
  `raw_json` text,
  `parsed_fields` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_documents_raw_hash_idx` ON `source_documents` (`raw_hash`);
--> statement-breakpoint
CREATE INDEX `source_documents_source_idx` ON `source_documents` (`source`);
--> statement-breakpoint
CREATE INDEX `source_documents_url_idx` ON `source_documents` (`canonical_url`);
--> statement-breakpoint
CREATE INDEX `source_documents_fetched_idx` ON `source_documents` (`fetched_at`);

--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `source_document_id` text;
--> statement-breakpoint
CREATE INDEX `events_source_document_idx` ON `events` (`source_document_id`);
