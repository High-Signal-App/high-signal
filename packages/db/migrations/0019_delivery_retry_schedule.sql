-- Plan 0009 completion — persist automatic retry eligibility across Worker
-- invocations. NULL keeps pre-migration failed rows immediately eligible below
-- the attempt cap and marks sent/terminal rows as unscheduled.

ALTER TABLE `delivery_log` ADD COLUMN `next_attempt_at` integer;
--> statement-breakpoint
CREATE INDEX `delivery_log_retry_schedule_idx` ON `delivery_log` (`status`, `next_attempt_at`);
