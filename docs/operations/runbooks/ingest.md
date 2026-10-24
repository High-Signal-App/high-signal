# Ingest runbook

How to inspect, debug, and recover the Python ingest pipeline running in GitHub
Actions, locally, or through the manual Modal entry points.

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
| `signal-recovery/*.md`            | Undelivered candidates in the process working directory, separate from published history.       |

## Generation scope

Launch policy lives in `docs/operations/source-coverage.md`.

Current production cadence:

- `cron-ingest.yml`: daily market signal draft run over the bounded 28-source
  `all` group.
- `cron-source-cadences.yml`: daily fetch-only context plus weekly and monthly
  source groups.
- `cron-markets.yml`: prediction-market resource polling every 4 hours.
- `cron-score.yml`: daily scoring for matured signal windows.
- `backfill.yml`: manual historical replay, usually `gdelt,edgar`.

## Add a public publication feed

Open `/review` with operator Access and paste a website or direct RSS/Atom URL
under **publication sources**. The API discovers advertised feeds (or Substack's
public feed), validates the XML, and saves the source without a code change.
Known public Batch, free Stratechery, Beehiiv and Cerebras archive listings use
the same controls. Archive validation checks article discovery; recurring
collection additionally requires an actual publication date and public body.
The next daily news refresh collects it; **refresh sources** reloads collection
status, not the publisher. **Inspect collected records** opens its retained
source evidence. Pausing stops future fetches, including a matching curated seed;
already-retained reporting remains available. Matching legacy Substack fetches
are suppressed for managed URLs so they cannot bypass a pause or collect twice.

The manual `cron-ingest.yml` workflow also accepts an optional `feed_url` with
`source=news` and `fetch_only=true` to add a source and refresh without AI drafting.
Its existing protected server credentials stay within Actions. A successful URL
check is not a successful fetch: check the per-feed count/error after ingestion.
If the configured registry is unavailable, news RSS collection fails closed to
preserve operator pauses; repair the registry/API and retry `source=news`.
Public feed excerpts can substitute for inaccessible linked pages. This does not
supply paid email-only text or bypass a publisher's private feed credentials.

For a bounded repair, use `source=news:<curated-source-id>` with the required
lookback and `fetch_only=true`; it honors managed overrides and pauses while
recording the individual publication's fetch receipt.

API releases initialize migration `0031_feed_source_archives.sql` through the deployed
Worker's existing D1 binding and operator authorization. This fixed operation
accepts only the compiled 0030/0031 registry migrations, applies 0030 first when
needed, checks schema, and records the usual Wrangler
migration receipt in the same batch. Repeated releases preserve sources and
pauses. A recorded migration with a missing/incompatible table fails closed;
it does not recreate an empty registry. The deployment workflow reads the
registry back before reporting success. General remote migrations retain the
manual Wrangler path; no new D1 management token permission is required for this
one publication-source table.

Before Brief precomputation, a bounded operator research pass uses leads from
the canonical retained Reddit archive and recent retained primary reporting.
Community leads never count as proof. A generated report needs an independent
verification of every visible factual field, exact retained passage references,
and the existing primary-plus-independent-origin publication gate. Digest,
published claim, supporting links and model audit commit atomically. Insufficient
proof stays quiet; model/storage failures are recorded as unavailable. The
gateway uses the existing free-AI binding with model `auto`. No private mailbox
or alternate Reddit collection is introduced.

## Diagnosing a zero-draft day

A zero-draft run can exit 0 even when it produces no useful edition. These
receipts distinguish missing inputs, model decisions, proof failures and delivery:

- The run receipt (returned by `pipeline`, and stored in the `ingest_runs.notes`
  column) carries `candidates_generated`, `candidates_rejected_no_proof`, and a
  per-clause breakdown: `candidates_rejected_thin_evidence_urls`,
  `candidates_rejected_single_evidentiary_origin`,
  `candidates_rejected_single_provider`. `candidates_generated: 0` means no
  candidate reached proof checking; generation may have been skipped, failed,
  deliberately declined publication, or returned an empty batch. A high
  `candidates_rejected_single_evidentiary_origin` means the model returned
  candidates whose proofs were never marked aligned against distinct origins.
- `candidates_admitted_single_provider_authoritative` counts drafts that cleared
  the gate on two authoritative primary documents sharing one host (two SEC
  filings on `sec.gov`). It is an observation, not a failure.
- `clusters_reaching_generation` counts the proof-bearing stories actually
  handed to the generator, before any model call. Read it *with*
  `candidates_generated`: `clusters_reaching_generation: 0` means clustering had
  nothing to write about (look upstream at `events_no_entity` /
  `events_low_cluster`), while a high cluster count with a near-zero
  `candidates_generated` means the model saw plenty and declined it — usually
  because the surviving clusters are machine-generated churn (nightly build
  tags, model-upload batches, near-identical job requisitions) rather than
  reportable developments.
- `pipeline` prints a `::warning title=zero signal drafts::` annotation on
  stderr when a run fetched events yet drafted nothing, so the GitHub run page
  shows the drought instead of a silent green tick.
