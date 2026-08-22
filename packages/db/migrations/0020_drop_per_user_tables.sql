-- Remove every per-user table. High Signal is now fully public: the only
-- account is the single operator, whose access is a session cookie plus
-- ADMIN_TOKEN, not a database row.
--
-- Dropped here, grouped by the surface that owned them:
--   Mentions        mention_brand_configs, mention_prompts, mention_checks,
--                   mention_results, cited_url_index, intent_opportunities
--   Agent Eval      agent_evaluation_audits, agent_evaluation_responses,
--                   agent_evidence_scores, agent_evidence_tasks, reel_briefs
--                   (the evaluator itself survives and runs in-process)
--   Email delivery  delivery_preferences, delivery_log, delivery_snapshots
--   Watchlists      watchlists, watchlist_entities, watchlist_suppressions,
--                   watchlist_delta_log
--
-- Deliberately KEPT: tracked_communities + community_digest_snapshots. Those
-- look owner-scoped because of their owner_id column, but they are operator
-- curation — the public Daily Brief's "Behavior & Culture" section reads those
-- digests (workers/api/src/routes/brief/query.ts). Their CRUD moved behind
-- ADMIN_TOKEN in workers/api/src/routes/admin.ts instead of being deleted.
--
-- Child tables drop before parents so foreign keys stay satisfiable.

DROP TABLE IF EXISTS `watchlist_delta_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `watchlist_suppressions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `watchlist_entities`;
--> statement-breakpoint
DROP TABLE IF EXISTS `watchlists`;
--> statement-breakpoint
DROP TABLE IF EXISTS `delivery_snapshots`;
--> statement-breakpoint
DROP TABLE IF EXISTS `delivery_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `delivery_preferences`;
--> statement-breakpoint
DROP TABLE IF EXISTS `intent_opportunities`;
--> statement-breakpoint
DROP TABLE IF EXISTS `cited_url_index`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mention_results`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mention_checks`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mention_prompts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `mention_brand_configs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `reel_briefs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_evidence_tasks`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_evidence_scores`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_evaluation_responses`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agent_evaluation_audits`;
