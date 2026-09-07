# September 7 publication and connector incident

## Verified causes

- The [08:00 IST core ingest](https://github.com/High-Signal-App/high-signal/actions/runs/34076496770) aborted at 02:31 UTC with `double free or corruption (out)` and exit 134. The responsible native library is not identified by the available log. The nearby newspaper warning is not proof of causation.
- The [publish run](https://github.com/High-Signal-App/high-signal/actions/runs/34079856523) completed its publication step but failed freshness validation. The [09:30 IST validator](https://github.com/High-Signal-App/high-signal/actions/runs/34081523330) reported no timestamped evidence input.
- Direct HTTP reads around 06:57 UTC returned a September 7 composed Brief with six older stock signals, zero September 7 signals from `/data/daily`, and three September 6 signals from `/signals.json`. Search retrieval returned independently crawled older versions. Fresh source-directory generation does not prove the core daily pipeline succeeded.
- The shared connector removed `get_daily_brief`, `search_signals`, `get_signal`, and `get_track_record`; installed connector schemas still call them and receive tool-not-found errors.
- Signals date queries used UTC while the reader UI uses IST. The Brief stock composer uses a rolling history but the reader-facing heading says today's signals.

## Local repair, not yet released

- Restrict the Brief signal section to the edition's IST publication date, including legacy cached compositions. Expose `editionDate` and `timeZone`; retain original item timestamps.
- Interpret Signals day queries using the existing IST range helper.
- Show pending publication explicitly and call composition time "Updated".
- Return HTTP 503/no-store for failed JSON feed reads; show unavailable counts on the Signals page rather than a false quiet day.
- Restore the four installed connector names alongside the current tools. Keep exact-slug matching, bounded search, live-only track-record buckets, and anonymous GET access.
- Enable all-thread fault tracebacks in the Python CLI so the next native abort can be diagnosed.

Connector changes are isolated in `/tmp/high-signal-connector-fix`; the original connector checkout's untracked workspace file was left untouched.

## Validation

- High Signal API: 362 tests passed; workspace typecheck passed.
- Python pipeline contracts and fetch concurrency: 37 tests passed; Ruff passed.
- Connector: 106 tests passed; full check covers type generation, build, catalog compatibility, response normalization, and actual MCP transport calls for all four installed methods.

## Remaining release and investigation gates

The core pipeline follow-up belongs to the existing [freshness reliability issue #133](https://github.com/High-Signal-App/high-signal/issues/133).

Commit, push, deploy, and production ingestion reruns require explicit operator authorization. No production state was changed in this investigation.

After deployment, verify the homepage and Signals agree on each IST day; call the installed connector methods; confirm upstream errors remain unavailable. Run ingestion with native tracebacks and identify the abort before claiming the pipeline is repaired. Successful source-cadence runs are not a substitute for a successful core ingest and freshness validation.

The current native MCP `snapshotId` (`hs-YYYY-MM-DD`) is a day label, not an immutable snapshot revision. These repairs do not implement atomic snapshot storage. That requires a separately versioned manifest of published membership and evidence, an atomic active-version switch, snapshot-aware reads across all surfaces, and race/replay tests. Do not describe the present date label as providing that invariant.