- `llm_runs.reason` records individual outcomes: `publish_false` is a deliberate
  decline, `ok:0/N` is a completed batch with no retained candidates, and
  `invalid_json` is an unusable model response. Inspect these existing audit
  records before changing prompts or adding diagnostics. An accepted audit row
  does not mean a signal was created or published.

Every generated candidate still needs verified independent support to pass the
ingestion proof gate, including low-confidence candidates. Retained source
events remain available when no candidate clears that gate.

## Delivery failures and recovery

In API mode, `signals_drafted` counts only acknowledged upserts. A protected
replay is a valid skip. Transport errors, failure receipts and malformed
acknowledgements increment `signals_delivery_failed` and `errors`; the pipeline
and backfill CLIs exit 4 even when other candidates were delivered successfully.
`signals_recovered` and `recovery_paths` report separately saved candidates,
never delivered drafts. If the recovery write also fails, the delivery error
remains and no recovery path is claimed.

The writer creates unique markdown files in `signal-recovery/` under its current
working directory. It never uses the published `signals/` tree for API-failure
recovery. GitHub's ingestion and backfill workflows upload only those recovery
files as `signal-recovery-<run-id>-<attempt>` artifacts, retained for 14 days.
Download them before expiry, inspect the failed run and existing signal status,
then retry the bounded source after repairing delivery. A timeout can occur
after the server committed, so a missing acknowledgement does not prove that
the database is empty. Do not bulk-import recovery files or replace reviewed
signals to make a run green.

The manual Modal entry points return the same failure counters, but their local
recovery paths are ephemeral; GitHub artifact retention does not cover Modal.

## Quick checks

Start with the read-only source diagnostic. It never prints secret values.
Production ingest/backfill should fail early unless persistence and SEC identity
are present:

```bash
pnpm source:diagnose
cd python/ingest && uv run python -m high_signal_ingest.source_diagnose \
  --require-persistence --require-sec-identity
```

`API_BASE` + `ADMIN_TOKEN` are the persistence pair. Without them, source fetches
can succeed while `events`, `ingest_runs`, `/data`, and quote history stay
unchanged.

For grouped selectors (`all`, `weekly`, `monthly`, or `context`), `ingest_runs`
contains both the aggregate row and per-adapter receipts linked by the `notes`
parent-run marker. This distinguishes an adapter that ran with zero yield from
one that failed or was not scheduled.

```bash
# Recent ingest activity, by source (last 7 days)
wrangler d1 execute high-signal-db --remote --config workers/api/wrangler.toml \
  --command "SELECT source, count(*) runs, sum(errors) errors, sum(signals_drafted) drafted
             FROM ingest_runs
             WHERE started_at >= unixepoch('now','-7 days')
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
             WHERE ingested_at >= unixepoch('now','-1 day')
             GROUP BY source ORDER BY n DESC"

# Recent generation decisions, without request or response bodies
wrangler d1 execute high-signal-db --remote --config workers/api/wrangler.toml \
  --command "SELECT datetime(created_at,'unixepoch') created_utc,
                    model, prompt_version, accepted, reason
             FROM llm_runs
             WHERE created_at >= unixepoch('now','-1 day')
             ORDER BY created_at DESC LIMIT 20"
```

Stored timestamps are Unix seconds. The protected `/admin/audit/summary` route
provides aggregate audit counts; it does not expose per-request reasons.

## Triage

1. **No new `ingest_runs` rows since the last cron tick.**
   - The workflow didn't run, or `API_BASE` / `ADMIN_TOKEN` aren't set for that
     runtime. Check the GitHub Actions job first; it runs `source_diagnose
     --require-persistence --require-sec-identity` before ingest. Audit pushes
     are best-effort and log on failure — see
     `python/ingest/src/high_signal_ingest/audit.py`.

2. **Rows exist but `events_fetched = 0` for one source.**
   - Source-specific outage. Inspect the per-source module under
     `python/ingest/src/high_signal_ingest/sources/` for HTTP error handling.
     `news` and `gdelt` are most flaky.

3. **`errors > 0` with `generate <entity>:` in `error_sample`.**
   - LLM call failed for that cluster. Check `llm_runs.created_at` within the
     ingest run's time window for token usage and failure reason. Common cause: AI gateway
     rate limit; rerun the single source with
     `uv run python -m high_signal_ingest.pipeline --source <s> --days <n>`.

4. **A candidate exists but no remote draft was acknowledged.**
   - Inspect `signals_delivery_failed`, `recovery_paths` and the existing signal
     status first. API ingestion writes directly to D1; recovery markdown is not
     evidence of delivery. A protected replay skip is expected. The separate
     disk importer must not be used to overwrite reviewed records.

## Recovery

- **Retry a bounded source.** Inspect the retained `events` by `fetch_run_id`,
  repair the demonstrated failure and rerun that source. There is no exact-run
  replay CLI; a new fetch has new provenance. Preserve existing audit rows.
- **Recheck the disk importer.** An explicitly approved
  `pnpm signals:sync:remote --force` bypasses only the local content-hash cache.
  Its guarded upserts still preserve published, corrected and killed records;
  it is not a way to bypass review protection or replay recovery artifacts.
- **Correct a reviewed signal.** Preserve its markdown and stored proof. Add a
  new correction that cites the original and follow the normal review workflow;
  do not delete history or replace the original row.
