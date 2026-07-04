-- Plan: AI Visibility A+ — multi-model + persona GEO reporting.
-- Additive only: new nullable columns, safe to apply on a live D1.
--
-- persona          : buyer-committee role a prompt is framed for (CTO, developer,
--                    procurement, ...). Lets the visibility report slice how AI
--                    portrays the brand per persona (the Value AI Labs moat).
-- brand_recommended: the LLM-judge grades not just whether the brand is mentioned
--                    but whether the answer actively recommends it. Previously the
--                    report hardcoded this to false; now it is stored per result.

ALTER TABLE mention_prompts ADD COLUMN persona TEXT;

ALTER TABLE mention_results ADD COLUMN persona TEXT;
ALTER TABLE mention_results ADD COLUMN brand_recommended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mention_results ADD COLUMN judge_reasoning TEXT;
