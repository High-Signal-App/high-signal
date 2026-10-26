-- Existing signal rows have no trustworthy product first-publication history.
-- Keep them ineligible; the normal API sync opts in only newly inserted signals.
ALTER TABLE `signals` ADD COLUMN `measurement_eligible` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `signals` ADD COLUMN `measurement_first_published_at` integer;
