-- Plan 0013 — India D2C Opportunity Pipeline (Slices 3 + 4): persistence,
-- history, and agent-visibility overlay. Additive only — three new tables,
-- no changes to existing rows.
--
-- d2c_niches              : the 20 curated India D2C niches (slug-keyed, stable).
-- d2c_niche_snapshots     : one row per (niche, snapshot_date) with the weekly
--                           score breakdown, verdict, confidence, and evidence
--                           JSON. Append-only — verdict changes and score
--                           deltas are read by joining consecutive snapshots.
-- d2c_agent_visibility    : Slice 4 — which brands AI assistants recommend and
--                           cite for each niche's category prompt. One row per
--                           (niche, platform, run_date).

CREATE TABLE `d2c_niches` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `region` text NOT NULL DEFAULT 'south-asia',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `d2c_niches_slug_idx` ON `d2c_niches` (`slug`);
CREATE INDEX `d2c_niches_category_idx` ON `d2c_niches` (`category`);

CREATE TABLE `d2c_niche_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `niche_id` text NOT NULL,
  `snapshot_date` integer NOT NULL,
  `opportunity_score` integer NOT NULL,
  `demand_score` real,
  `competition_score` real,
  `pricing_score` real,
  `ad_saturation_score` real,
  `agent_visibility_score` real,
  `source_diversity` real NOT NULL,
  `verdict` text NOT NULL,
  `confidence` text NOT NULL,
  `evidence_json` text NOT NULL,
  `freshness_date` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`niche_id`) REFERENCES `d2c_niches`(`id`)
);

CREATE UNIQUE INDEX `d2c_niche_snapshots_niche_date_idx`
  ON `d2c_niche_snapshots` (`niche_id`, `snapshot_date`);
CREATE INDEX `d2c_niche_snapshots_date_idx`
  ON `d2c_niche_snapshots` (`snapshot_date`);
CREATE INDEX `d2c_niche_snapshots_verdict_idx`
  ON `d2c_niche_snapshots` (`verdict`);

CREATE TABLE `d2c_agent_visibility` (
  `id` text PRIMARY KEY NOT NULL,
  `niche_id` text NOT NULL,
  `platform` text NOT NULL,
  `model` text NOT NULL,
  `prompt_text` text NOT NULL,
  `response_text` text NOT NULL,
  `recommended_brands` text NOT NULL DEFAULT '[]',
  `cited_urls` text NOT NULL DEFAULT '[]',
  `brand_mentioned` integer NOT NULL DEFAULT 0,
  `gap_score` real,
  `run_date` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`niche_id`) REFERENCES `d2c_niches`(`id`)
);

CREATE INDEX `d2c_agent_visibility_niche_idx`
  ON `d2c_agent_visibility` (`niche_id`);
CREATE INDEX `d2c_agent_visibility_run_idx`
  ON `d2c_agent_visibility` (`run_date`);
CREATE INDEX `d2c_agent_visibility_platform_idx`
  ON `d2c_agent_visibility` (`platform`);
