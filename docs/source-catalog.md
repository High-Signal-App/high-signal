# Data-source catalog

> Generated from `python/ingest/src/high_signal_ingest/source_catalog.py`.
> Regenerate: `uv run python -m high_signal_ingest.source_catalog > ../../docs/source-catalog.md`

## Storage model

**We extract info and keep the link** — we do *not* store raw payloads (HTML / PDF / JSON / full article or opinion text) that are one query away from the source. Each event persists only:

- `source`, `source_url` (**the link**), `published_at`
- a short `title` + an extracted `content` summary (hard cap **20 KB**, typically <2 KB)
- `raw_hash` / `document_key` for idempotent dedup, `primary_entity_id` when matched

Persisted in **Cloudflare D1** (events/signals/evidence) + git-versioned `signals/*.md`. Footprint is **KB/day of new signals, low-MB total** — the cost center is LLM tokens, not storage.

## History / retention

**History depth** below = the default fetch window per run (how far back each daily run pulls). Wider one-off backfills pass a larger `--days`. Dedup is by `document_key`, so re-runs over the same window don't duplicate. No automatic D1 pruning today — events accumulate; the signal store is append-only by design.

## Sources

**52 sources.** Access: `keyless` = no auth; `free-key` = free registration (skipped without the env var, ingest stays green); `optional-key` = works degraded/empty without it. ⚖️ = counts toward the cite-or-kill official-source bar.

