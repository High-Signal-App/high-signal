-- Agent Evaluation Intelligence persistence.
-- Stores recommendation-worthiness audits, local agent prompt responses,
-- evidence-layer scores, missing-evidence tasks, and evidence-backed reel briefs.

CREATE TABLE `agent_evaluation_audits` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `brand_name` text NOT NULL,
  `brand_url` text NOT NULL,
  `buyer_mission` text NOT NULL,
  `target_segment` text,
  `competitors` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'completed' NOT NULL,
  `overall_score` integer DEFAULT 0 NOT NULL,
  `recommendation_summary` text NOT NULL,
  `evidence_text` text,
  `evidence_urls` text DEFAULT '[]' NOT NULL,
  `created_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `agent_evaluation_audits_owner_created_idx` ON `agent_evaluation_audits` (`owner_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `agent_evaluation_audits_brand_idx` ON `agent_evaluation_audits` (`brand_name`);
--> statement-breakpoint

CREATE TABLE `agent_evaluation_responses` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `prompt_key` text NOT NULL,
  `prompt_text` text NOT NULL,
  `surface` text NOT NULL,
  `response_text` text NOT NULL,
  `brand_mentioned` integer DEFAULT 0 NOT NULL,
  `brand_recommended` integer DEFAULT 0 NOT NULL,
  `competitors_mentioned` text DEFAULT '[]' NOT NULL,
  `citations` text DEFAULT '[]' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`audit_id`) REFERENCES `agent_evaluation_audits`(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_evaluation_responses_audit_idx` ON `agent_evaluation_responses` (`audit_id`);
--> statement-breakpoint
CREATE INDEX `agent_evaluation_responses_owner_idx` ON `agent_evaluation_responses` (`owner_id`);
--> statement-breakpoint

CREATE TABLE `agent_evidence_scores` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `area` text NOT NULL,
  `status` text NOT NULL,
  `score` integer NOT NULL,
  `evidence_urls` text DEFAULT '[]' NOT NULL,
  `notes` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`audit_id`) REFERENCES `agent_evaluation_audits`(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_evidence_scores_audit_idx` ON `agent_evidence_scores` (`audit_id`);
--> statement-breakpoint
CREATE INDEX `agent_evidence_scores_owner_idx` ON `agent_evidence_scores` (`owner_id`);
--> statement-breakpoint

CREATE TABLE `agent_evidence_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `area` text NOT NULL,
  `title` text NOT NULL,
  `priority` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `source_url` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`audit_id`) REFERENCES `agent_evaluation_audits`(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_evidence_tasks_audit_idx` ON `agent_evidence_tasks` (`audit_id`);
--> statement-breakpoint
CREATE INDEX `agent_evidence_tasks_owner_status_idx` ON `agent_evidence_tasks` (`owner_id`, `status`);
--> statement-breakpoint

CREATE TABLE `reel_briefs` (
  `id` text PRIMARY KEY NOT NULL,
  `audit_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `title` text NOT NULL,
  `hook` text NOT NULL,
  `buyer_mission` text NOT NULL,
  `proof_points` text DEFAULT '[]' NOT NULL,
  `visual_beats` text DEFAULT '[]' NOT NULL,
  `caption` text NOT NULL,
  `cta` text NOT NULL,
  `claim_boundary` text NOT NULL,
  `evidence_urls` text DEFAULT '[]' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`audit_id`) REFERENCES `agent_evaluation_audits`(`id`)
);
--> statement-breakpoint
CREATE INDEX `reel_briefs_audit_idx` ON `reel_briefs` (`audit_id`);
--> statement-breakpoint
CREATE INDEX `reel_briefs_owner_idx` ON `reel_briefs` (`owner_id`);
