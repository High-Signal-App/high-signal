# September 7 publication and connector incident

## Verified causes

- The [08:00 IST core ingest](https://github.com/High-Signal-App/high-signal/actions/runs/34076496770) aborted at 02:31 UTC with `double free or corruption (out)` and exit 134. The responsible native library is not identified by the available log. The nearby newspaper warning is not proof of causation.
- The [publish run](https://github.com/High-Signal-App/high-signal/actions/runs/34079856523) completed its publication step but failed freshness validation. The [09:30 IST validator](https://github.com/High-Signal-App/high-signal/actions/runs/34081523330) reported no timestamped evidence input.
- Direct HTTP reads around 06:57 UTC returned a September 7 composed Brief with six older stock signals, zero September 7 signals from `/data/daily`, and three September 6 signals from `/signals.json`. Search retrieval returned independently crawled older versions. Fresh source-directory generation does not prove the core daily pipeline succeeded.
- The shared connector removed `get_daily_brief`, `search_signals`, `get_signal`, and `get_track_record`; installed connector schemas still call them and receive tool-not-found errors.
- Signals date queries used UTC while the reader UI uses IST. The Brief stock composer uses a rolling history but the reader-facing heading says today's signals.

## Released repair

- Read public today/yesterday signal sections from the live published ledger, so precomputed snapshots cannot hide signals published later. Batch provenance queries within D1 parameter limits.
- Restrict the Brief signal section to the edition's IST publication date, including legacy cached compositions. Expose `editionDate` and `timeZone`; retain original item timestamps.
- Interpret Signals day queries using the existing IST range helper.
- Show pending publication explicitly and call composition time "Updated".
- Return HTTP 503/no-store for failed JSON feed reads; show unavailable counts on the Signals page rather than a false quiet day.
- Restore the four installed connector names alongside the current tools. Keep exact-slug matching, bounded search, live-only track-record buckets, and anonymous GET access.
- Enable all-thread fault tracebacks in the Python CLI so the next native abort can be diagnosed.

Connector changes were prepared in `/tmp/high-signal-connector-fix`, then fast-forwarded into the connector main checkout for the guarded deployment. The original workspace file was left untouched.

## Validation

- High Signal API: 364 tests passed; typechecks and exact-revision CI passed.
- Python pipeline contracts and fetch concurrency: 37 tests passed; Ruff passed.
- Connector: 107 tests passed; full check covers type generation, build, catalog compatibility, response normalization, and actual MCP transport calls for all four installed methods.

## Remaining release and investigation gates

The core pipeline follow-up belongs to the existing [freshness reliability issue #133](https://github.com/High-Signal-App/high-signal/issues/133).

- API release `7aea407`: [deployment](https://github.com/High-Signal-App/high-signal/actions/runs/34095182610) and [CI](https://github.com/High-Signal-App/high-signal/actions/runs/34094973497) passed.
- Web release `50beb67`: [deployment](https://github.com/High-Signal-App/high-signal/actions/runs/34094290469) passed; the follow-up release changed API/scripts only.
- Connector release `7cc3768b` (compatibility fix `4a050690`): exact-revision CI passed and Worker version `252731e3-4ac2-454f-ad13-16e40fe49bc9` deployed. All four installed methods were called successfully from the live consumer.
- `node scripts/verify-mcp-consumer.mjs` passed at 07:24 UTC: September 7 had zero signals on both surfaces; September 6 had the same three on both; exact signal lookup passed. This gate is now part of the existing production daily freshness validator. Fixture tests reject removed tools, broken calls, unavailable reads, and membership mismatches.
- The shared gateway production monitor passed 47 checks with one expected empty-dataset pagination skip.
- The [diagnostic ingestion rerun](https://github.com/High-Signal-App/high-signal/actions/runs/34094070147) succeeded at 07:40 UTC after 31 minutes: 3,666 events fetched and persisted, one draft, and four failed generation requests out of ten. The native abort did not recur; its responsible library is still unproven. All-thread fault diagnostics remain enabled. A bounded local 200-parse concurrency probe also did not reproduce the abort.
- The [recovery publisher](https://github.com/High-Signal-App/high-signal/actions/runs/34096747224) succeeded at 07:43 UTC. It rejected the one draft because its prose lacked the required brief structure, and published no new signal. Its freshness check passed with evidence seven minutes old; the installed consumer and all three data surfaces passed parity for both public days. Zero September 7 signals is the resulting publication state, not a failed retrieval.
- The final installed consumer calls for brief, search, exact signal, and track record all returned `ok: true` after publication. The live website showed edition September 7 with zero signals and yesterday with the same three as the feed.

The current native MCP `snapshotId` (`hs-YYYY-MM-DD`) is a day label, not an immutable snapshot revision. These repairs do not implement atomic snapshot storage. That requires a separately versioned manifest of published membership and evidence, an atomic active-version switch, snapshot-aware reads across all surfaces, and race/replay tests. Do not describe the present date label as providing that invariant.
