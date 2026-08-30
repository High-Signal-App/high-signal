-- Materialized per-source rollup of `events`, plus the two indexes the public
-- data surface was missing.
--
-- `GET /data/sources` and `GET /data/sources/:id` each recomputed a whole-table
-- aggregate over `events` on every cache miss, and `GET /data/daily` scanned
-- the whole table to bound one IST day of ingests. On a 440k-row `events`
-- table that was ~90M D1 rows read per day. The rollup is refreshed by the
-- existing */30 cron; the indexes make both the refresh and the daily receipt
-- index-only.
--
-- `latest_observed_at` and `future_count` are evaluated against the refresh
-- instant, mirroring the `unixepoch()` the route queries used. They are
-- nullable/zero exactly where the aggregate they replace produced NULL/0.
CREATE TABLE `events_source_rollup` (
  `source` text PRIMARY KEY NOT NULL,
  `event_count` integer DEFAULT 0 NOT NULL,
  `latest_observed_at` integer,
  `last_ingested_at` integer,
  `future_count` integer DEFAULT 0 NOT NULL,
  `refreshed_at` integer NOT NULL
);
--> statement-breakpoint
-- Single-row control record (id is pinned to 1) describing what the rollup
-- currently reflects, so a refresh can decide whether a rebuild is needed.
CREATE TABLE `events_rollup_state` (
  `id` integer PRIMARY KEY NOT NULL,
  `max_ingested_at` integer DEFAULT 0 NOT NULL,
  `rebuilt_at` integer DEFAULT 0 NOT NULL,
  `refreshed_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Bounds `GET /data/daily`'s material-evidence receipt to the day it asks for
-- instead of scanning `events`; also makes `max(ingested_at)` an O(1) probe.
CREATE INDEX `events_ingested_at_idx` ON `events` (`ingested_at`, `source`);
--> statement-breakpoint
-- Covering index for the rollup rebuild: lets SQLite satisfy the whole
-- per-source aggregate from the index in one ordered pass, with no temp
-- B-tree for the GROUP BY.
CREATE INDEX `events_source_rollup_idx` ON `events` (`source`, `published_at`, `ingested_at`);
