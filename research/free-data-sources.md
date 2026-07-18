# Free data sources — deep research

> **Scope:** every free (keyless or free-registration-key) data source that adds **net-new value** to the High Signal Daily Brief, verified June 2026.
> **Target regions: India + US.** Other-region sources are included only when globally relevant (IMF, World Bank) or when they cover entities/sectors that matter to India+US readers. EU/Japan/Korea/Brazil-only sources are demoted to Tier 2.
> **Method:** 7 parallel research subagents did live web searches across finance, crypto, startups, tech/dev/AI, news/media, government/policy/legal (US+intl), and India-specific sources. Findings were cross-checked against the existing 45 sources in `source_catalog.py` and deduplicated.
> **Existing 45 sources** (do NOT re-add): `edgar, sec-xbrl, hkex, ir, companies-house, github, github-archive, huggingface, packages, patents, semantic-scholar, reddit, hackernews, stackexchange, producthunt, google-trends, appstore, appstore-reviews, playstore-reviews, lobsters, bluesky, youtube, substack, techmeme, podcast-index, news, guardian, gdelt, gov, gov-contracts, regulations, legistar, openstates, courtlistener, markets, metaculus, coingecko, defillama, bls, macro-rates, eia, wikidata, nvd, cisa-kev, jobs`. Plus yfinance EOD for the equities snapshot (not a catalog source; covers Indian tickers via `.NS`/`.BO`).

## How to read this doc

- **Tier 1** = ship next. High net-new value for India+US, official where possible, easy to wire.
- **Tier 2** = ship after Tier 1 is stable. Strong value but more friction, or non-target-region.
- **Tier 3** = nice-to-have. Adds breadth but lower marginal signal.
- **Deferred — paid only** = confirmed no viable free tier. Listed so we don't re-research.
- **Official (⚖️)** = counts toward the cite-or-kill ≥2-source bar. Government / regulator / exchange / central bank / on-chain RPC.

---

## Tier 1 — ship next

### US government / regulators / macro (official, cite-or-kill moat)

| ID | Provider | Endpoint | Access | Data | History | Official | Net-new value |
|---|---|---|---|---|---|:--:|---|
| `cftc-cot` | CFTC | `https://publicreporting.cftc.gov/resource/jun7-fc8e.json` (Socrata) | keyless | Weekly Commitments of Traders — futures positioning | since 2020 | ⚖️ | Unique positioning/sentiment signal; nothing in stack covers this |
| `treasury-yields` | US Treasury | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml` | keyless | Daily Treasury par yield curve, bill rates, long-term rates | decades | ⚖️ | Canonical US yield curve; complements FRED |
| `bea` | Bureau of Economic Analysis | `https://apps.bea.gov/api` | free-key | US GDP, trade balance, personal income, corporate profits | decades | ⚖️ | Official US national accounts; distinct from BLS/FRED |
| `census` | US Census Bureau | `https://api.census.gov/data` | free-key | Retail sales, trade, **business formations**, demographics | decades | ⚖️ | Business Formation Statistics = startup signal; retail sales = demand |
| `sec-litigation` | SEC | `https://www.sec.gov/enforcement-litigation/litigation-releases` (RSS) | keyless | SEC civil litigation releases | 1995+ | ⚖️ | SEC enforcement — distinct from EDGAR filings |
| `ftc` | FTC | `https://www.ftc.gov/feeds/press-release.xml` (RSS) | keyless | FTC press releases (competition, consumer protection, HSR) | years | ⚖️ | Antitrust/consumer-protection enforcement |
| `doj-antitrust` | DOJ Antitrust | `https://www.justice.gov/atr/rss/atr_press.xml` (RSS) | keyless | Antitrust civil/criminal case filings | 2009+ | ⚖️ | Antitrust enforcement; distinct from general DOJ |
| `cftc-press` | CFTC | `https://www.cftc.gov/PressRoom/PressReleases` (RSS/web) | keyless | Press releases, enforcement, policy statements | — | ⚖️ | Derivatives/crypto enforcement; complements COT data |
| `cfpb-complaints` | CFPB | `https://cfpb.github.io/api/ccdb/` | keyless | Consumer financial-product complaints | 2004+ | ⚖️ | Consumer-harm signal; daily updates |
| `nasdaq-halts` | Nasdaq | `https://nasdaqtrader.com/Trader.aspx?id=TradeHaltRSS` (RSS) | keyless | Trading halts/pauses across exchanges | current+historical | ⚖️ | Real-time market-disruption signal |
| `congress` | Congress.gov (LoC) | `https://api.congress.gov/v3` | free-key (Data.gov) | Bills, amendments, laws, nominations, treaties, **House votes** | 1973+ | ⚖️ | Federal legislative data; distinct from Federal Register + OpenStates |
| `senate-votes` | US Senate | `https://www.senate.gov/legislative/LIS/roll_call_votes/` (XML) | keyless | Senate roll call votes with member positions | 1989+ | ⚖️ | Senate votes NOT in Congress.gov API |
| `fec` | FEC (openFEC) | `https://api.open.fec.gov/` | free-key | Campaign finance, contributions, independent expenditures | 1980+ | ⚖️ | Political-money data; new domain |
| `lda` | Senate Office of Public Records | `https://lda.gov/api/` | free-key | Lobbying registrations (LD-1), activity (LD-2), contributions (LD-203) | 1998+ | ⚖️ | Federal lobbying disclosures; new domain |
| `gao` | U.S. GAO | `https://www.gao.gov/rss-feeds` (RSS) | keyless | Reports, testimonies, bid protests, legal decisions | 58,931 reports | ⚖️ | Government accountability audits |
| `crs` | EveryCRSReport.com | `https://www.everycrsreport.com/reports.csv` (CSV) | keyless | Congressional Research Service reports | 23,251 reports | N | Non-partisan policy analysis (content is official CRS) |
| `fda` | FDA (openFDA) | `https://api.fda.gov/` | free-key | Drug approvals, recalls, adverse events (FAERS), enforcement | 1939+ | ⚖️ | Healthcare/biotech regulation; new domain |
| `nih-reporter` | NIH | `https://api.reporter.nih.gov/` | keyless | Research grants, projects, publications, PIs | — | ⚖️ | $42B/yr federal research funding; R&D signal |
| `nsf-awards` | NSF | `http://api.nsf.gov/services/v1/awards` | keyless | Research awards, project outcomes, publications | — | ⚖️ | Federal research funding; complements NIH |
| `usgs-earthquakes` | USGS | `https://earthquake.usgs.gov/fdsnws/event/1/` | keyless | Earthquake catalog, real-time feeds | — | ⚖️ | Natural-disaster data; supply-chain signal |
| `noaa-weather` | NOAA NWS | `https://api.weather.gov` | keyless | Forecasts, alerts, observations | — | ⚖️ | Weather/climate data; new domain |
| `usda-nass` | USDA NASS | `https://quickstats.nass.usda.gov/api/` | free-key | Agricultural statistics: crops, livestock, prices | varies | ⚖️ | Agricultural/commodity data; new domain |

