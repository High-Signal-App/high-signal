-- On-demand company lookup/create metadata.
-- Additive only: existing generated rows remain valid.

ALTER TABLE `company_universe_companies`
  ADD COLUMN `status` text NOT NULL DEFAULT 'generated';

ALTER TABLE `company_universe_companies`
  ADD COLUMN `domain` text;

ALTER TABLE `company_universe_companies`
  ADD COLUMN `requested_by` text;

ALTER TABLE `company_universe_companies`
  ADD COLUMN `requested_at` integer;

ALTER TABLE `company_universe_companies`
  ADD COLUMN `last_enriched_at` integer;

CREATE INDEX IF NOT EXISTS `company_universe_companies_domain_idx`
  ON `company_universe_companies` (`domain`);

CREATE INDEX IF NOT EXISTS `company_universe_companies_status_idx`
  ON `company_universe_companies` (`status`);
