# Data-source catalog

> Generated from `python/ingest/src/high_signal_ingest/source_catalog.py`.
> Regenerate: `uv run python -m high_signal_ingest.source_catalog > ../../docs/operations/source-catalog.md`

## Storage model

Every event keeps source metadata, a link, and a deduplication key. Content depth varies by adapter:

- `source`, `source_url` (**the link**), `published_at`
- `title` plus adapter-specific `content`; most adapters cap it at 20 KB
- `raw_hash` / `document_key` for idempotent dedup, `primary_entity_id` when matched
- structured `raw_json` for selected APIs and documents

Generic news, SCMP, and broader China-news RSS currently fetch linked article pages and may keep up to 30 KB of extracted text. YouTube may keep up to 30 KB of transcript, EDGAR filings up to 50 KB, and review adapters may keep review text. These are not metadata-only integrations.

Persisted records live in **Cloudflare D1** (events/signals/evidence/source documents) plus git-versioned `signals/*.md`. The source audit records the access, retention, and terms risks that this compact catalog cannot express.

Digg is a deliberate rolling-feed exception: because Digg exposes rolling windows without a historical archive, High Signal retains its documented feed payloads and per-cluster snapshots in dedicated `digg_*` tables. Those rows are derived attention metadata, never event evidence.

Reddit is collected once into a private, immutable daily R2 partition. The scheduled pipeline and approved sibling products consume the same hash-verified compressed event export; they do not scrape Reddit independently. Reddit is attention metadata and cannot satisfy cite-or-kill.

## History / retention

**History depth** below = the default fetch window per run (how far back each daily run pulls). Wider one-off backfills pass a larger `--days`. Dedup is by `document_key`, so re-runs over the same window don't duplicate. No automatic D1 pruning today — events accumulate; the signal store is append-only by design.

## Sources

**55 sources.** Access: `keyless` = no auth; `free-key` = free registration (skipped without the env var, ingest stays green); `optional-key` = works degraded/empty without it. ⚖️ = counts toward the cite-or-kill official-source bar. **Temporal:** `recent` = only latest events matter; `historical` = full archive has value; `series` = time-series where both recent prints and historical trends matter.
**Cadence:** `daily` = included in the bounded `pipeline --source all` Daily Brief candidate run; `context` = separately refreshed calibration data; `weekly` / `monthly` = slower scheduled collection; `on_demand` / `manual` = explicit use only; `parked` = excluded from scheduled ingestion. Cadence describes execution policy, not whether an adapter produced rows.