### India government / regulators / macro (official, fills India gap)

| ID | Provider | Endpoint | Access | Data | History | Official | Net-new value |
|---|---|---|---|---|---|:--:|---|
| `sebi` | SEBI | `https://www.sebi.gov.in/rss/` (RSS) | keyless | SEBI circulars, orders, press releases | recent | ⚖️ | India's SEC — regulatory announcements; no equivalent in current stack |
| `rbi` | Reserve Bank of India | `https://www.rbi.org.in/Scripts/RSS.aspx` (RSS) | keyless | RBI press releases, monetary policy, circulars | recent | ⚖️ | India's central bank — monetary policy, rates; complements ECB/FRED |
| `mospi` | MOSPI eSankhyiki | `https://api.mospi.gov.in` + MCP at `https://mcp.mospi.gov.in/` | keyless | CPI, IIP, GDP, PLFS, WPI — 500+ indicators across 23 datasets | varies | ⚖️ | India's official statistical office; no-auth REST + MCP server; India equivalent of BLS/BEA |
| `data-gov-in` | data.gov.in | `https://data.gov.in/api` | free-key | Indian government open data across ministries | varies | ⚖️ | India's Data.gov; broad government datasets |
| `bse-announcements` | BSE India | `https://www.bseindia.com/rss-feed.html` (RSS) | keyless | Corporate announcements, filings, actions | recent | ⚖️ | India exchange filings; complements yfinance price data for `.BO` tickers |
| `nse-announcements` | NSE India | `https://www.nseindia.com/api/` (web JSON) | keyless | Corporate announcements, circulars | recent | ⚖️ | India exchange filings; complements yfinance for `.NS` tickers. ⚠️ unofficial JSON endpoints, anti-bot headers |
| `amfi` | AMFI / mfapi.in | `https://api.mfapi.in` | keyless | Mutual fund NAV, portfolio holdings — 14,000+ schemes | 18 yrs | ⚖️ | Indian mutual fund data; unique to India |
| `upi-npci` | NPCI | `https://www.npci.org.in/what-we-do/upi/product-statistics` (web tables) | keyless | UPI digital payments volume/value — monthly | 2016+ | ⚖️ | India's flagship digital payments signal; fintech adoption metric. ⚠️ web tables, no API — needs scraping |
| `rbi-payments` | RBI | `https://www.rbi.org.in/scripts/EntityWiseRetailStatistics.aspx` (web tables) | keyless | UPI, IMPS, NETC, AePS payment stats | 2021+ | ⚖️ | Official payment systems data; complements NPCI. ⚠️ web tables |

