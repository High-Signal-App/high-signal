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
Daily partitions remain immutable at:

```text
reddit/v2/date=YYYY-MM-DD/posts.jsonl.zst
reddit/v2/date=YYYY-MM-DD/comments.jsonl.zst
reddit/v2/date=YYYY-MM-DD/events.jsonl.zst
reddit/v2/date=YYYY-MM-DD/subreddits.index.json
reddit/v2/date=YYYY-MM-DD/manifest.json
```

`events.jsonl.zst` is the cross-product interface. It contains bounded Reddit
post events with attention metrics and R2 provenance. It is classified as
derived attention: it can prioritize investigation, but cannot add factual
confidence or satisfy High Signal's independent-evidence gate. Other products
must not duplicate the raw archive or scrape Reddit independently.

Consumers use their own least-privilege R2 credential, retrieve `latest.json`,
download the named event object, verify `eventsSha256`, then decompress with
Zstandard. Do not copy credentials into source code or logs.

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
the same `latest.json` contract, rejects incomplete or more-than-eight-hour-old
exports, verifies the compressed-object hash, decompresses it, and sets
`REDDIT_ARCHIVE_EVENTS_PATH`. The Python Reddit adapter then reads that file;
it does not make a second scheduled Reddit request.

OAuth/RSS code remains only for local diagnostics and explicit ad-hoc work when
the archive path is not set.

## Failure and recovery

- Partial and failed partitions are uploaded with honest manifests, but never
  replace `latest.json`.
- A stale or missing complete export fails the Reddit step in daily ingestion;
  it does not silently fall back to another production scrape.
- GitHub Actions retains the complete run artifact for seven days. R2 is the
  authoritative forward archive after that window.
- Resume by rerunning the full-roster workflow for the current collection
  window. Do not fabricate or claim historical completeness for missed data.

## Removal requests

Reddit/user deletion, protected-status or legal removal requests are the only
normal reason to rewrite a daily partition. Identify every affected stable
post/comment ID, rebuild the relevant streams with redacted bodies, update the
manifest hashes and derived event export, and then republish `latest.json` only
if the changed partition is still the latest complete day. Record the operator
action in issue #142 before and after execution.
