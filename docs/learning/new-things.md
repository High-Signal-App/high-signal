# New things to learn — high-signal

Technologies, tools, and patterns encountered while building this project. 3-5 lines each. Fill `Why here` after you learn it locally.

---

## GLiNER (zero-shot NER)
- What: span-based NER model that classifies arbitrary label sets at inference time, no fine-tuning needed
- Why here: TBD
- Gotcha (from code): lazy-loaded inside `_load_gliner()` wrapped with `@lru_cache` — `extract/entities.py:60-66`; if the `gliner` package is absent the function returns `None` and the whole pipeline silently degrades to gazetteer-only matching rather than crashing
- Source: https://github.com/urchade/GLiNER — See also external-references.md

## GLiREL (zero-shot relation extraction)
- What: companion to GLiNER that extracts typed relation triples from text without training data
- Why here: TBD
- Gotcha (from code): `extract/relations.py:8-15` — `extract_relations()` always returns `[]`; GLiREL is not even listed in `pyproject.toml` (confirmed absent), so the stub is the only wiring that exists; hand-curated `relationships.csv` covers all live edges
- Source: https://github.com/jackboyla/GLiREL — See also external-references.md

## FinBERT
- What: BERT model fine-tuned on financial corpora (analyst reports, earnings calls) for sentiment classification
- Why here: TBD
- Gotcha (from code): `score/sentiment.py:31` hard-slices input to `text[:512]` before passing to the pipeline — the Transformers tokenizer also caps at 512 tokens, but this character slice means long tokens are cut mid-word with no truncation warning surfaced in the output tuple
- Source: https://huggingface.co/ProsusAI/finbert — See also external-references.md

## pgvector
- What: Postgres extension that adds a `vector` column type and ANN index operators (HNSW, IVFFlat)
- Why here: TBD
- Source: https://github.com/pgvector/pgvector — See also external-references.md

## VectorBT (declared but never called)
- What: vectorised backtesting library built on Pandas/NumPy for signal and strategy evaluation
- Why here: TBD
- Gotcha (from code): `score/backtest.py:3-4` docstring reads "VectorBT is heavier; for v0 we use the repo's yfinance adapter and hand-roll the math" — the library is declared in `pyproject.toml:13` (`vectorbt>=0.26.0`) but no import exists anywhere in the codebase; it is installed but dead weight
- Source: https://vectorbt.pro/

## NetworkX (BFS spillover graph)
- What: Python graph library; this project uses it for multi-hop BFS over a directed supply/customer/peer relationship graph, not PageRank
- Why here: TBD
- Gotcha (from code): `graph.py:51-90` — `spillover()` is a hand-rolled BFS with edge-weight × hop-decay scoring; `nx.pagerank` is never called; the topic is graph traversal, not centrality
- Source: https://networkx.org/documentation/stable/reference/algorithms/link_analysis.html

## Modal (serverless ML runtime)
- What: Python-native cloud runtime for GPU/CPU functions, scheduled tasks, and persistent sandboxes
- Why here: TBD
- Gotcha (from code): Modal crons were the original scheduler; fully migrated to GitHub Actions (`.github/workflows/cron-*.yml`); `python/ingest/modal_app.py` is kept only for ad-hoc `modal run` backfills — CPU-bound daily workloads don't justify Modal's cold-start overhead
- Source: https://modal.com/docs

## uv (Python package manager)
- What: Rust-based drop-in replacement for pip + virtualenv, with a lock-file model similar to pnpm
- Why here: TBD
- Source: https://docs.astral.sh/uv/

## Cloudflare D1 + Drizzle
- What: D1 is SQLite-on-Workers (zero-ops, co-located); Drizzle is a TypeScript ORM with type-safe migrations that targets both SQLite and Postgres
- Why here: TBD
- Gotcha (from code): no array types, no pgvector, limited concurrent writes — heavy analytics and vector search deliberately broken out to a separate local Postgres (Lab substrate)
- Source: https://developers.cloudflare.com/d1/ — See also external-references.md

## Hono (web framework on Workers)
- What: ultralight TypeScript web framework designed for Cloudflare Workers and other edge runtimes
- Why here: TBD
- Source: https://hono.dev/

## Clerk (auth)
- What: drop-in auth provider with session model, user metadata, and pre-built sign-in/sign-up UI
- Why here: TBD
- Gotcha (from code): Cloudflare Access was shipped first (2026-04-25) and abandoned within one week — CF Access lacks a full session model and user identity storage needed for per-user features; `apps/web/src/lib/require-auth.ts` and `clerk-admin.ts` are the live gates
- Source: https://clerk.com/docs

## Two-tier judge pattern
- What: deterministic rules handle clear cases cheaply; an AI model fires only on ambiguous HOLD verdicts
- Why here: TBD
- Gotcha (from code): `scripts/auto-publish-rules.ts:116` — `deterministicVerdict()` encodes editorial policy as tested TypeScript; adding a new kill condition (e.g. the prediction-market-only rule at line 131) requires a code commit + test update, not a config tweak; the AI judge (`auto-publish-drafts.ts`) only runs on `"hold"` returns
- Source: see `scripts/auto-publish-rules.ts` in this repo

## pnpm workspace monorepo with uv Python sibling
- What: single `pnpm-workspace.yaml` for TypeScript packages; Python sub-projects live as sibling dirs managed by `uv` with their own `pyproject.toml`/`uv.lock`
- Why here: TBD
- Gotcha (from code): no shared build step across TS and Python — `pnpm install` and `uv sync` are independent; CI runs Vitest and pytest separately
- Source: https://pnpm.io/workspaces

## all-MiniLM-L6-v2 (local sentence embeddings)
- What: 384-dimensional sentence embedding model from the sentence-transformers family; fast, CPU-friendly, no API key required
- Why here: TBD
- Gotcha (from code): used in `python/lab` via optional `[embeddings]` extra — `uv sync --extra embeddings` triggers a ~90 MB model download on first run; without it the Lab `embed` pass is silently skipped and HNSW indexes are never built, so `/search` returns no semantic results
- Source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — See also external-references.md