### Global macro (official, relevant to India + US)

| ID | Provider | Endpoint | Access | Data | History | Official | Net-new value |
|---|---|---|---|---|---|:--:|---|
| `imf` | IMF | `https://dataservices.imf.org/REST/SDMX_JSON.svc` | keyless | World Economic Outlook, BOP, International Financial Statistics | 50+ yrs | ⚖️ | International macro covering both India + US; SDMX/JSON |
| `worldbank` | World Bank | `https://api.worldbank.org/v2` | keyless | 16,000 indicators (GDP, population, trade) | 50+ yrs | ⚖️ | Global development macro; covers India + US deeply |
| `bis` | Bank for International Settlements | `https://stats.bis.org/api/v1` | keyless | International banking, derivatives, effective exchange rates | varies | ⚖️ | Central-bank-cooperation data; unique derivatives/banking series |
| `un-comtrade` | UN Statistics | `https://comtradedeveloper.un.org` | free-tier | International trade statistics by country/product/partner | 1962+ | ⚖️ | 99% of world merchandise trade; India+US bilateral trade data |

### Crypto / on-chain (global, fills on-chain gap)

| ID | Provider | Endpoint | Access | Data | History | Official | Net-new value |
|---|---|---|---|---|---|:--:|---|
| `etherscan` | Etherscan | `https://api.etherscan.io/api` | free-key | On-chain txs, contract events, gas, token transfers | full chain | ⚖️ (on-chain) | Raw on-chain data; multi-chain on free tier |
| `mempool-space` | mempool.space | `https://mempool.space/api` | keyless | Bitcoin mempool stats, fee estimation, blocks | full chain | ⚖️ (on-chain) | Bitcoin network health; only free mempool/fee source |
| `token-unlocks` | oanor (DeFiLlama emissions) | `https://api.oanor.com/tokenunlocks-api` | free-key | Token vesting schedules, upcoming unlocks | forward-looking | N | Unique predictive supply-pressure data |
| `l2beat` | L2Beat | `https://l2beat.com/api/tvl.json` (undocumented) | keyless | L2 rollup TVL + **risk assessments** (Stage 0/1/2) | multi-year | N | L2 risk framework; complements DeFiLlama. ⚠️ undocumented API |
| `coinmetrics` | CoinMetrics Community | `https://community-api.coinmetrics.io/v4` | keyless | On-chain metrics (active addresses, fees, supply) | limited | N | Institutional-grade on-chain metrics; Creative Commons |

### US + India news / media (RSS corroboration — cheap, high volume)

#### US news

| ID | Provider | Endpoint | Access | Official | Net-new value |
|---|---|---|---|:--:|---|
| `cnbc` | CNBC | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id={id}` | keyless | N | Markets/business; finance domain |
| `marketwatch` | MarketWatch | `http://feeds.marketwatch.com/marketwatch/{slug}` | keyless | N | Markets; finance domain |
| `seeking-alpha` | Seeking Alpha | `https://seekingalpha.com/market_currents.xml` | keyless | N | Stocks/analysis; finance domain |
| `politico` | Politico | `https://rss.politico.com/{section}.xml` | keyless | N | Policy/tech/economy intersection |
| `the-hill` | The Hill | `https://thehill.com/{section}/feed/` | keyless | N | Policy/tech/business |
| `semafor` | Semafor | `https://semafor.com/rss.xml` | keyless | N | Tech/business/global |
| `axios` | Axios | `https://api.axios.com/feed/` | keyless | N | Tech policy, AI regulation. ⚠️ HTML-escaping issue |
| `washington-post` | Washington Post | `https://feeds.washingtonpost.com/rss/{section}` | keyless | N | Tech/business/policy |
| `nyt` | New York Times | `https://api.nytimes.com/` | free-key | N | 500 req/day, 10K/month free tier |
| `bbc` | BBC News | `https://feeds.bbci.co.uk/news/rss.xml` | keyless | N | Mainstream international; near-realtime |
| `the-verge` | The Verge | `https://www.theverge.com/rss/index.xml` | keyless | N | Consumer tech, AI, policy (excerpts only) |
| `ars-technica` | Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | keyless | N | In-depth tech/science |
| `rest-of-world` | Rest of World | `https://restofworld.org/feed/latest` | keyless | N | Global tech outside US/W. Europe |

#### India news

