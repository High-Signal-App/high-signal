# Plan 0007 — HighSignal Lab: Local Intelligence Substrate

Status: active
Created: 2026-05-22
Relates to: underpins `plans/0004-platform-consolidation.md`, `plans/0006-agent-evaluation-attention-layer.md`, and `plans/0001-research-artifact-first.md` — it provides the shared ingestion + index layer those sub-products draw candidates from. It does not supersede them.

## Thesis

High Signal's sub-products all need the same upstream capability: a wide, curated, queryable index of tech/startup primary sources. Today each sub-product has its own narrow ingest path (`python/ingest` adapters scoped to AI-infra). That duplicates work and does not scale across wedges.

HighSignal Lab is that shared substrate: a **local-first, single-Postgres** ingestion + extraction + index layer over tech/startup primary sources. It is **not a web index and not a new product** — it is the discovery layer beneath the products.

The AI-infra signal log stays exactly what it is — evidence-first, hand-reviewed, ≥ 2 cited sources, public hit-rate ledger. What changes: its candidate documents and events come from Lab's index instead of bespoke adapters. Lab ranks raw material; humans turn the top of that ranking into cited signals. **Lab is the discovery substrate; the signal log is the editorial layer on top.**

Success is personal and concrete: *Lab produces a ranked feed/search experience the operator opens daily.* Until that is true, any infra beyond a laptop is a distraction.

## Scope decisions (locked in this plan)

- **One store.** Local Postgres only — canonical metadata, app state, keyword search (FTS / `tsvector`), semantic search (`pgvector` + HNSW), and analytics. No ClickHouse, no DuckDB/Parquet, no Meilisearch, no Qdrant. Rationale: the pipeline is upsert-heavy (re-fetch a URL, re-poll an HN score, flip a review flag); Postgres is built for that write pattern, ClickHouse fights it with async mutations. At 100k–1M rows the analytics here (a top-50 feed, per-source counts) are trivial in Postgres. If scan-heavy analytics ever dominate, the deferred move is DuckDB-over-Parquet exports — not a second OLAP engine.
- **Reference-expansion, not a crawler.** The index grows one hop from seeds. No broad web crawl, no crawler archive.
- **Local / free models.** Summaries via local Qwen (MLX). Entities via GLiNER (already in the stack). Satisfies Free AI First; escalate to paid only on a specific, documented quality failure.
- **No graph table, no composite signal score, no from-scratch model training** in this milestone — all deferred (see Non-Goals).

## Sources (milestone set)

Seeds, then one hop:

1. **Hacker News** — items + comments (taste / discussion signal).
2. **The submitted URL** — for each HN submission, fetch the linked page itself; extract readable text + metadata.
3. **One-hop link extraction** — outbound links from that page, resolved to repos / papers / docs.
4. **The 14k-repo GitHub DB** — imported as the spine; enriched via the GitHub API.
5. **Research papers & engineering blogs** — ingested *only when referenced* by something already indexed. No standalone crawl feeds.

Deferred sources (Lobsters, Reddit, Product Hunt, package registries, Stack Overflow, transcripts, job postings, funding data) are added only after the milestone feed is genuinely useful.

## Data model (Postgres)

Tables, key columns only:

- `documents` — url, canonical_url, source, domain, title, published_at, discovered_at, extracted_text, summary, short_summary, embedding `vector`, signal_score, score_factors `jsonb`, review_status.
- `repos` — full_name, url, description, stars, forks, last_commit_at, language, topics, readme_summary, embedding `vector`, signal_score.
- `hn_threads` — hn_id, document_id, score, comment_count, posted_at.
- `entities` — name, type (`company | repo | paper | tool | concept | person | market`).
- `document_entities` — document_id × entity_id (join; this is the only "graph" in the milestone).
- `links` — from_document_id, to_url, to_document_id?, to_repo_id?, link_type (`submitted | discusses | mentions`).

Store extracted readable text (needed for re-summarization and as a RAG corpus). Do **not** store raw HTML, full page snapshots, or per-paragraph embeddings — HTML is kept only in-flight during extraction, then discarded.

## Pipeline

1. **Ingest seeds** — pull HN items + comments; import the 14k-repo DB into `repos`.
2. **Expand one hop** — fetch each submitted URL, extract readable text + outbound links, resolve links.
3. **Enrich** — repo metadata via the GitHub API; pull a referenced paper/blog only when a `link` points at it.
4. **Summarize + extract** — Qwen (MLX) → summary + short_summary; GLiNER → entities.
5. **Embed** — one embedding per document and per repo into `pgvector` (HNSW index).
6. **Score** — 3-factor `signal_score`; store the factor breakdown in `score_factors`.
7. **Search + feed** — Postgres FTS for keyword, `pgvector` for semantic; a ranked **top-50 feed** view.

## Score (deliberately small)

`signal_score` = a weighted blend of three computable signals only:

- HN discussion (score / comment count)
- GitHub momentum (stars + commits in the last N days)
- recency

