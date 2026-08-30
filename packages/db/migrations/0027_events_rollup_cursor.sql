-- Track a stable `(ingested_at, id)` cursor so the source rollup can merge only
-- rows added since the previous cron tick. `ingested_at` alone is not unique:
-- an ingest batch can write many rows in the same second.
ALTER TABLE `events_rollup_state`
  ADD COLUMN `max_ingested_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Widen the existing ingest index to make the cursor total and covering while
-- preserving its load-bearing name for existing `INDEXED BY` queries.
DROP INDEX `events_ingested_at_idx`;
--> statement-breakpoint
CREATE INDEX `events_ingested_at_idx`
  ON `events` (`ingested_at`, `id`, `source`, `published_at`);