| ID | Provider | Endpoint | Access | Official | Net-new value |
|---|---|---|---|:--:|---|
| `india-hindu` | The Hindu | `https://www.thehindu.com/rssfeeds/` | keyless | N | Business, economy, markets; authoritative Indian broadsheet |
| `india-business-standard` | Business Standard | `https://www.business-standard.com/rss-feeds/listing` | keyless | N | Markets, companies, economy; top Indian business daily |
| `india-moneycontrol` | Moneycontrol | `https://www.moneycontrol.com/india/newsarticle/rssfeeds/rssfeeds.php` | keyless | N | Markets, IPOs, startups; multiple section feeds |
| `india-cnbc-tv18` | CNBC TV18 | `https://www.cnbctv18.com/rss/` | keyless | N | Markets, business, technology; real-time Indian market news |
| `india-ht` | Hindustan Times | `https://www.hindustantimes.com/rss` | keyless | N | India news, business, tech |
| `india-express` | Indian Express | `https://indianexpress.com/feed` | keyless | N | India news, economy, business |
| `india-et` | Economic Times | `https://economictimes.indiatimes.com/rssfeeds/{id}.cms` | keyless | N | Finance, business, tech. ⚠️ non-commercial use only |
| `india-mint` | Mint / Livemint | `https://www.livemint.com/rss/{section}` | keyless | N | Finance, business, tech. ⚠️ non-commercial use only |
| `india-deccan-herald` | Deccan Herald | `http://www.deccanherald.com/rss/` | keyless | N | Business, technology; regional + business |

### US + India startups / VC / analysis (RSS)

#### US startups/VC

| ID | Provider | Endpoint | Access | Net-new value |
|---|---|---|---|---|
| `crunchbase-news` | Crunchbase News | `https://news.crunchbase.com/feed/` | keyless | Editorial funding/M&A/IPO news (separate from paid API) |
| `strictlyvc` | StrictlyVC | `https://feeds.buzzsprout.com/850276.rss` | keyless | VC news, deal flow |
| `fortune-termsheet` | Fortune Term Sheet | `https://fortune.com/newsletter/termsheet/feed/feed` | keyless | PE/VC deals, M&A |
| `lennys` | Lenny's Newsletter | `https://www.lennysnewsletter.com/feed` | keyless | Product management, AI tools, job market data |
| `a16z` | a16z | `https://www.a16z.news/feed` | keyless | Tech trends, policy, portfolio updates |
| `indiehackers` | Indie Hackers | `https://www.indiehackers.com/feed.rss` | keyless | Bootstrapped founder signals, real revenue data |
| `saastr` | SaaStr | `https://www.saastr.com/feed/` | keyless | SaaS metrics, scaling advice, funding benchmarks |
| `firstround` | First Round Review | `https://review.firstround.com/rss` | keyless | Startup tactics, founder interviews |
| `benedict-evans` | Benedict Evans | `https://www.ben-evans.com/benedictevans/rss.xml` | keyless | Tech strategy, AI; high-signal analyst |
| `not-boring` | Not Boring | `https://www.notboring.co/feed` | keyless | Tech strategy, startups |
| `the-generalist` | The Generalist | `https://www.generalist.com/feed` | keyless | Tech, startups, VC |
| `net-interest` | Net Interest | `https://www.netinterest.co/feed` | keyless | Finance, banking |
| `margins` | Margins / The Diff | `https://byrnehobart.substack.com/feed` | keyless | Finance, tech (free tier) |

#### India startups/VC

| ID | Provider | Endpoint | Access | Net-new value |
|---|---|---|---|---|
| `india-yourstory` | YourStory | `http://yourstory.com/feed` | keyless | India's largest startup platform; funding, entrepreneurship |
| `india-inc42` | Inc42 | `https://inc42.com/feed` | keyless | Indian startup ecosystem; 13K+ stories, funding reports |
| `india-entrackr` | Entrackr | `https://entrackr.com/rss` | keyless | Independent startup funding news; weekly funding reports |
| `india-analytics-mag` | Analytics India Magazine | `http://analyticsindiamag.com/feed` | keyless | AI, data science, tech — India-focused; 24K+ articles |

### Tech / dev / AI (global, relevant to India + US)

