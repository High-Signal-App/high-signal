-- Plan 0008 — Signal Provenance Editor And Claim Ledger.
-- Structured claim records, evidence-link roles, and timeline events that the
-- /review editor, /signals provenance tab, and auto-publish rules all read.
-- Existing signals/evidence stay canonical; claims are an additive index.

CREATE TABLE `claim_records` (
  `id` text PRIMARY KEY NOT NULL,
  `signal_id` text,
  `brief_item_id` text,
  `agent_eval_response_id` text,
  `surface` text NOT NULL,
  `assertion` text NOT NULL,
  `confidence_band` text NOT NULL DEFAULT 'medium',
  `review_status` text NOT NULL DEFAULT 'draft',
  `publish_reason` text,
  `parent_claim_id` text,
  `version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `published_at` integer,
  `corrected_at` integer,
  FOREIGN KEY (`parent_claim_id`) REFERENCES `claim_records`(`id`)
);
--> statement-breakpoint
CREATE INDEX `claim_records_signal_idx` ON `claim_records` (`signal_id`);
--> statement-breakpoint
CREATE INDEX `claim_records_parent_idx` ON `claim_records` (`parent_claim_id`);
--> statement-breakpoint
CREATE INDEX `claim_records_surface_status_idx` ON `claim_records` (`surface`, `review_status`);
--> statement-breakpoint

CREATE TABLE `claim_evidence_links` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_id` text NOT NULL,
  `evidence_url` text NOT NULL,
  `source_document_id` text,
  `role` text NOT NULL,
  `weight` integer NOT NULL DEFAULT 1,
  `notes` text,
  `added_at` integer NOT NULL,
  `added_by` text,
  FOREIGN KEY (`claim_id`) REFERENCES `claim_records`(`id`)
);
--> statement-breakpoint
CREATE INDEX `claim_evidence_claim_idx` ON `claim_evidence_links` (`claim_id`);
--> statement-breakpoint
CREATE INDEX `claim_evidence_url_idx` ON `claim_evidence_links` (`evidence_url`);
--> statement-breakpoint
CREATE INDEX `claim_evidence_doc_idx` ON `claim_evidence_links` (`source_document_id`);
--> statement-breakpoint

CREATE TABLE `claim_timeline_events` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_id` text NOT NULL,
  `kind` text NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  `actor` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`claim_id`) REFERENCES `claim_records`(`id`)
);
--> statement-breakpoint
CREATE INDEX `claim_timeline_claim_idx` ON `claim_timeline_events` (`claim_id`, `created_at`);
