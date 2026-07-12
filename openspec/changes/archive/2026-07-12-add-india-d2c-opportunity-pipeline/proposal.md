## Why

Indian D2C founders (impuls8's user base) cannot quickly answer "is this niche
actually demand, or hype? are there too many brands? which price band is open?
are ads saturated? what wedge should I test first?" High Signal's moat —
cite-or-kill, confidence bands, source diversity, hit-rate — fits a smaller but
more trustworthy opportunity pipe better than copying a competitor's directory.

Plan `0013-india-d2c-opportunity-pipeline.md` is the PRD; this change delivers
**Slice 1 (static seed + renderer)** and **Slice 2 (weekly source collector)**.
Slices 3 (scoring history) and 4 (agent-visibility overlay) stay deferred.

## What Changes

- Add a owned, cited **India D2C Opportunity Pipeline** with 20 hand-curated
  niches, deterministic scoring (0–100 + `test/watch/avoid` verdict), and
  Opportunity Brief payloads that reuse the existing
  `OpportunityBriefPayload` contract from `core/brief.ts`.
- Render the briefs on `/opportunities` (new "India D2C" section) and inline
  in Daily Brief section 02 when `region=south-asia`.
- Add a weekly Python collector (`python/ingest/.../d2c_opportunities.py`)
  that pulls narrow Reddit/community samples for the 20 niches and writes
  cited JSON artifacts under `data/d2c-opportunities/`. The renderer reads
  the latest artifact when present and falls back to seed briefs otherwise.
- No D1 migration in this slice — JSON artifacts first, per the PRD's
  "no-migration first slice" option. Persistence is deferred to Slice 3.
- No scraping or redistribution of impuls8 data; no new paid source
  dependency; no medical/financial claims without conservative wording.

## Capabilities

### Modified Capabilities

- `opportunity-briefs`: India D2C niches become a first-class source of
  Opportunity Briefs, rendered in the Daily Brief and `/opportunities`.

## Impact

- Shared: new `packages/shared/src/content/d2c-opportunities.ts` (seed niches
  + scoring + verdict mapping + brief composer); re-exported from
  `packages/shared/src/content/index.ts`.
- Web: `apps/web/src/app/opportunities/page.tsx` gains an India D2C section;
  `apps/web/src/components/brief/BriefSections.tsx` already renders
  `OpportunityBriefPayload`, so no new component is needed (only data flow).
- Worker API: `workers/api/src/routes/brief.ts` merges India D2C briefs into
  section 02 for `region=south-asia` (and `global` as a rotating sample).
- Python: new `python/ingest/src/high_signal_ingest/d2c_opportunities.py`
  collector + CLI; writes `data/d2c-opportunities/<YYYY-MM-DD>.json`.
- Tests: `packages/shared` scoring/verdict unit tests; brief route test that
  India D2C briefs appear for `south-asia`; Python collector dry-run test.
- No migrations, no new production dependencies, no secrets, no deploy
  changes. The collector runs ad-hoc (`uv run python -m
  high_signal_ingest.d2c_opportunities`); a GitHub Actions cron is deferred
  to Slice 3 once the artifact shape is stable.