Calibrate the weights by eyeball against the feed. Borrow the signal-log discipline: a confidence band tuned post-hoc beats a fragile multi-factor composite. More factors are a later plan, gated on the feed being useful first.

## Infra path

- **Phase 1 — laptop.** M-series / 48GB / 1TB. Postgres + Python/Node workers + local models. Cost ₹0. Bottleneck is SSD; add external NVMe if needed. **This plan covers only Phase 1.**
- **Phase 2 — CF thin app.** Reuse the existing `apps/web` + `workers/api`: serve `highsignal.app` and a read-only *hot slice* synced up from local Postgres; R2 for backups. No heavy compute on Cloudflare.
- **Phase 3 — Hetzner single box.** Move Postgres + workers off the laptop once the feed is load-bearing.
- **Phase 4 — managed.** Only after real external usage.

Phases 2–4 are out of scope here and begin only after the Phase-1 success metric is met.

## Repo placement

- Lab ingestion + scoring: new `python/lab/` (sibling of `python/ingest`; shares the `uv` workspace).
- Lab Postgres schema + migrations: kept distinct from the D1 signal schema — likely a separate `lab` namespace under `packages/db`.
- Open: confirm whether Lab shares the existing Drizzle package or gets its own. This placement is a recommendation, not locked — adjust during the build.

## Relationship to the existing build

- Lab does **not** replace the D1 signal schema, the `signals/` markdown store, the review queue, or the hit-rate ledger.
- Lab **feeds** the review queue: its ranked documents become candidate evidence; a human still drafts and cites every published signal (≥ 2 sources, evidence-first).
- `python/ingest`'s AI-infra adapters are retired into Lab incrementally, only once Lab covers their sources — never before (consolidation rule).

## First build sequence

Each step is independently runnable and idempotent — re-running upserts rather than duplicating.

1. **Schema + migration** — create the local Postgres database; define `documents`, `repos`, `hn_threads`, `entities`, `document_entities`, `links`; enable the `vector` extension, add HNSW indexes and `tsvector` FTS columns.
2. **Repo import** — load the 14k-repo DB into `repos`; backfill GitHub API metadata (stars, forks, last commit, language, topics).
3. **HN ingest** — pull HN items + comments into `documents` / `hn_threads`; create a `document` per submitted URL with a `submitted` link.
4. **Extraction** — fetch each submitted URL, extract readable text + outbound links, discard HTML, resolve one-hop links; pull referenced papers/blogs.
5. **Summaries + entities** — run Qwen (MLX) for summaries, GLiNER for entities into `document_entities`.
6. **Embeddings** — one `pgvector` embedding per document and per repo.
7. **Score + feed** — compute the 3-factor `signal_score`; build keyword + semantic search and the ranked top-50 feed.

## Competitive review — adopted from `digg.com/ai` (2026-05-23)

Review of the Digg AI news aggregator; full notes in `research/competitors/digg-ai.md`. Three mechanics are worth adopting — folded in here as follow-on enhancements, built *after* the core feed works, not before:

- **Story clustering.** AI news fragments across many documents about one event (a launch, a paper, a repo). Consolidate them into a single *story* unit — a `stories` table or a `cluster_id` on `documents`, populated by a clustering pass over embeddings + shared entities/links after pipeline step 6. The feed then ranks stories, not raw documents.
- **Velocity as a 4th score factor.** Recency ≠ velocity. Add the *rate* at which new mentions/links accumulate for a document/story across sources over a short window — this is what surfaces things early ("before it trends") rather than merely "recently". Keep it bot-discounted; never rank on raw engagement.
- **Entity momentum.** Lab computes per-entity change-in-attention (this window vs. prior) to surface "who/what is rising" — a later overlay on the web `/entities` view, not a Phase-1 deliverable.

Rejected and deferred items from the same review (X-only sourcing, engagement-as-ranking, influence-first thesis, X API as a paid source) stay in the research note as open decisions — not plan scope.

## Non-Goals

- A general web index or crawler archive.
- Knowledge-graph edges beyond the `document_entities` join.
- The 11-factor composite signal score.
- From-scratch / "tiny GPT" model training (a later research plan).
- A second datastore of any kind (ClickHouse, DuckDB, Meilisearch, Qdrant).
- Any non-laptop infra.
- Paid AI in the default path.
- Paid data sources — the milestone uses only free sources (HN, GitHub, papers, blogs). The X/Twitter API and other paid feeds are a deferred post-milestone decision; see `research/competitors/digg-ai.md`.

## Acceptance criteria

- A single local Postgres holds documents, repos, entities, links, and embeddings — nothing else added.
- HN + submitted URLs + one-hop links + the 14k repos are ingested, summarized, and entity-tagged.
- Keyword and semantic search both return useful results over the index.
- A ranked top-50 feed exists, scored by the 3 factors.
- Summaries run on local Qwen and entities on GLiNER, with no paid AI in the default path.
- The operator chooses to open the feed daily — the only success metric that counts.
