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

## Daily pipeline order (UTC)

The daily cycle is sequenced so each stage consumes the previous stage's output:

| Time (UTC) | Workflow | Intent |
| --- | --- | --- |
| 06:00 | `cron-ingest.yml` | Daily `--source all --days 1` ingest run → events → draft signals into `signals/YYYY-MM-DD/`. |
| 07:00 | `cron-publish.yml` | Two-tier auto-publish judge (deterministic rules → AI on HOLD). Clears the draft queue without a human gate. 1h after ingest, 30min before personal-brief. |
| 07:30 | `personal-brief.yml` | Operator personal command brief refresh + SaaS Maker task sync. Runs after ingest so it sees the day's signals. |
| 09:00 | `cron-backtest.yml` | Replay convergence labels → next-24h hit-rates → `workers/api/src/lib/label-backtest.json`. Well clear of `cron-equities` (21:30 UTC). Committing that file redeploys the API Worker. |
| 21:30 (Mon–Fri) | `cron-equities.yml` | The **only** scheduled public stock-price ingress. yfinance EOD after US close → `data/equities-snapshot.jsonl` + derived bundles. A push to main auto-triggers `deploy-web.yml`. |
| 22:30 | `cron-score.yml` | Daily scoring for matured signal windows (after US market close). |

## High-frequency

| Cadence | Workflow | Intent |
| --- | --- | --- |
| Every 4h | `cron-markets.yml` | Prediction-market polling (`--source markets`: Polymarket / Manifold / Kalshi → `market_quotes`). Probabilities only — never equity prices. Metaculus is a separate forecast source (`--source metaculus`) run by the daily `--source all` ingest, not this workflow. |

## Weekly

| Day (UTC) | Workflow | Intent |
| --- | --- | --- |
| Mon 07:00 | `cron-d2c-opportunities.yml` | India D2C opportunity pipeline (plan 0013): collect community evidence → agent-visibility overlay → sync to D1 → commit bundled artifact. |
| Mon 09:00 | `weekly.yml` | Quality check: runs `lint`, `typecheck`, `test`, `build` if the scripts exist. |

## On-demand (`workflow_dispatch` only)

| Workflow | When to run |
| --- | --- |
| `backfill.yml` | Historical replay for track-record scoring (e.g. `gdelt,edgar` over a date range). |
| `backfill-sources.yml` | Wide-window backfill to populate D1 events for sources the daily `--days 1` cron leaves empty. Intentionally free (no AI key set → free-ai gateway / deterministic drafts). |
| `deploy-web.yml` | Deploy `high-signal-web` Worker (also auto-triggers on push to main). |
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
required secrets: `CLOUDFLARE_API_TOKEN` (backtest queries remote D1),
`AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` (signal generation; falls back to
free-ai gateway / deterministic drafts when absent), `SEC_USER_AGENT` (EDGAR).

Source-specific keys are listed in
[`source-catalog.md`](source-catalog.md) (the `Access` column) and in
`../../PROJECT_STATUS.md` ("Active source keys").

## Why GitHub Actions (not Modal)

Modal was the original scheduler (2026-04-25) and was migrated to GitHub Actions
within one day (ADR-006 in [`../architecture/decisions.md`](../architecture/decisions.md)).
GitHub Actions is free for this workload, already in the repo, and the daily
ingest is CPU-bound (GLiNER entity extraction; optional FinBERT sentiment via an
undeclared `transformers` extra that falls back to rules when absent).
`python/ingest/modal_app.py` is kept only
for ad-hoc long backfills via `modal run`.
