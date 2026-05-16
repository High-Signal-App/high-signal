# Ingest runbook

How to inspect, debug, and recover the Python ingest pipeline running on Modal.

The pipeline emits three audit streams to the API (admin-token gated) on every
run; you read them back to answer *did the cron fire?*, *what did it see?*,
and *what blew up?*.

## Where state lives

| Place                              | What's there                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ingest_runs` (D1)                 | One row per source per cron tick — counts of fetched / dropped / drafted, error count, error sample. |
| `events` (D1)                      | Raw fetched events with `fetch_run_id` so a single tick is replayable.                            |
| `llm_runs` (D1)                    | Each generator LLM call, with token usage and outcome.                                            |
| `signals/YYYY-MM-DD/*.md`          | Drafted signal markdown that the writer emitted. Source of truth on disk + git.                  |
| `.tmp/signals-sync-cache-*.json`   | Local skip-cache used by `pnpm signals:sync:*`.                                                  |

## Generation scope

Launch policy lives in `docs/source-coverage.md`.

Current production cadence:

- `cron-ingest.yml`: daily market signal draft run over `all` sources.
- `cron-markets.yml`: prediction-market resource polling every 4 hours.
- `cron-score.yml`: daily scoring for matured signal windows.
- `backfill.yml`: manual historical replay, usually `gdelt,edgar`.

Low-confidence drafts are expected. Single-source or weak-source events should
enter the review queue as `low` confidence instead of disappearing. Medium/high
signals still need stronger evidence before publication.

## Quick checks

```bash
# Recent ingest activity, by source (last 7 days)
wrangler d1 execute high-signal-db --remote --config workers/api/wrangler.toml \
  --command "SELECT source, count(*) runs, sum(errors) errors, sum(signals_drafted) drafted
             FROM ingest_runs
             WHERE started_at >= datetime('now','-7 days')
             GROUP BY source ORDER BY runs DESC"

# Last 20 errors in detail
wrangler d1 execute high-signal-db --remote --config workers/api/wrangler.toml \
  --command "SELECT started_at, source, errors, error_sample
             FROM ingest_runs
             WHERE errors > 0
             ORDER BY started_at DESC LIMIT 20"

# Events fetched in the last 24 h, per source
wrangler d1 execute high-signal-db --remote --config workers/api/wrangler.toml \
  --command "SELECT source, count(*) n FROM events
             WHERE ingested_at >= datetime('now','-1 day')
             GROUP BY source ORDER BY n DESC"
```

The `/admin/health` route surfaces the same shape via HTTP for dashboards.

## Triage

1. **No new `ingest_runs` rows since the last cron tick.**
   - Modal didn't run, or `API_BASE` / `ADMIN_TOKEN` aren't set in the Modal
     Secret named `high-signal`. Check the Modal app logs:
     `modal logs high-signal-ingest`. Audit pushes are best-effort and log on
     failure — see `python/ingest/src/high_signal_ingest/audit.py`.

2. **Rows exist but `events_fetched = 0` for one source.**
   - Source-specific outage. Inspect the per-source module under
     `python/ingest/src/high_signal_ingest/sources/` for HTTP error handling.
     `news` and `gdelt` are most flaky.

3. **`errors > 0` with `generate <entity>:` in `error_sample`.**
   - LLM call failed for that cluster. Check `llm_runs` for the matching
     `started_at` to see token usage / status code. Common cause: AI gateway
     rate limit; rerun the single source with
     `uv run python -m high_signal_ingest.pipeline --source <s> --days <n>`.

4. **Signals drafted but missing from D1 after sync.**
   - Sync runs locally from disk. Re-run `pnpm signals:sync:remote --force`
     to bypass the skip-cache, then re-check the `signals` table.

## Recovery

- **Replay a fetch run.** `events` rows include `fetch_run_id`; you can
  filter them out and re-feed a downstream step. There's no replay CLI today
  — escape hatch is `wrangler d1 execute --command "DELETE FROM events WHERE
  fetch_run_id = '<id>'"` followed by a fresh run.
- **Force a full sync.** `pnpm signals:sync:remote --force` ignores the
  content-hash cache and re-applies every signal.
- **Wipe a broken signal row.** Delete the source markdown (or flip
  `review_status` to `corrected` and supersede it), then re-sync. D1
  `INSERT OR REPLACE` will overwrite; orphan rows need a manual `DELETE`.
