# External References

Per the global doc rule: one-sentence "what / why it matters to this project /
link" per entry. Do not re-explain things that already have a definitive source.
For how each is used in this codebase, see the "where" column.

---

## NLP / NER

**GLiNER — Generalist Model for Named Entity Recognition**
Zero-shot NER using bidirectional transformer + span classification; handles
arbitrary label sets without fine-tuning.
Why it matters: lets the pipeline extract company/product/person mentions from
any source without labeled training data for the financial domain.
Paper: https://arxiv.org/abs/2311.08526
Where: `python/ingest/src/high_signal_ingest/extract/entities.py`,
`python/lab/src/high_signal_lab/extract_entities.py`

**GLiREL — Generalist Model for Relation Extraction**
Companion to GLiNER; extracts typed relation triples (e.g., "TSMC supplies NVDA")
in a zero-shot setting.
Why it matters: the spillover graph needs supply/customer/peer edges; GLiREL is
the planned path for automated edge discovery.
Paper: https://arxiv.org/abs/2501.03787
Where: `python/ingest/src/high_signal_ingest/extract/relations.py` (stubbed — returns
`[]` until validation infra is ready; see ADR-004 in `docs/architecture/decisions.md`)

**FinBERT — Financial Sentiment Analysis**
BERT fine-tuned on financial corpora (analyst reports, earnings calls, financial
news) for positive / negative / neutral classification.
Why it matters: domain-specific sentiment calibration on financial text
outperforms general BERT, which mis-reads phrases like "downside risk" or
"guidance raised."
Paper/model: https://huggingface.co/ProsusAI/finbert
Where: `python/ingest/src/high_signal_ingest/score/sentiment.py`

---

## Vector Search / Embeddings

**pgvector — Open-Source Vector Similarity Search for Postgres**
Postgres extension adding a `vector` type, HNSW and IVFFlat indexes, and cosine /
L2 / inner-product distance operators.
Why it matters: the Lab substrate uses it for semantic search over document
embeddings; keeps the stack at one DB (Postgres) rather than adding Qdrant or
Meilisearch.
Repo: https://github.com/pgvector/pgvector
Where: `python/lab/docker-compose.yml`, `python/lab/schema.sql`,
`python/lab/src/high_signal_lab/embed.py`

**sentence-transformers/all-MiniLM-L6-v2**
384-dimensional sentence embedding model; fast, CPU-friendly, good
semantic-search quality for English text.
Why it matters: free local embeddings for document/repo similarity in the Lab
substrate with no API key or GPU required.
Model card: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
Where: `python/lab/src/high_signal_lab/embed.py`

---

## Financial Data

**yfinance**
Unofficial Python wrapper for Yahoo Finance; provides historical OHLCV prices,
dividends, and metadata for equities, ETFs, indices, and crypto.
Why it matters: the only free daily price source that covers the 3,226-ticker
universe without a paid data license.
Repo: https://github.com/ranaroussi/yfinance
Where: `python/ingest/src/high_signal_ingest/sources/equities/yf.py`,
`python/ingest/src/high_signal_ingest/score/backtest.py`

**VectorBT — Backtesting Library**
High-performance vectorized backtesting using NumPy/pandas; handles portfolio
simulation, signal testing, and performance analytics.
Why it matters: planned for production backtest of signal hit-rates; currently
not used (hand-rolled forward-return math is sufficient for v0 — see
`docs/knowledge/learnings/lessons.md`).
Docs: https://vectorbt.dev
Where: planned for `python/ingest/src/high_signal_ingest/score/backtest.py`
(not yet wired)

---

## Graph

**NetworkX — Network Analysis in Python**
Pure-Python graph library; supports directed/undirected graphs, shortest paths,
centrality, and community detection.
Why it matters: the spillover map (TSMC capex → ASML → HBM → cloud capex) is a
directed graph BFS; NetworkX is the in-process engine for 2nd-order entity
prediction without standing up a graph DB.
Docs: https://networkx.org
Where: `python/ingest/src/high_signal_ingest/graph.py`

---

## Web Extraction

**Trafilatura — Web Scraping and Text Extraction**
Python library for extracting clean readable text from web pages; handles
boilerplate removal, date extraction, and metadata parsing.
Why it matters: the IR page adapter, the news RSS text fetcher, and the Lab
one-hop materialization all need clean article text without HTML noise; Trafilatura
is purpose-built for this.
Docs: https://trafilatura.readthedocs.io
Repo: https://github.com/adbar/trafilatura
Where: `python/ingest/src/high_signal_ingest/sources/ir.py`,
`python/lab/src/high_signal_lab/materialize.py`

---

## SEC Filings

**edgartools — SEC EDGAR Python Client**
Python library for fetching and parsing SEC filings (8-K, 10-K, 10-Q, Form D,
Form 4, 13F-HR, S-1) using the EDGAR EFTS and full-text search APIs.
Why it matters: SEC filings are the highest-reliability capital-event signal
source; edgartools handles the EDGAR quirks (XBRL, full-text search index,
multi-document filing packages) so the adapter stays focused on signal extraction.
Repo: https://github.com/dgunning/edgartools
Where: `python/ingest/src/high_signal_ingest/sources/edgar.py`
