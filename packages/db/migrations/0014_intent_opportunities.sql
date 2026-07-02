-- Persist brand-level buyer/community intent findings so the Mentions detail
-- surface and report can read the same objects as the opportunity scorer.

CREATE TABLE `intent_opportunities` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `source` text NOT NULL,
  `source_url` text NOT NULL,
  `source_title` text NOT NULL,
  `source_excerpt` text NOT NULL,
  `platform` text NOT NULL,
  `intent_stage` text NOT NULL,
  `action_type` text NOT NULL,
  `score` integer NOT NULL,
  `competitors` text NOT NULL DEFAULT '[]',
  `matched_keywords` text NOT NULL DEFAULT '[]',
  `evidence_task_id` text,
  `reply_draft` text,
  `status` text NOT NULL DEFAULT 'open',
  `found_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`brand_id`) REFERENCES `mention_brand_configs`(`id`)
);

CREATE UNIQUE INDEX `intent_opportunities_brand_url_idx`
  ON `intent_opportunities` (`brand_id`, `source_url`);

CREATE INDEX `intent_opportunities_brand_score_idx`
  ON `intent_opportunities` (`brand_id`, `status`, `score`);

CREATE INDEX `intent_opportunities_owner_updated_idx`
  ON `intent_opportunities` (`owner_id`, `updated_at`);
