# September 9 candidate attribution audit

The public September 9 Brief has no verified signals. The successful publisher
retry is an operational recovery receipt, not evidence of a useful edition.
No generation, publication, provider configuration or stored record was changed
by this audit.

## Actual funnel

The [scheduled ingest](https://github.com/High-Signal-App/high-signal/actions/runs/34303520343)
completed on source `036edb97ff74b8196c1e5f547538368b647478df`:

| Stage | Observed count |
| --- | ---: |
| Events fetched and persisted | 4,204 |
| Exact duplicates collapsed | 909 |
| Remaining events without tracked entity | 2,432 |
| Events in insufficient-origin clusters | 653 |
| Stories reaching generation | 30 |
| Generation requests | 12 |
| Failed generation requests | 2: one server error, one invalid JSON |
| Generated candidates | 6 |
| Proof rejections | 5: four single-provider, one insufficient URL count |
| Admitted drafts | 1: authoritative single-provider evidence |

The sole draft was `nne-earthquake-cluster-near-lospalos-timor-leste`.
The [publisher retry](https://github.com/High-Signal-App/high-signal/actions/runs/34324493619)
evaluated zero new drafts and this one same-day killed row: zero published,
one killed, zero operational errors. Its AI verdict was KILL with no supplied
reason. Do not infer a more specific final-judge rationale from that log.

The ordinary public `/brief` page at 390px visibly says **NO VERIFIED SIGNALS
TODAY**. Public `/data/daily?date=2026-09-09` returns zero signals, 1,208 evidence
inputs and latest input at 05:42:26 UTC. The composition API also retains one
August 31 opportunity; it is not a newly published September 9 signal.
The publisher's freshness/MCP checks passed at their recorded time. This audit
does not rerun or extend that time-sensitive acceptance.

## Reproduced attribution defect

The real seed maps `NNE` to Nano Nuclear Energy. The USGS adapter emits titles
such as `M 4.8 - 96 km NNE of Lospalos, Timor Leste` with no explicit entity.
The deterministic gazetteer interpreted the compass bearing as the ticker.
An unchanged-source synthetic title/body returned entity `NNE`, score 5.
The actual USGS adapter with a synthetic GeoJSON response, followed by the
pipeline's entity-selection function, reproduced the same error.

Matching now excludes only the demonstrated numeric-distance + distance-unit +
exact `NNE` + `of` phrase. This applies consistently to gazetteer membership and
weighted entity scoring. Retained source events, URLs and evidence text remain
unchanged. Explicit `$NNE`, financial ticker mentions, full company names and
company mentions alongside a location still match. Other compass-like tickers
are not generalized without evidence.

Before the repair, the focused suite had four failures and 47 passes. After the
repair all 51 pass, including actual adapter-to-pipeline routing, decimal and
lowercase bearings, miles, full-company and financial counterexamples, and token
lookalikes. No editorial threshold, prompt, evidence-origin rule or publication
decision was loosened.

Local full `pnpm quality`, seed preflight and all 433 ingestion tests pass;
branch coverage is 56.82%, above the existing 55% floor.

The initial local Python audit reported 60 entries across 13 packages, but that
environment used a stale **ignored local** `uv.lock`. Neither Python project
tracks a lockfile. Matching installed versions to that local file did not prove
the hosted dependency state. [Exact PR CI](https://github.com/High-Signal-App/high-signal/actions/runs/34326644399)
passed with a fresh resolution: GLiNER 0.2.29, newspaper4k 0.9.6, lxml 6.1.3,
Torch 2.14.0 and Transformers 5.16.1; its `pip-audit --local` found no known
vulnerabilities. The lab's fresh default/development dependency resolution also
passed its audit. This supersedes the initial draft-PR audit-blocked description.

The existing local ingest environment was refreshed without a manifest change
or audit exclusion. The targeted compatible versions include Torch 2.13.0,
Transformers 5.10.1, GLiNER 0.2.29 and newspaper4k 0.9.6; the latter two upgrades
permit patched Transformers/lxml versions. Its audit is also clean. Local
compatibility checks passed three synthetic HTML extraction paths (production,
trafilatura and newspaper), finite random-config CPU inference of shape
`[1, 5, 16]`, and a local tokenizer roundtrip. GLiNER factory resolution selects
`UniEncoderSpanGLiNER` with the production `predict_entities(text, labels,
threshold)` call interface. These checks do not establish pretrained model/NER
quality; no pretrained inference was run.
No model weights, owner data, provider configuration or lockfile policy changed.

## Limits and next proof

This prevents false company routing; it does not turn rejected evidence into a
useful signal. The receipt does not retain per-story model rejection rationale,
so it cannot explain every one of the 30-to-6 candidate reductions. The current
generator explicitly targets AI infrastructure/semiconductors, while the public
product direction spans technology, startups and finance; broadening that scope
requires a separate evidenced decision, not an opportunistic prompt edit.

Two generation requests failed and five candidates lacked required proofs.
Those are distinct from the demonstrated compass defect. A future scheduled or
explicitly authorized bounded run must verify corrected routing and editorially
useful output. Python scheduled ingestion consumes checked source; no Worker
deployment is needed for this matching-only repair. [Issue 133](https://github.com/High-Signal-App/high-signal/issues/133)
remains open.