| ID | Provider | Endpoint | Access | Official | Net-new value |
|---|---|---|---|:--:|---|
| `artificial-analysis` | Artificial Analysis | `https://api.artificialanalysis.ai/` | free-key | N | AI model benchmarks (intelligence, speed, pricing); 1,000 req/day |
| `openrouter-data` | OpenRouter | `https://openrouter.ai/api/v1/data` | free-key | N | Model usage rankings, benchmarks; 500 req/day |
| `lmsys` | LMSYS Chatbot Arena | `https://api.wulong.dev/` (unofficial) | keyless | N | LLM ELO leaderboards. ⚠️ unofficial API |
| `papers-with-code` | Papers with Code | `https://paperswithcode.com/api/v1/` | keyless | N | Papers + code implementations; complements Semantic Scholar |
| `replicate` | Replicate Hub | `https://api.replicate.com/v1/models` | free-key | N | AI model hub; complements HuggingFace |
| `libraries-io` | libraries.io | `https://libraries.io/api/` | free-key | N | Cross-platform package metadata; 60 req/min |
| `crates-io` | Crates.io | `https://crates.io/api/v1/` | keyless | N | Rust ecosystem |
| `maven-central` | Maven Central | `https://search.maven.org/solrsearch/select` | keyless | N | Java/enterprise ecosystem |
| `rubygems` | RubyGems | `https://rubygems.org/api/v1/` | keyless | N | Ruby ecosystem |
| `packagist` | Packagist | `https://packagist.org/packages/{vendor}/{package}.json` | keyless | N | PHP ecosystem |
| `gitlab` | GitLab | `https://gitlab.com/api/v4/` | keyless (optional) | N | Git forge beyond GitHub |
| `docker-hub` | Docker Hub | `https://hub.docker.com/v2/repositories/` | keyless | N | Container registry usage; DevOps signal |
| `devto` | dev.to | `https://dev.to/api/` | keyless | N | Developer community content |

### India markets / economy (non-official but high-value)

| ID | Provider | Endpoint | Access | Official | Net-new value |
|---|---|---|---|:--:|---|
| `india-screener` | Screener.in | `https://www.screener.in/` (web scraping) | keyless | N | Indian stock fundamentals, 10+ yrs history; most comprehensive free source. ⚠️ no official API; use MCP/scraper with rate limiting |
| `india-mfdata` | mfdata.in | `https://mfdata.in/api/v1/` | keyless | N | Mutual fund NAV, holdings, ratios; more comprehensive than AMFI API |
| `india-naukri` | Naukri.com | `https://www.naukri.com/jobapi/v3/search` (unofficial) | keyless | N | Indian job market trends, skill demand. ⚠️ unofficial; 3-7 sec delay between requests |

---

## Tier 2 — ship after Tier 1 is stable

### Other-region official sources (demoted — ship when expanding beyond India+US)

| ID | Provider | Access | Data | Why Tier 2 |
|---|---|---|---|---|
| `edinet` | FSA Japan | free-key | Japanese corporate filings | Japan not a target region |
| `dart` | FSS Korea | free-key | Korean corporate filings | Korea not a target region |
| `cvm-brazil` | CVM Brazil | keyless | Brazilian corporate filings | Brazil not a target region |
| `boj` | Bank of Japan | keyless | Japanese monetary stats | Japan not a target region |
| `boe` | Bank of England | keyless | UK bank rate, yield curves, FX | UK not a target region |
| `hkma` | HKMA | keyless | HK exchange/banking stats | HK already covered via HKEX |
| `mas` | MAS Singapore | free-key | Singapore financial data | Singapore not a target region |
| `esma` | ESMA (EU) | keyless | EU regulatory registers | EU not a target region |
| `fca` | FCA (UK) | free-key | UK financial regulator | UK not a target region |
| `oecd` | OECD | keyless | Advanced-economy stats | Partially redundant with IMF/World Bank for India+US |
| `eurostat` | Eurostat (EU) | keyless | EU statistics | EU not a target region |

### Additional crypto / on-chain

| ID | Provider | Access | Data | Why Tier 2 |
|---|---|---|---|---|
| `opensea` | OpenSea | free-key (instant) | NFT marketplace data | NFT niche; ⚠️ keys expire 30 days |
| `dune` | Dune Analytics | free-key | SQL queries over on-chain data | Overlaps with Etherscan for basic needs; 2,500 credits/mo |
| `thegraph` | The Graph | free-key | Protocol-specific subgraphs | Overlaps with Etherscan; niche use cases |
| `flipside` | Flipside Crypto | free-key | Multi-chain SQL, labeled data | Overlaps with Dune |
| `messari` | Messari | free-key | Research reports, governance | Limited free API; qualitative |
| `magic-eden` | Magic Eden | keyless (public reads) | NFT marketplace | Overlaps with OpenSea |
| `blockscout` | Blockscout | keyless | Multi-chain EVM explorer | Overlaps with Etherscan |
| `helius` | Helius | free-key | Enhanced Solana RPC | Solana-specific; niche |
| `stablecoinstats` | StablecoinStats | keyless | Stablecoin market caps | Overlaps with DeFiLlama stablecoins |

### Additional tech / dev

