# high-signal/python/ingest

Python ingestion + scoring runtime. Source adapters, entity/relation extraction,
signal generation, audit push.

## Setup

```bash
cd python/ingest
uv sync
```

Models (GLiNER NER, FinBERT) are downloaded on first run. The `markets` source
needs `yfinance`; `edgar` needs `SEC_USER_AGENT="<name> <email>"`.

## Environment

| Var              | Purpose                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `AI_BASE_URL`    | OpenAI-compatible base URL for the signal generator LLM. Defaults to DeepSeek in GitHub Actions. |
| `AI_API_KEY`     | API key for the above.                                                   |
| `AI_MODEL`       | Model name. GitHub Actions defaults to `deepseek-v4-flash`.              |
| `SEC_USER_AGENT` | Required by EDGAR. Format: `"Sarthak Agrawal sarthak@example.com"`.       |
| `API_BASE`       | Optional. Base URL of the high-signal API. If unset, audit pushes no-op. |
| `ADMIN_TOKEN`    | Optional. Bearer token for `/admin/*` audit endpoints.                   |
| `HIGH_SIGNAL_ENABLE_HF_NLP` | Optional. Set to `1` to enrich deterministic intent/sentiment tags with local Hugging Face pipelines. |
| `HIGH_SIGNAL_HF_SENTIMENT_MODEL` | Optional. HF sentiment model. Defaults to DistilBERT SST-2 when HF NLP is enabled. |
| `HIGH_SIGNAL_HF_INTENT_MODEL` | Optional. HF zero-shot model for intent classification. If unset, intent stays rule-based. |

The Modal Secret `high-signal` should hold all of the above.

## Layout

```
src/high_signal_ingest/
  sources/        edgar, news, reddit, ir, github, gov, youtube, gdelt, hkex, markets
  extract/        entities.py (primary entity from text), relation extractors
  analysis/       deterministic intent/sentiment tags; optional HF enrichment
  score/          finbert sentiment, backtest helpers
  seed/           ai_infra_entities.csv, relationships.csv (load_entities())
  audit.py        Best-effort POST to /admin/* — never raises into pipeline
  generator.py    LLM call that drafts a signal candidate
  graph.py        spillover_ids() — hop-decayed BFS over relationships
  pipeline.py     run(source, days) → dict summary
  writer.py       emit() writes signals/YYYY-MM-DD/<slug>.md
modal_app.py      Modal cron entry, deploys daily ingest
tests/            pytest
```

## Run locally

```bash
# Single source, last day's window
uv run python -m high_signal_ingest.pipeline --source news --days 1

# Everything, JSON line output (easy to pipe into jq)
uv run python -m high_signal_ingest.pipeline --source all --days 1 --json

# Preflight: verify env, models, and seed corpus load cleanly
uv run python -m high_signal_ingest.preflight
```

Exit code is `2` when the fetch step errored and produced zero drafted
signals — useful for Modal alerting. Otherwise `0` on success.

## Intelligence layer

Daily/community reads use deterministic `analysis.lightweight_nlp` tags first:
intent, sentiment, urgency, and the exact keyword hits. This is the default for
automation because it is stable, cheap, and compatible with lightweight Python
worker-style runtimes. Web/API consumers expose the annotation provenance as
`method`, `model`, `llm`, `intentScore`, and `sentimentScore` so a label is not
treated as a black-box model judgment.

Batch ingest can opt into local/open Hugging Face classifiers through
`analysis.semantic_nlp`:

```python
from high_signal_ingest.analysis.semantic_nlp import annotate

annotation = annotate(text, use_hf=True)
```

The HF pass never calls an LLM API and never blocks publication if model loading
fails; it falls back to `rules-v1`. Use it for higher-quality batch enrichment,
not for latency-sensitive edge request handling.

## Deploy to Modal

```bash
uv run modal deploy modal_app.py
modal logs high-signal-ingest        # follow the cron
```

## Adding a new source

1. Add `src/high_signal_ingest/sources/<source>.py` exporting either
   `fetch_recent(...) -> list[Event]` or `fetch_all(days: int) -> list[Event]`.
   Use the `Event` shape from `types.py` — populate `source`, `source_url`,
   `published_at`, `title`, `content`, and `primary_entity_id` when known.
2. Wire it into `pipeline.fetch()` behind a new branch and add the literal to
   the `Source` union + the argparse `--source` choices list.
3. Add at least one unit test under `tests/` that pins the response shape
   (use a recorded HTTP fixture; don't hit the live API in CI).
4. If the source needs a new env var, document it here and add it to the
   Modal Secret.

## Audit

Every run pushes to the API:

- `/admin/ingest-runs` — one row per `(source, started_at)` with counts.
- `/admin/events` — raw events keyed by `fetch_run_id` so a single tick is
  replayable.
- `/admin/llm-runs` — token + status for each generator call.

Inspection queries are in `../../docs/ingest-runbook.md`.

## Launch scope

Source and confidence policy is documented in `../../docs/source-coverage.md`.
For launch, Market Intelligence is the primary signal product:

- Daily `all` runs should generate published signals from news, EDGAR, IR, Reddit, GitHub, gov, YouTube, GDELT, HKEX, and market resources.
- Low-confidence single-source signals are expected; review is for correction or takedown after publish.
- Prediction markets are polled as contextual resources and stored quotes, not as standalone public signals by default.
- Mention and Community Intelligence generate dashboard data/digests today; they should not join the unified public signal feed until their outcome metrics are defined.
