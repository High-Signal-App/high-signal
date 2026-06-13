-- Plan 0009 — Brief Distribution And Subscription Routing.
-- Email delivery first; RSS/Atom token + JSON digest in later slices share
-- the same preferences and log tables. Idempotency is enforced by the unique
-- (user_id, channel, brief_date) index on delivery_log.

CREATE TABLE `delivery_preferences` (
  `user_id` text NOT NULL,
  `channel` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `email` text,
  `region` text NOT NULL DEFAULT 'global',
  `timezone` text NOT NULL DEFAULT 'UTC',
  `local_window_start` text NOT NULL DEFAULT '07:00',
  `connected_brand_id` text,
  `rss_token` text,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_id`, `channel`)
);
--> statement-breakpoint
CREATE INDEX `delivery_preferences_channel_idx` ON `delivery_preferences` (`channel`, `enabled`);
--> statement-breakpoint

CREATE TABLE `delivery_log` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `channel` text NOT NULL,
  `brief_date` text NOT NULL,
  `status` text NOT NULL,
  `reason` text,
  `provider_message_id` text,
  `attempt` integer NOT NULL DEFAULT 1,
  `sent_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_log_user_day_chan_idx` ON `delivery_log` (`user_id`, `channel`, `brief_date`);
--> statement-breakpoint
CREATE INDEX `delivery_log_status_idx` ON `delivery_log` (`status`, `created_at`);
--> statement-breakpoint

CREATE TABLE `delivery_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `brief_date` text NOT NULL,
  `region` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delivery_snapshots_user_day_idx` ON `delivery_snapshots` (`user_id`, `brief_date`);