| ID | Provider | Access | Data | Why Tier 2 |
|---|---|---|---|---|
| `littlesis` | LittleSis | keyless | Political influence networks | US-only; needs entity-mapping work |
| `kaggle` | Kaggle | free-key | Datasets, competitions | Overlaps with HuggingFace datasets |
| `pepy-tech` | pepy.tech | free-key | PyPI download counts | Complements npm; 90-day history, 5 RPM |
| `homebrew-formulae` | Homebrew | keyless | macOS/Linux packages | Niche |
| `pub-dev` | pub.dev | keyless | Flutter/Dart packages | Niche |
| `nuget` | NuGet | keyless | .NET packages | Niche |
| `go-proxy` | Go module proxy | keyless | New Go module versions | Niche |
| `bitbucket` | Bitbucket | keyless | Repositories, PRs | Overlaps with GitHub/GitLab |
| `codeberg` | Codeberg | keyless | Gitea repositories | Niche |
| `common-crawl` | Common Crawl | keyless (S3) | Web crawl corpus | High infra cost |
| `wayback` | Wayback Machine | keyless | Historical web snapshots | Provenance use, not daily ingest |

### Additional news / newsletters (lower priority)

| ID | Provider | Access | Why Tier 2 |
|---|---|---|---|
| `india-toi` | Times of India | keyless | ⚠️ restrictive terms: personal use only, no commercial aggregation |
| `india-deccan` | Deccan Herald | keyless | Regional; lower relevance |
| `garbage-day` | Garbage Day | keyless | Internet culture; niche |
| `1440` | 1440 Daily Digest | keyless | General news; overlaps with existing bundle |
| `govexec` | GovExec | keyless | US gov tech; niche vertical |
| `fierce-biotech` | Fierce Biotech | keyless | Biotech vertical; useful but niche |
| `retail-dive` | Retail Dive | keyless | Retail vertical; useful but niche |
| `wired` | Wired | keyless | Overlaps with Verge/Ars |
| `9to5mac` | 9to5Mac | keyless | Apple vertical; niche |
| `daring-fireball` | Daring Fireball | keyless | Apple vertical; niche |
| `six-colors` | Six Colors | keyless | Apple vertical; niche |
| `platformer` | Platformer | keyless | Moved off Substack; feed may be unstable |
| `hard-fork` | Hard Fork (NYT) | keyless | Covered via Podcast Index already |
| `daily-punch` | Punchbowl News | keyless | Policy podcast; niche |
| `india-vccircle` | VCCircle | scraping only | No official RSS; unofficial scrapers only |
| `india-peakxv` | Peak XV blog | keyless (blog) | No RSS; blog only |
| `india-accel` | Accel India | keyless (Medium) | Medium RSS; VC insights |
| `india-elevation` | Elevation Capital | keyless (blog) | No RSS; blog only |

### Research / academic (lower priority)

| ID | Provider | Access | Why Tier 2 |
|---|---|---|---|
| `plos-one` | PLOS ONE | keyless (RSS) | Open-access science; niche |
| `bair-blog` | BAIR Blog | keyless (RSS) | Berkeley AI research; niche |
| `distill` | Distill.pub | keyless (RSS) | Visual ML research; largely dormant |
| `a16z-state-of-crypto` | a16z crypto | keyless (PDF) | Not an API; citation source only |
| `electric-capital` | Electric Capital | keyless (PDF) | Not an API; citation source only |

---

## Deferred — paid only (confirmed no viable free tier, do not re-research)

### Finance / markets
- **Alpha Vantage** — 25 req/day free; impractical
- **Twelve Data** — 800 credits/day; impractical
- **Tiingo** — 500 symbols/month; news API paid
- **Marketstack** — 100 req/month; unusable
- **Polygon.io** — 5 calls/min; redundant with yfinance
- **Finnhub** — some endpoints moved to paid
- **CBOE DataShop** — paid subscription for VIX/put-call
- **Conference Board LEI** — paid subscription
- **NFIB Small Business Optimism** — no public API
- **AAII Sentiment Survey** — $199/yr for API
- **SEDAR+ (Canada)** — no official free API
- **CNINFO (China)** — no English API
- **MOPS (Taiwan)** — no English API
- **ASIC (Australia)** — commercial agreements required
- **MCA21 (India)** — company filings portal; paid for bulk access
- **CCIL (India)** — bond market data; commercial subscription
- **MCX (India)** — commodity data; exchange members only
- **SIPC** — no public API

### Crypto
- **Glassnode** — $799/mo + API add-on
- **Blockchair** — free tier eliminated July 2025
- **CoinWarz** — paid after free trial
- **LunarCrush** — $72/mo for API
- **Santiment** — severely restricted free tier
- **NFTGo** — compute-unit pricing
- **Token Terminal** — no free API tier
- **Artemis** — $300/mo for API
- **Covalent** — trial only, then paid