| Source | Provider | Domain | Access | Cadence | ⚖️ | History | Role | Temporal | Content depth | Retention | Terms risk | Extracted fields kept |
|---|---|---|---|---|:--:|--:|---|---|---|---|---|---|
| `courtlistener` | CourtListener (litigation) | finance | keyless | daily | ⚖️ | 30d | corroboration | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | case name, court, nature of suit |
| `gov-contracts` | SAM / SBIR / USAspending | startups | optional-key:SAM_API_KEY | weekly | ⚖️ | 30d | corroboration | historical | metadata plus selected structured payload | D1 event history; source document retained when the adapter emits one. | not-reviewed | award/solicitation title, agency |
| `legistar` | Legistar/Granicus (municipal) | finance | keyless | weekly | ⚖️ | 30d | corroboration | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | matter title, body, file no. |
| `openstates` | OpenStates (state bills) | finance | free-key:OPENSTATES_API_KEY | weekly | ⚖️ | 30d | corroboration | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | bill id, title, latest action |
| `regulations` | Regulations.gov | finance | free-key:REGULATIONS_GOV_API_KEY | weekly | ⚖️ | 30d | corroboration | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | docket, comment window |
| `us-gov-rss` | SEC litigation / FTC / DOJ / CFTC / GAO / Nasdaq halts | finance | keyless | daily | ⚖️ | 7d | corroboration | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | release title, agency, halt symbol |
| `companies-house` | UK Companies House | startups | free-key:COMPANIES_HOUSE_API_KEY | manual | ⚖️ | 1d | entity | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | filing type, company |
| `edgar` | SEC EDGAR | finance | keyless | daily | ⚖️ | 1d | entity | historical | bounded filing text (up to 50 KB) | D1 event history; source document retained when the adapter emits one. | not-reviewed | form type, filing date, items |
| `github` | GitHub API | technology | keyless | daily |  | 7d | entity | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | repo, release, stars delta |
| `hkex` | HKEXnews | finance | keyless | daily | ⚖️ | 3d | entity | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | filing title, issuer |
| `huggingface` | Hugging Face Hub | technology | keyless | daily |  | 7d | entity | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | model/dataset, downloads |
| `india-gov` | SEBI / RBI / MOSPI / BSE / NSE / AMFI / NPCI / data.gov.in | finance | optional-key:DATA_GOV_IN_API_KEY | daily | ⚖️ | 3d | entity | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | circular, filing, CPI/IIP, NAV, UPI volume |
| `ir` | Investor-relations pages | finance | keyless | daily | ⚖️ | 1d | entity | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | headline, IR url |
| `jobs` | Greenhouse/Lever/Ashby | startups | keyless | daily |  | 14d | entity | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | role, company, location |
| `news` | NewsAPI + RSS | technology | free-key:NEWSAPI_KEY | daily |  | 1d | entity | recent | metadata plus linked-page text when fetched (up to 30 KB) | D1 event history; source document retained when the adapter emits one. | restricted | headline, source, snippet |
| `patents` | USPTO PatentsView (legacy probe; parked) | technology | parked:USPTO_ODP_API_KEY | parked |  | 365d | entity | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | credential-gated | patent title, assignee |
| `sec-xbrl` | SEC XBRL frames | finance | keyless | weekly | ⚖️ | 120d | entity | series | structured payload | D1 event history; source document retained when the adapter emits one. | not-reviewed | fundamental metric + value |
| `wikidata` | Wikidata | technology | keyless | manual |  | 1d | entity | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | entity enrichment fields |
| `bls` | BLS economic data | finance | optional-key:BLS_API_KEY | monthly | ⚖️ | 120d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | CPI / unemployment / payrolls latest print |
| `crypto-onchain` | mempool.space / L2Beat / CoinMetrics / Etherscan / Token Unlocks | finance | optional-key:ETHERSCAN_API_KEY,TOKEN_UNLOCKS_API_KEY | context |  | 1d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | fees, TVL+stage, active addresses, gas, unlock schedule |
| `eia` | EIA energy | finance | free-key:EIA_API_KEY | monthly | ⚖️ | 120d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | state, period, electricity price |
| `global-macro` | IMF / World Bank / BIS / UN Comtrade | finance | keyless | monthly | ⚖️ | 30d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | GDP, CPI, trade, exchange rate, policy rate |
| `macro-rates` | ECB FX + FRED | finance | optional-key:FRED_API_KEY | context |  | 30d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | series id, observation value |
| `us-gov-api` | CFTC COT / Treasury / BEA / Census / Congress / FEC / LDA / CFPB / FDA / NIH / NSF / USGS / NOAA / USDA | finance | optional-key:BEA_API_KEY,CENSUS_API_KEY,CONGRESS_API_KEY,FEC_API_KEY,LDA_API_KEY,FDA_API_KEY,USDA_NASS_API_KEY | weekly | ⚖️ | 30d | numeric | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | indicator, value, period; bills, votes, grants, complaints |
| `ai-benchmarks` | LMSYS Arena / Artificial Analysis / OpenRouter | technology | optional-key:ARTIFICIAL_ANALYSIS_API_KEY,OPENROUTER_API_KEY | daily |  | 1d | thematic | series | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | model name, ELO, intelligence index, token usage rank |
| `appstore` | Apple App Store charts | startups | keyless | weekly |  | 1d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | app name, developer, chart rank |
| `appstore-reviews` | App Store reviews (iTunes RSS) | startups | keyless | weekly |  | 14d | thematic | recent | bounded user review text (up to 20 KB) | D1 event history; source document retained when the adapter emits one. | user-content | review rating, title, text |
| `bluesky` | Bluesky | technology | optional-key:BLUESKY_* | parked |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | post text, author |
| `china-news` | TechNode / Pandaily / CGTN | technology / startups / finance | keyless | daily |  | 3d | thematic | recent | RSS metadata plus linked-page text when fetched (up to 30 KB) | D1 event history; source document retained when the adapter emits one. | not-reviewed | China tech/startup/business headline, link |
| `cisa-kev` | CISA KEV | technology | keyless | daily | ⚖️ | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | CVE id, vendor, due date |
| `coingecko` | CoinGecko | finance | keyless | weekly |  | 1d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | trending coin / 24h mover, rank, price |
| `defillama` | DeFiLlama | finance | keyless | weekly |  | 1d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | protocol TVL + 1d move, category |
| `dev-ecosystems` | Papers with Code / GitLab / Docker Hub / dev.to / libraries.io / Replicate | technology | optional-key:LIBRARIES_IO_API_KEY,REPLICATE_API_TOKEN | daily |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | paper, repo, image, article, package, model |
| `gdelt` | GDELT | finance | keyless | on_demand |  | 1d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | event, tone, mentions |
| `github-archive` | GH Archive | technology | keyless | parked |  | 1d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | event type, repo |
| `google-trends` | Google Trends (RSS) | startups | keyless | weekly |  | 2d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | trending search term, approx traffic |
| `gov` | Federal Register + agency RSS | finance | keyless | daily | ⚖️ | 3d | thematic | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | rule/notice title, agency |
| `guardian` | The Guardian | technology | free-key:GUARDIAN_API_KEY | parked |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | restricted | headline, section |
| `hackernews` | HN (Algolia) | technology | keyless | daily |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | title, points, comments, link |
| `lobsters` | Lobste.rs | technology | keyless | weekly |  | 3d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | story title, tags |
| `markets` | Polymarket/Manifold/Kalshi | finance | keyless | context |  | 30d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | question, probability (quote) |
| `metaculus` | Metaculus | finance | optional-key:METACULUS_TOKEN | parked |  | 30d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | question, community forecast |
| `nvd` | NVD (CVE) | technology | keyless | weekly |  | 14d | thematic | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | CVE id, CVSS, summary |
| `packages` | npm / PyPI / Rust / Java / Ruby / PHP + OSV | technology | keyless | daily |  | 7d | thematic | recent | metadata plus selected structured payload | D1 event history; source document retained when the adapter emits one. | not-reviewed | package, version, advisory |
| `playstore-reviews` | Google Play reviews | startups | keyless | weekly |  | 14d | thematic | recent | bounded user review text (up to 20 KB) | D1 event history; source document retained when the adapter emits one. | user-content | review rating, text |
| `podcast-index` | Podcast Index | technology | optional-key:PODCAST_INDEX_* | parked |  | 14d | thematic | recent | metadata plus selected structured payload | D1 event history; source document retained when the adapter emits one. | not-reviewed | episode title, summary |
| `producthunt` | Product Hunt (RSS) | startups | keyless | daily |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | product name, tagline, link |
| `reddit` | Reddit | startups | free-key:REDDIT_CLIENT_ID,REDDIT_CLIENT_SECRET | daily |  | 1d | thematic | recent | private post archive, relevant comment trees, and bounded derived event metadata | Private R2 daily archive plus D1 event history from the shared derived export. | restricted | post title, body, subreddit, attention metrics, relevant comments, archive provenance |
| `scmp` | South China Morning Post | technology / finance | keyless | daily |  | 3d | thematic | recent | RSS metadata plus linked-page text when fetched (up to 30 KB) | D1 event history; source document retained when the adapter emits one. | not-reviewed | China tech/economy headline, link |
| `semantic-scholar` | Semantic Scholar | technology | keyless | on_demand |  | 30d | thematic | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | paper title, abstract snippet |
| `stackexchange` | Stack Overflow | technology | keyless | on_demand |  | 30d | thematic | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | question, tags, score |
| `substack` | Substack RSS | technology | keyless | on_demand |  | 7d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | post title, summary |
| `techmeme` | Techmeme | technology | keyless | daily |  | 3d | thematic | recent | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | headline |
| `vc-portfolios` | YC, Antler, a16z, and Techstars official directories (parked placeholder) | startups | keyless | parked | ⚖️ | 30d | thematic | historical | metadata or bounded excerpt | D1 event history with canonical source link and deduplication metadata. | not-reviewed | company name, description, cohort/program, first-party evidence, inferred competitors |
| `youtube` | YouTube discovery + transcripts | technology | optional-key:YOUTUBE_API_KEY | on_demand |  | 7d | thematic | recent | metadata plus transcript when available (up to 30 KB) | D1 event history; source document retained when the adapter emits one. | unofficial-transcript | video title, view count, channel, transcript snippet when available |

**Role key:** *entity* = maps to a tracked company · *thematic* = topic/keyword (entity-less) · *corroboration* = official 2nd-source, mostly entity-less · *numeric* = time-series values.

**Temporal key:** *recent* = only the latest events matter — stale after days · *historical* = full history has value — patents, filings, court cases · *series* = time-series — both recent prints and historical trends matter.

## Derived attention overlays

- **Digg technology clusters** — five documented public JSON/YAML feeds, polled every 30 minutes with a server-enforced 10-minute minimum refresh interval. Stored as normalized current clusters plus append-only snapshots. Classification: `source_class=attention_aggregator`, `evidence_tier=derived`, `confidence_contribution=none`, `attention_contribution=allowed`. Digg can change discovery and brief prominence but cannot satisfy cite-or-kill or raise confidence.
- **Reddit daily archive** — one curated 99-community OAuth collection at 00:17 UTC. Private R2 stores compressed posts, relevance-filtered comment trees, an index, manifest and versioned event export. High Signal reads the same export before its 08:00 IST ingest; Reddit contributes attention only.

View the actual available data per source with the **data directory**: `uv run python -m high_signal_ingest.data_directory` → writes `data-directory/INDEX.md` + one JSON file of recent samples per source.

