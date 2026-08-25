---
title: Scheduled Jobs & Workflows
description: Reference for the GitHub Actions cron jobs and deploy workflows that run the daily pipeline. Schedules live in .github/workflows/*.yml — this page documents the ordering, intent, and dependencies.
---

# Scheduled Jobs & Workflows

> **Schedules are authoritative in code.** The exact cron expressions live in
> `.github/workflows/*.yml`. This page documents the *intent, ordering, and
> dependencies* so the daily pipeline is legible without re-deriving it from
> YAML. If anything here disagrees with the workflow files, the workflow files
> win — fix this page.
>
> **Machine-readable inventory:** [`jobs.json`](jobs.json) is the
> automation-readiness registry consumed by `scripts/automation-coverage.mjs`
> and `scripts/foundry-evidence.mjs`. Every recurring path MUST appear there.
> Data durability and provenance live in [`data-durability.md`](data-durability.md).

## Daily pipeline order (IST; cron remains UTC)

The daily cycle is sequenced so each stage consumes the previous stage's output:

| Time (IST / UTC) | Workflow | Intent |
| --- | --- | --- |
| 06:30 / 01:00 | `cron-source-cadences.yml` | Fetch-only macro-rate and crypto on-chain context; no signal drafting. |
| 08:00 / 02:30 | `cron-ingest.yml` | Bounded 21-source `--source all --days 1` ingest run → events → draft signals. |
| 09:00 / 03:30 | `cron-publish.yml` | Mandatory shared publishability gate plus semantic/origin-aware claim judge. |
| 09:30 / 04:00 | `cron-validate-brief.yml` | Assert the edition is dated today in IST and its newest material evidence is under two hours old. |
| 10:00 / 04:30 | `personal-brief.yml` | Deliver the operator personal command brief after public validation. |
| 14:30 / 09:00 | `cron-backtest.yml` | Read a bounded event/signal window through the operator API, replay convergence labels → next-24h hit-rates → `workers/api/src/lib/label-backtest.json`. Well clear of `cron-equities` (21:30 UTC). The commit ships with the next manual API deploy. |
| 21:30 (Mon–Fri) | `cron-equities.yml` | The **only** scheduled public stock-price ingress. yfinance EOD after US close → `data/equities-snapshot.jsonl` + derived bundles. The commit ships with the next manual web deploy. |
| 22:30 | `cron-score.yml` | Daily scoring for matured signal windows (after US market close). |

## High-frequency

| Cadence | Workflow | Intent |
| --- | --- | --- |
| Every 30m | `cron-digg.yml` | Poll five documented Digg feeds; material rank, velocity, or contributor crossings immediately trigger bounded original-source verification. Durable request/completion timestamps measure first-seen → candidate latency. Digg never enters evidence or confidence scoring. |
| Every 4h | `cron-markets.yml` | Prediction-market polling (`--source markets`: Polymarket / Manifold / Kalshi → `market_quotes`). Probabilities only—never equity prices or direct evidence. Metaculus is parked. |

## Weekly

| Day (UTC) | Workflow | Intent |
| --- | --- | --- |
| Sun 00:00 | `cron-source-cadences.yml` | Run the 14-source weekly group with a 14-day recovery window. |
| Mon 07:00 | `cron-d2c-opportunities.yml` | India D2C opportunity pipeline (plan 0013): collect community evidence → agent-visibility overlay → persist through the operator API → commit bundled artifact. |
| Mon 09:00 | `weekly.yml` | Quality check: runs `lint`, `typecheck`, `test`, `build` if the scripts exist. |

## Monthly

| Day (UTC) | Workflow | Intent |
| --- | --- | --- |
| Day 1, 00:30 | `cron-source-cadences.yml` | Run BLS, EIA, and global macro with a 120-day recovery window. |

## On-demand (`workflow_dispatch` only)

| Workflow | When to run |
| --- | --- |
| `backfill.yml` | Historical replay for track-record scoring (e.g. `gdelt,edgar` over a date range). |
| `backfill-sources.yml` | Wide-window backfill to populate D1 events for sources the daily `--days 1` cron leaves empty. Intentionally free (no AI key set → free-ai gateway / deterministic drafts). |
| `cron-source-cadences.yml` | Manually rerun the `context`, `weekly`, or `monthly` source group. |
| `deploy-web.yml` | Manually deploy `high-signal-web` with the dispatched Git SHA attached to the Worker version. |
| `deploy-api.yml` | Deploy `high-signal-api` Worker. |

There are only two deploy workflows (`deploy-web.yml`, `deploy-api.yml`). The
former standalone annotation worker was decommissioned — annotation now runs
in-process via `annotateLightweightNlp` (see `packages/shared/src/nlp/`), so
there is no `workers/annotation` and no `deploy-annotation.yml`.

## Operator prerequisites

The cron jobs read secrets from GitHub Actions secrets. The persistence pair
that almost every cron needs is `API_BASE` + `ADMIN_TOKEN` (without them, source
fetches can succeed while `events`, `ingest_runs`, `/data`, and quote history
stay unchanged — see [`runbooks/ingest.md`](runbooks/ingest.md)). Other commonly
required secrets: `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` (signal generation; falls back to
free-ai gateway / deterministic drafts when absent), `SEC_USER_AGENT` (EDGAR).
The backtest and D2C workflows use `API_BASE` + `ADMIN_TOKEN` and require no
Cloudflare account-level database credential.

Source-specific keys are listed in
[`source-catalog.md`](source-catalog.md) (the `Access` column) and in
`../../PROJECT_STATUS.md` ("Active source keys").

Each grouped source run writes one aggregate receipt plus one receipt per
adapter. A per-adapter row with `events_fetched=0, errors=0` means the adapter
ran successfully but produced no observations; `errors>0` means it failed after
bounded retries. On-demand, manual, and parked entries receive no scheduled
receipt.

## Why GitHub Actions (not Modal)

Modal was the original scheduler (2026-04-25) and was migrated to GitHub Actions
within one day (ADR-006 in [`../architecture/decisions.md`](../architecture/decisions.md)).
GitHub Actions is free for this workload, already in the repo, and the daily
ingest is CPU-bound (GLiNER entity extraction; optional FinBERT sentiment via an
undeclared `transformers` extra that falls back to rules when absent).
`python/ingest/modal_app.py` is kept only
for ad-hoc long backfills via `modal run`.