### Startups / business
- **Wellfound/AngelList Jobs** — no public API
- **Acquire.com** — email alerts only
- **BizBuySell** — email alerts only
- **PitchBook** — paid platform
- **The Information** — $399-999/yr
- **Stratechery** — $15/mo
- **CB Insights API** — paid (newsletter is free, RSS above)
- **Dealroom** — €12,600+/yr
- **Tracxn** — ~$550+/mo
- **YipitData** — $8K-$100K/mo
- **AlphaSense** — $10K-$100K/user/yr
- **Tegus** — $25K-$150K/yr
- **The Ken (India)** — paid subscription
- **The Morning Context (India)** — paid subscription

### News / media
- **Bloomberg** — enterprise pricing only
- **Financial Times** — $45-75/mo
- **Wall Street Journal** — $4-13.75/wk
- **The Economist** — $3.88-7.25/wk
- **The Atlantic** — subscription required
- **AP News** — direct RSS deprecated
- **Reuters** — direct RSS largely deprecated
- **Matt Levine Money Stuff** — free via email but no confirmed dedicated RSS
- **BQ Prime (India)** — paywalled

### Discontinued APIs (do not re-research)
- **GovTrack.us API** — terminated summer 2025; use Congress.gov
- **ProPublica Congress API** — no new keys; archived
- **OpenSecrets API** — discontinued April 2025; moved to paid OS Pro
- **White House Petitions (We the People)** — archived
- **NYSE TAQ Alerts** — decommissioned 2019; use Nasdaq halts RSS

---

## Top recommendations — ranked by marginal value to the India+US brief

### Tier 1A: India official sources (ship first — biggest gap)

These fill the largest gap in the current stack: **zero India-specific official sources**. India is a target region but today only yfinance prices + generic GDELT/Reddit cover it.

1. **`sebi`** — India's SEC; keyless RSS; regulatory announcements
2. **`rbi`** — India's central bank; keyless RSS; monetary policy, rates
3. **`mospi`** — India's official statistics office; keyless REST + MCP; CPI/IIP/GDP — India's BLS+BEA equivalent
4. **`bse-announcements`** — BSE corporate filings; keyless RSS; India exchange data
5. **`nse-announcements`** — NSE corporate filings; keyless JSON; India exchange data
6. **`amfi`** — Indian mutual fund data; keyless; 14K+ schemes, 18 yrs history
7. **`upi-npci`** — UPI digital payments volume; keyless web tables; India fintech adoption signal
8. **`rbi-payments`** — Official payment systems stats; keyless web tables
9. **`data-gov-in`** — India's open data portal; free-key; broad government datasets

### Tier 1B: US official sources (strengthen the cite-or-kill moat)

10. **`cftc-cot`** — unique futures positioning; keyless; weekly
11. **`treasury-yields`** — canonical US yield curve; keyless; daily
12. **`bea`** — official US GDP/accounts; free-key
13. **`census`** — business formations + retail sales; free-key
14. **`sec-litigation`** + **`ftc`** + **`doj-antitrust`** — enforcement RSS; keyless
15. **`cfpb-complaints`** — consumer financial harm; keyless; daily
16. **`nasdaq-halts`** — market-disruption signal; keyless RSS
17. **`congress`** + **`senate-votes`** — federal legislative data; free-key + keyless
18. **`fec`** + **`lda`** — campaign finance + lobbying; free-key
19. **`gao`** — government accountability audits; keyless RSS
20. **`fda`** — drug approvals/recalls; free-key; new healthcare domain
21. **`nih-reporter`** + **`nsf-awards`** — federal research funding; keyless
22. **`usgs-earthquakes`** + **`noaa-weather`** + **`usda-nass`** — new domains

### Tier 1C: Global macro (covers India + US)

23. **`imf`** + **`worldbank`** + **`bis`** + **`un-comtrade`** — international macro/trade; all keyless or free-tier

### Tier 1D: Crypto on-chain (fills the on-chain gap)

24. **`etherscan`** — on-chain transaction data
25. **`mempool-space`** — Bitcoin network health; keyless
26. **`token-unlocks`** — predictive vesting calendar
27. **`l2beat`** — L2 risk assessments
28. **`coinmetrics`** — on-chain metrics

### Tier 1E: AI benchmarks (new category)

29. **`artificial-analysis`** + **`openrouter-data`** + **`lmsys`** — AI model benchmarks

### Tier 1F: India news + startups (RSS — cheap, high value for India coverage)

30. **`india-moneycontrol`** + **`india-business-standard`** + **`india-cnbc-tv18`** + **`india-hindu`** — Indian markets/business news
31. **`india-yourstory`** + **`india-inc42`** + **`india-entrackr`** — Indian startup ecosystem
32. **`india-analytics-mag`** — Indian AI/tech
33. **`india-screener`** — Indian stock fundamentals (scraping)
34. **`india-naukri`** — Indian job market (unofficial API)

