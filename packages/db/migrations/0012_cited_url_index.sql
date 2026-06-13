-- Plan 0011 — OpenLens steal list. Cited-URL intelligence index for
-- mentions/[brand]. Source of truth is still mention_results.citations[];
-- this is a derived per-brand index refreshed by the worker.

CREATE TABLE `cited_url_index` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text NOT NULL,
  `topic` text NOT NULL DEFAULT '',
  `url` text NOT NULL,
  `host` text NOT NULL,
  `ownership` text NOT NULL DEFAULT 'unknown',
  `competitor_id` text,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `platforms` text NOT NULL DEFAULT '[]',
  `mention_run_count` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `cited_url_brand_topic_idx` ON `cited_url_index` (`brand_id`, `topic`);
--> statement-breakpoint
CREATE INDEX `cited_url_host_idx` ON `cited_url_index` (`host`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cited_url_brand_url_idx` ON `cited_url_index` (`brand_id`, `url`);
