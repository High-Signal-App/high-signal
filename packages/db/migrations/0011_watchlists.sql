-- Plan 0010 — Entity watchlists + impact chains.

CREATE TABLE `watchlists` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL DEFAULT 'default',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlists_user_name_idx` ON `watchlists` (`user_id`, `name`);
--> statement-breakpoint

CREATE TABLE `watchlist_entities` (
  `id` text PRIMARY KEY NOT NULL,
  `watchlist_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `horizon` text NOT NULL DEFAULT 'week',
  `added_at` integer NOT NULL,
  `note` text,
  FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_entities_unique_idx` ON `watchlist_entities` (`watchlist_id`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `watchlist_entities_entity_idx` ON `watchlist_entities` (`entity_id`);
--> statement-breakpoint

CREATE TABLE `watchlist_suppressions` (
  `id` text PRIMARY KEY NOT NULL,
  `watchlist_id` text NOT NULL,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`)
);
--> statement-breakpoint
CREATE INDEX `watchlist_suppressions_wl_idx` ON `watchlist_suppressions` (`watchlist_id`);
--> statement-breakpoint

CREATE TABLE `watchlist_delta_log` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `watchlist_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `signal_id` text NOT NULL,
  `delta_kind` text NOT NULL,
  `surfaced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `watchlist_delta_user_idx` ON `watchlist_delta_log` (`user_id`, `surfaced_at`);