### Tier 1G: US news + startups (RSS — cheap corroboration)

35. **`cnbc`** + **`marketwatch`** + **`seeking-alpha`** — US markets
36. **`politico`** + **`the-hill`** + **`semafor`** + **`axios`** — US policy/business
37. **`washington-post`** + **`nyt`** — US broadsheet
38. **`the-verge`** + **`ars-technica`** + **`bbc`** + **`rest-of-world`** — tech + global
39. **`crunchbase-news`** + **`strictlyvc`** + **`fortune-termsheet`** — funding/M&A
40. **`benedict-evans`** + **`not-boring`** + **`the-generalist`** + **`net-interest`** + **`margins`** — analyst newsletters
41. **`lennys`** + **`a16z`** + **`indiehackers`** + **`saastr`** + **`firstround`** — startup/VC

### Tier 1H: Tech / dev (language ecosystems + dev communities)

42. **`papers-with-code`** + **`replicate`** — AI research + models
43. **`libraries-io`** + **`crates-io`** + **`maven-central`** + **`rubygems`** + **`packagist`** — package ecosystems
44. **`gitlab`** + **`docker-hub`** + **`devto`** — dev infrastructure + community

---

## Implementation notes

- **India official sources** (`sebi`, `rbi`, `mospi`, `bse-announcements`, `nse-announcements`, `amfi`, `upi-npci`, `rbi-payments`, `data-gov-in`) are the **highest-priority gap fill** — the stack currently has zero India-specific official sources despite India being a target region.
- **`mospi`** is especially notable: official MCP server at `https://mcp.mospi.gov.in/` with no auth required — India's BLS+BEA equivalent.
- **`nse-announcements`** uses unofficial JSON endpoints with anti-bot headers — needs careful implementation (browser-like headers, rate limiting).
- **`upi-npci`** and **`rbi-payments`** are web tables, not APIs — need scraping with maintenance.
- **`india-screener`** (Screener.in) has no official API but is the most comprehensive free source for Indian stock fundamentals. Multiple MCP servers and Python scrapers exist. Use with rate limiting + robots.txt respect.
- **SDMX sources** (IMF, BIS, UN Comtrade) share a common format — consider a single SDMX adapter.
- **RSS feeds** (news, newsletters, gov press releases, SEBI, RBI, BSE) can be added to the existing `news.py` RSS bundle — no per-feed adapter needed.
- **`l2beat`** and **`lmsys`** use undocumented APIs — wrap defensively.
- **`opensea`** keys expire after 30 days — needs refresh mechanism (Tier 2).
- **FINRA short interest** (deferred in PROJECT_STATUS.md #13) is confirmed feasible with public credential (10 GB/month) — worth re-attempting with proper pagination + backoff.

## Suggested next steps

1. **Ship India official sources first** (`sebi`, `rbi`, `mospi`, `bse-announcements`, `nse-announcements`, `amfi`) — biggest gap, all keyless, immediate value for India target region.
2. **Ship India news + startup RSS** (`india-moneycontrol`, `india-business-standard`, `india-cnbc-tv18`, `india-hindu`, `india-yourstory`, `india-inc42`, `india-entrackr`, `india-analytics-mag`) — cheap RSS, fills India discourse gap.
3. **Ship US official keyless sources** (`cftc-cot`, `treasury-yields`, `sec-litigation`, `ftc`, `doj-antitrust`, `cfpb-complaints`, `nasdaq-halts`, `gao`, `nih-reporter`, `nsf-awards`, `usgs-earthquakes`, `noaa-weather`).
4. **Ship global macro** (`imf`, `worldbank`, `bis`, `un-comtrade`).
5. **Obtain free keys** for `bea`, `census`, `congress`, `fec`, `lda`, `fda`, `usda-nass`, `data-gov-in` — store in Infisical + GitHub repo secret (same pattern as `EIA_API_KEY`).
6. **Ship crypto on-chain** (`etherscan`, `mempool-space`, `token-unlocks`, `l2beat`, `coinmetrics`).
7. **Ship AI benchmarks** (`artificial-analysis`, `openrouter-data`, `lmsys`).
8. **Bulk-add US + India RSS feeds** to the news bundle.
9. **Ship tech/dev sources** (`papers-with-code`, `libraries.io`, language package registries, `gitlab`, `docker-hub`).
10. **Update `source_catalog.py`** as each source ships; regenerate `docs/operations/source-catalog.md`.
11. **Re-attempt FINRA short interest** (PROJECT_STATUS.md #13).
