-- Generated High Signal company universe and competitor graph.
-- Populated by `pnpm company-universe:sync:*` from the generated artifact.

CREATE TABLE IF NOT EXISTS `company_universe_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `generated_at` text NOT NULL,
  `source_inputs_json` text NOT NULL,
  `company_count` integer NOT NULL DEFAULT 0,
  `competitor_count` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `company_universe_companies` (
  `slug` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `category` text NOT NULL DEFAULT 'Other',
  `investors_json` text NOT NULL DEFAULT '[]',
  `source_evidence_json` text NOT NULL DEFAULT '[]',
  `generated_at` text NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `company_universe_companies_name_idx`
  ON `company_universe_companies` (`name`);

CREATE INDEX IF NOT EXISTS `company_universe_companies_category_idx`
  ON `company_universe_companies` (`category`);

CREATE INDEX IF NOT EXISTS `company_universe_companies_generated_idx`
  ON `company_universe_companies` (`generated_at`);

CREATE TABLE IF NOT EXISTS `company_universe_competitors` (
  `company_slug` text NOT NULL REFERENCES `company_universe_companies` (`slug`) ON DELETE CASCADE,
  `competitor_slug` text NOT NULL REFERENCES `company_universe_companies` (`slug`) ON DELETE CASCADE,
  `score` integer NOT NULL,
  `reason` text NOT NULL,
  `generated_at` text NOT NULL,
  PRIMARY KEY (`company_slug`, `competitor_slug`)
);

CREATE INDEX IF NOT EXISTS `company_universe_competitors_company_idx`
  ON `company_universe_competitors` (`company_slug`, `score`);

CREATE INDEX IF NOT EXISTS `company_universe_competitors_competitor_idx`
  ON `company_universe_competitors` (`competitor_slug`);
