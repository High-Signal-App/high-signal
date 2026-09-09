---
title: Reddit daily archive
description: Operate and consume High Signal's canonical compressed Reddit dataset.
---

# Reddit daily archive

High Signal owns the single forward Reddit collection. The scheduled job reads
the curated roster once, writes immutable compressed daily objects to private
R2, and publishes a small pointer only after a complete full-roster run.

## Consumer contract

Approved products read `reddit/v2/latest.json` from the private
`high-signal-reddit-archive` bucket. It identifies the newest complete
`events.jsonl.zst`, its SHA-256, coverage window, schema version and manifest.
New full-roster payloads use immutable run-and-attempt partitions:

```text
reddit/v2/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/posts.jsonl.zst
reddit/v2/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/comments.jsonl.zst
reddit/v2/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/events.jsonl.zst
reddit/v2/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/subreddits.index.json
reddit/v2/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/manifest.json
```

Manual cohort canaries use
`reddit/v2/canary/run=<github-run-id>/attempt=<github-run-attempt>/date=YYYY-MM-DD/`; they can never overwrite
a canonical full-roster partition or move the shared latest pointer.
Legacy `reddit/v2/date=YYYY-MM-DD/` objects remain readable through their existing
pointers. Consumers must follow pointer object keys, never reconstruct a date
path. The manifest records `objectPrefix`; newly collected events carry matching
raw-object provenance. Resumed events retain the provenance of their original
immutable payload. Each Actions retry receives a new attempt prefix.

`events.jsonl.zst` is the cross-product interface. It contains bounded Reddit
post events with attention metrics and R2 provenance. It is classified as
derived attention: it can prioritize investigation, but cannot add factual
confidence or satisfy High Signal's independent-evidence gate. Other products
must not duplicate the raw archive or scrape Reddit independently.

Consumers use their own least-privilege R2 credential, retrieve `latest.json`,
download the named event object, verify `eventsSha256`, then decompress with
Zstandard. Do not copy credentials into source code or logs.

The shared Infisical secret is named `CLOUDFLARE_R2_API_TOKEN`. Wrangler reads
`CLOUDFLARE_API_TOKEN`, so consumer jobs must map the dedicated value for the
single command (`CLOUDFLARE_API_TOKEN="$CLOUDFLARE_R2_API_TOKEN"`) rather than
falling back to the broader legacy token. Each sibling product should inject
that mapping at runtime; it should not duplicate the credential in its repo.

## Retention policy

- All returned in-window posts from the curated communities are retained.
- Comments with score 2 or higher are retained.
- Submitter, moderator and sticky comments are retained regardless of score.
- Low-score ancestors of retained replies are kept so conversation context is
  not broken; unrelated low-score branches are discarded.
- The manifest records comments seen, retained and dropped so filtering is
  measurable rather than hidden.

## High Signal ingestion

The archive job runs before the main daily ingest. `cron-ingest.yml` retrieves
the same `latest.json` contract, rejects incomplete, invalid/missing-date, future
or more-than-eight-hour-old exports, verifies the compressed-object hash, decompresses it, and sets
`REDDIT_ARCHIVE_EVENTS_PATH`. The Python Reddit adapter then reads that file;
it does not make a second scheduled Reddit request.

OAuth/RSS code remains only for local diagnostics and explicit ad-hoc work when
the archive path is not set.

## Failure and recovery

- Partial and failed partitions are uploaded with honest manifests, but never
  replace `latest.json` or payloads referenced by the prior complete pointer.
- Bucket preflight is read-only: missing access or bucket failure stops the run
  instead of attempting to create a provider resource.
- A stale or missing complete export fails the Reddit step in daily ingestion;
  it does not silently fall back to another production scrape.
- GitHub Actions retains the complete run artifact for seven days. R2 is the
  authoritative forward archive after that window.
- Manual recovery accepts the failed/partial Actions `resume_run_id`. It restores
  that run's artifact, verifies it, reuses every complete community range and
  recollects only partial or failed communities against the persisted exact
  window. The resulting manifest records the stable watermark, attempt count,
  reused communities and stable-ID deduplication totals.
- `pnpm reddit:archive:verify -- <partition-directory>` independently checks
  compressed bytes and hashes, decoded counts, duplicate stable IDs, every
  subreddit line range, the latest pointer, gaps, API requests and archive size.
  The archive workflow runs this reconciliation before publishing the pointer.
- Do not fabricate or claim historical completeness for missed data.

## Removal requests

Reddit/user deletion, protected-status or legal removal requests are the only
normal reason to rewrite a daily partition. Run the operator-only
`reddit-archive-redact` workflow with an exact archive date and the manifest
`archive_prefix` for run partitions (leave blank only for the legacy date
partition), stable post/comment IDs, an allowed reason code and the `REDACT` confirmation. It redacts bodies and
authors, removes affected post events from the derived export, rebuilds hashes
and indexes, reconciles the result, verifies every remote object byte for byte,
and republishes `latest.json` only when the changed partition is the current
complete archive identity. Refresh and redaction share one Actions concurrency
group so pointer publication cannot race between these maintained workflows.
The redaction exception changes only the selected archive; it does not remove
the same Reddit ID from every retained historical snapshot automatically. Manifests retain hashed target IDs and counts, not the supplied
identifiers. Record the operator action in an issue before and after execution.

## Reddit Insights receipt

Reddit Insights reads the same `events.jsonl.zst` and `latest.json` objects with
its least-privilege R2 credential. Its `import:high-signal` command materializes
disposable gzip display corpora under `artifacts/`; `--render <subreddit>`
generates a source-linked HTML sample without starting another collector or
persisting a second raw archive.

## September 9 refresh safety checkpoint

One approved ingestion attempt, [34336537695](https://github.com/High-Signal-App/high-signal/actions/runs/34336537695),
correctly stopped before generation because its complete archive was older than
eight hours. Inspection then found that a same-day refresh could overwrite the
previous complete payload before pointer publication. The source repair isolates
run/attempt keys and retains exact-identity redaction compatibility. Isolated
regressions execute the actual upload/pointer/redaction shell blocks against
mocked R2 files, covering partial and failed reruns, canaries, successful pointer
replacement and preservation of a newer same-day pointer during old-run redaction.
Real archive refresh, consumer ingestion and useful publication remain separately
unqualified in [issue 133](https://github.com/High-Signal-App/high-signal/issues/133).
