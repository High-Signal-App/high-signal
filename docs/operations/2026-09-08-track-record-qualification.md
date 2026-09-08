# Track Record qualification — 8 September 2026

## Observed public behavior

Both September 8 and September 7 Brief/Signals editions were empty. Scheduled
ingest 34180275782 and publisher 34183736902 succeeded. Ingest produced one draft
while reporting generation failures; publishing rejected that draft for missing
brief-ready structure. Green automation is not evidence of a useful public brief.

The public Track Record showed 67% from two hits and one miss without its existing
small-sample warning. Source inspection found the warning used all scoring rows,
including pending rows, whereas the rate uses only hits and misses. A read-only
production aggregate returned these counts (no writes):

| Review status | Outcome | Scoring rows | Distinct signals |
| --- | --- | ---: | ---: |
| killed | miss | 1 | 1 |
| killed | pending | 146 | 145 |
| published | hit | 10 | 10 |
| published | miss | 16 | 16 |
| published | pending | 1791 | 1789 |
| published | push | 1 | 1 |

These totals include both stored cohorts. They do not prove historical
publication timing or independent predictions. The API labels non-`bf-` slugs as
live and aggregates scoring rows without filtering review status. Removing killed
rows would remove a miss, so this repair deliberately preserves all outcomes.
A defensible historical ledger needs publication/provenance and scoring-window
qualification before changing which observations count.

## Source correction

- Sample size for the warning is hits plus misses. Pending rows and pushes never
  inflate it. The prior arbitrary implication that ten observations establishes
  reliability is removed.
- Total records, pending records and the rate denominator are visible separately.
  Rows are labelled records rather than independent predictions.
- The non-backfill cohort is described as records marked as live, with its provenance
  limitation visible. Structured data uses the same bounded description.
- API failure displays unavailable and emits no zero-count dataset markup.
- No stored signal, score, API query, publication gate or scheduler changed.

Focused count tests and all 31 repository test suites pass. Full quality passes
its existing thresholds, including typechecking and docs. The dependency report
still lists 40 high advisories overall, 15 production, and zero critical; this
repair does not resolve that baseline debt. Existing visual layout is retained.

Remaining publication, runtime and data-quality receipts belong to
[issue 133](https://github.com/High-Signal-App/high-signal/issues/133).

The actual built Next page was exercised in isolated Chrome at 390px using
synthetic cohort responses and no external browser/API traffic. It rendered
3 hit-or-miss records and 2089 pending records with the sample warning. Switching
the fixture API to HTTP 503 rendered unavailable and removed dataset markup.
The local browser and server were closed. The OpenNext/Blume build passed.
The Track Record cache key is versioned to avoid serving the old trust copy
from existing edge entries after release; the cache policy regression passes.
