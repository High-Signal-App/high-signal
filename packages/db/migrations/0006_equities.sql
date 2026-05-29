-- Equities snapshot pipeline. Five tables:
--   tickers              — universe + classification (refresh monthly)
--   closes               — daily price history, 5y rolling per ticker
--   ticker_snapshot      — one row per ticker; Tier 1/2/3 derived fields
--   index_memberships    — ticker × index (S&P 500, Russell 3000, STOXX 600, …)
--   fx_rates             — currency-vs-USD daily rates (from ECB)
--   risk_free_rates      — FRED series (DGS3MO, DGS10) for Sharpe/etc.
--   institutional_holders — Tier 3: top holders per ticker from latest 13F
--   insider_transactions — Tier 3: Form 4 detail rows (last 90d window)
--
-- Sized for a ~5,000-ticker universe. Closes table dominates (~190 MB).
-- All other tables together: ~25 MB. Well inside D1 paid (10 GB cap).

CREATE TABLE `tickers` (
  `ticker` text PRIMARY KEY NOT NULL,
  `symbol` text NOT NULL,
  `exchange` text NOT NULL,
  `name` text,
  `asset_class` text NOT NULL,
  `currency` text,
  `country` text,
  `sector` text,
  `industry` text,
  `wikidata_id` text,
  `cik` text,
  `isin` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tickers_exchange_idx` ON `tickers` (`exchange`);
--> statement-breakpoint
CREATE INDEX `tickers_asset_class_idx` ON `tickers` (`asset_class`);
--> statement-breakpoint
CREATE INDEX `tickers_country_idx` ON `tickers` (`country`);
--> statement-breakpoint
CREATE INDEX `tickers_cik_idx` ON `tickers` (`cik`);

--> statement-breakpoint
CREATE TABLE `closes` (
  `ticker` text NOT NULL,
  `date` integer NOT NULL,
  `close` real NOT NULL,
  `volume` real,
  PRIMARY KEY (`ticker`, `date`),
  FOREIGN KEY (`ticker`) REFERENCES `tickers`(`ticker`)
);
--> statement-breakpoint
CREATE INDEX `closes_date_idx` ON `closes` (`date`);

--> statement-breakpoint
CREATE TABLE `ticker_snapshot` (
  `ticker` text PRIMARY KEY NOT NULL,

  -- Tier 1: derived from closes
  `last_close` real,
  `last_date` integer,
  `ret_1d` real,
  `ret_30d` real,
  `ret_90d` real,
  `ret_1y` real,
  `ret_5y` real,
  `ret_1d_usd` real,
  `ret_30d_usd` real,
  `ret_90d_usd` real,
  `ret_1y_usd` real,
  `ret_5y_usd` real,
  `volume_avg_30d` real,
  `volatility_30d` real,
  `high_52w` real,
  `low_52w` real,
  `dist_to_52w_high` real,
  `dist_to_52w_low` real,
  `max_drawdown_1y` real,
  `max_drawdown_5y` real,
  `sma_50` real,
  `sma_200` real,
  `golden_cross` integer DEFAULT 0,
  `death_cross` integer DEFAULT 0,
  `beta_vs_spy` real,
  `rel_strength_spy_90d` real,

  -- Tier 2
  `dividend_yield` real,
  `fx_to_usd` real,
  `wikipedia_pageviews_7d_avg` real,

  -- Tier 3 (mostly US issuers via SEC; nullable for international)
  `market_cap` real,
  `shares_outstanding` real,
  `revenue_latest` real,
  `revenue_yoy` real,
  `net_income_latest` real,
  `net_income_yoy` real,
  `fcf_latest` real,
  `gross_margin` real,
  `operating_margin` real,
  `short_interest_shares` real,
  `short_interest_pct` real,
  `insider_buys_90d` integer,
  `insider_sells_90d` integer,
  `insider_net_shares_90d` real,
  `earnings_next` text,
  `earnings_last` text,
  `mentions_gdelt_30d` integer,
  `mentions_reddit_30d` integer,
  `mentions_hn_30d` integer,

  `updated_at` integer NOT NULL,
  FOREIGN KEY (`ticker`) REFERENCES `tickers`(`ticker`)
);
--> statement-breakpoint
CREATE INDEX `ticker_snapshot_updated_idx` ON `ticker_snapshot` (`updated_at`);

--> statement-breakpoint
CREATE TABLE `index_memberships` (
  `ticker` text NOT NULL,
  `index_name` text NOT NULL,
  `added_at` integer NOT NULL,
  PRIMARY KEY (`ticker`, `index_name`),
  FOREIGN KEY (`ticker`) REFERENCES `tickers`(`ticker`)
);
--> statement-breakpoint
CREATE INDEX `index_memberships_index_idx` ON `index_memberships` (`index_name`);

--> statement-breakpoint
CREATE TABLE `fx_rates` (
  `currency` text NOT NULL,
  `date` integer NOT NULL,
  `rate_to_usd` real NOT NULL,
  PRIMARY KEY (`currency`, `date`)
);
--> statement-breakpoint
CREATE INDEX `fx_rates_date_idx` ON `fx_rates` (`date`);

--> statement-breakpoint
CREATE TABLE `risk_free_rates` (
  `series` text NOT NULL,
  `date` integer NOT NULL,
  `value` real NOT NULL,
  PRIMARY KEY (`series`, `date`)
);

--> statement-breakpoint
CREATE TABLE `institutional_holders` (
  `ticker` text NOT NULL,
  `filer_cik` text NOT NULL,
  `as_of_date` integer NOT NULL,
  `filer_name` text,
  `shares` real,
  `value_usd` real,
  PRIMARY KEY (`ticker`, `filer_cik`, `as_of_date`),
  FOREIGN KEY (`ticker`) REFERENCES `tickers`(`ticker`)
);
--> statement-breakpoint
CREATE INDEX `institutional_holders_asof_idx` ON `institutional_holders` (`as_of_date`);

--> statement-breakpoint
CREATE TABLE `insider_transactions` (
  `ticker` text NOT NULL,
  `filing_id` text NOT NULL,
  `filing_date` integer NOT NULL,
  `insider_name` text,
  `relationship` text,
  `transaction_type` text,
  `shares` real,
  `price` real,
  `total_value` real,
  PRIMARY KEY (`ticker`, `filing_id`),
  FOREIGN KEY (`ticker`) REFERENCES `tickers`(`ticker`)
);
--> statement-breakpoint
CREATE INDEX `insider_transactions_filing_date_idx` ON `insider_transactions` (`filing_date`);
--> statement-breakpoint
CREATE INDEX `insider_transactions_ticker_date_idx` ON `insider_transactions` (`ticker`, `filing_date`);
