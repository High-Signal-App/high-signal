CREATE TABLE `workflow_dispatches` (
  `id` text PRIMARY KEY NOT NULL,
  `workflow` text NOT NULL,
  `purpose` text NOT NULL,
  `slot_at` integer NOT NULL,
  `status` text NOT NULL,
  `attempts` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `last_attempt_at` integer NOT NULL,
  `dispatched_at` integer,
  `error` text
);
--> statement-breakpoint
CREATE INDEX `workflow_dispatches_slot_idx` ON `workflow_dispatches` (`slot_at`);
--> statement-breakpoint
CREATE INDEX `workflow_dispatches_status_idx` ON `workflow_dispatches` (`status`);