| Source | Provider | Domain | Access | ⚖️ | History | Role | Extracted fields kept |
|---|---|---|---|:--:|--:|---|---|
| `courtlistener` | CourtListener (litigation) | finance | keyless | ⚖️ | 30d | corroboration | case name, court, nature of suit |
| `gov-contracts` | SAM / SBIR / USAspending | startups | optional-key:SAM_API_KEY | ⚖️ | 30d | corroboration | award/solicitation title, agency |
| `legistar` | Legistar/Granicus (municipal) | finance | keyless | ⚖️ | 30d | corroboration | matter title, body, file no. |
| `openstates` | OpenStates (state bills) | finance | free-key:OPENSTATES_API_KEY | ⚖️ | 30d | corroboration | bill id, title, latest action |
| `regulations` | Regulations.gov | finance | free-key:REGULATIONS_GOV_API_KEY | ⚖️ | 30d | corroboration | docket, comment window |
| `us-gov-rss` | SEC litigation / FTC / DOJ / CFTC / GAO / Nasdaq halts | finance | keyless | ⚖️ | 7d | corroboration | release title, agency, halt symbol |
| `companies-house` | UK Companies House | startups | free-key:COMPANIES_HOUSE_API_KEY | ⚖️ | 1d | entity | filing type, company |
| `edgar` | SEC EDGAR | finance | keyless | ⚖️ | 1d | entity | form type, filing date, items |
| `github` | GitHub API | technology | keyless |  | 7d | entity | repo, release, stars delta |
| `hkex` | HKEXnews | finance | keyless | ⚖️ | 3d | entity | filing title, issuer |
| `huggingface` | Hugging Face Hub | technology | keyless |  | 7d | entity | model/dataset, downloads |
| `india-gov` | SEBI / RBI / MOSPI / BSE / NSE / AMFI / NPCI / data.gov.in | finance | optional-key:DATA_GOV_IN_API_KEY | ⚖️ | 3d | entity | circular, filing, CPI/IIP, NAV, UPI volume |
| `ir` | Investor-relations pages | finance | keyless | ⚖️ | 1d | entity | headline, IR url |
| `jobs` | Greenhouse/Lever/Ashby | startups | keyless |  | 14d | entity | role, company, location |
| `news` | NewsAPI + RSS | technology | free-key:NEWSAPI_KEY |  | 1d | entity | headline, source, snippet |
| `patents` | USPTO PatentsView | technology | keyless |  | 365d | entity | patent title, assignee |
| `sec-xbrl` | SEC XBRL frames | finance | keyless | ⚖️ | 120d | entity | fundamental metric + value |
| `wikidata` | Wikidata | technology | keyless |  | 1d | entity | entity enrichment fields |
| `bls` | BLS economic data | finance | optional-key:BLS_API_KEY | ⚖️ | 120d | numeric | CPI / unemployment / payrolls latest print |
| `crypto-onchain` | mempool.space / L2Beat / CoinMetrics / Etherscan / Token Unlocks | finance | optional-key:ETHERSCAN_API_KEY,TOKEN_UNLOCKS_API_KEY |  | 1d | numeric | fees, TVL+stage, active addresses, gas, unlock schedule |
| `eia` | EIA energy | finance | free-key:EIA_API_KEY | ⚖️ | 120d | numeric | state, period, electricity price |
| `global-macro` | IMF / World Bank / BIS / UN Comtrade | finance | keyless | ⚖️ | 30d | numeric | GDP, CPI, trade, exchange rate, policy rate |
| `macro-rates` | ECB FX + FRED | finance | optional-key:FRED_API_KEY |  | 30d | numeric | series id, observation value |
| `us-gov-api` | CFTC COT / Treasury / BEA / Census / Congress / FEC / LDA / CFPB / FDA / NIH / NSF / USGS / NOAA / USDA | finance | optional-key:BEA_API_KEY,CENSUS_API_KEY,CONGRESS_API_KEY,FEC_API_KEY,LDA_API_KEY,FDA_API_KEY,USDA_NASS_API_KEY | ⚖️ | 30d | numeric | indicator, value, period; bills, votes, grants, complaints |
| `ai-benchmarks` | LMSYS Arena / Artificial Analysis / OpenRouter | technology | optional-key:ARTIFICIAL_ANALYSIS_API_KEY,OPENROUTER_API_KEY |  | 1d | thematic | model name, ELO, intelligence index, token usage rank |
| `appstore` | Apple App Store charts | startups | keyless |  | 1d | thematic | app name, developer, chart rank |
| `appstore-reviews` | App Store reviews (iTunes RSS) | startups | keyless |  | 14d | thematic | review rating, title, text |
| `bluesky` | Bluesky | technology | optional-key:BLUESKY_* |  | 7d | thematic | post text, author |
| `cisa-kev` | CISA KEV | technology | keyless | ⚖️ | 7d | thematic | CVE id, vendor, due date |
| `coingecko` | CoinGecko | finance | keyless |  | 1d | thematic | trending coin / 24h mover, rank, price |
| `defillama` | DeFiLlama | finance | keyless |  | 1d | thematic | protocol TVL + 1d move, category |
| `dev-ecosystems` | Papers with Code / GitLab / Docker Hub / dev.to / libraries.io / Replicate | technology | optional-key:LIBRARIES_IO_API_KEY,REPLICATE_API_TOKEN |  | 7d | thematic | paper, repo, image, article, package, model |
| `gdelt` | GDELT | finance | keyless |  | 1d | thematic | event, tone, mentions |
| `github-archive` | GH Archive | technology | keyless |  | 1d | thematic | event type, repo |
| `google-trends` | Google Trends (RSS) | startups | keyless |  | 2d | thematic | trending search term, approx traffic |
| `gov` | Federal Register + agency RSS | finance | keyless | ⚖️ | 3d | thematic | rule/notice title, agency |
| `guardian` | The Guardian | technology | free-key:GUARDIAN_API_KEY |  | 7d | thematic | headline, section |
| `hackernews` | HN (Algolia) | technology | keyless |  | 7d | thematic | title, points, comments, link |
| `lobsters` | Lobste.rs | technology | keyless |  | 3d | thematic | story title, tags |
| `markets` | Polymarket/Manifold/Kalshi | finance | keyless |  | 30d | thematic | question, probability (quote) |
| `metaculus` | Metaculus | finance | optional-key:METACULUS_TOKEN |  | 30d | thematic | question, community forecast |
| `nvd` | NVD (CVE) | technology | keyless |  | 14d | thematic | CVE id, CVSS, summary |
| `packages` | npm / PyPI / Rust / Java / Ruby / PHP + OSV | technology | keyless |  | 7d | thematic | package, version, advisory |
| `playstore-reviews` | Google Play reviews | startups | keyless |  | 14d | thematic | review rating, text |
| `podcast-index` | Podcast Index | technology | optional-key:PODCAST_INDEX_* |  | 14d | thematic | episode title, summary |
| `producthunt` | Product Hunt (RSS) | startups | keyless |  | 7d | thematic | product name, tagline, link |
| `reddit` | Reddit | startups | keyless |  | 1d | thematic | post title, subreddit, score |
| `semantic-scholar` | Semantic Scholar | technology | keyless |  | 30d | thematic | paper title, abstract snippet |
| `stackexchange` | Stack Overflow | technology | keyless |  | 30d | thematic | question, tags, score |
| `substack` | Substack RSS | technology | keyless |  | 7d | thematic | post title, summary |
| `techmeme` | Techmeme | technology | keyless |  | 3d | thematic | headline |
| `youtube` | YouTube transcripts | technology | optional-key:YOUTUBE_API_KEY |  | 7d | thematic | video title, transcript snippet |

**Role key:** *entity* = maps to a tracked company · *thematic* = topic/keyword (entity-less) · *corroboration* = official 2nd-source, mostly entity-less · *numeric* = time-series values.

View the actual available data per source with the **data directory**: `uv run python -m high_signal_ingest.data_directory` → writes `data-directory/INDEX.md` + one JSON file of recent samples per source.

