# Data Source Audit

Status: working audit
Updated: 2026-06-02

This audit separates four states that were previously easy to mix together:

- **Connected** — scheduled or app-facing today, with local/prod evidence that it runs.
- **Wired** — adapter exists and is reachable from `pipeline --source all`, but live yield still depends on source health, credentials, or review quality.
- **Explicit / manual** — adapter exists but is intentionally not part of the daily `all` run.
- **Planned / external** — source should feed High Signal through another product or future data substrate, not necessarily through a new High Signal adapter.

High Signal should stay the insight product. Source-specific fetching, replay,
dedupe, and rich raw payload storage should move toward the data substrate
boundary in `docs/architecture/data-service-boundary.md`.

## Source-Centric View

These are the data sources that matter for predictions, recommendations, and
daily-brief insights. Pipeline jobs are only the mechanism that runs them.

| Data source | Status | What it is | Prediction / insight use |
| --- | --- | --- | --- |
| Reddit | Connected | Public community discussions and complaints | Demand discovery, pain clusters, lifestyle drift, buyer/workflow friction. Weak signal unless repeated or corroborated. |
| Hacker News | Connected | Startup/developer discussion and launch reaction | Technical narrative shifts, founder/dev objections, early adoption debate, "why now" context. Weak signal unless corroborated. |
| GitHub issues | Connected | Public issue threads from developer/tooling repos | Concrete workflow failures, missing features, setup pain, provenance/citation bugs. Strong input to complaint-to-spec predictions. |
| RSS feeds | Connected | Official blogs, changelogs, developer blogs, selected news/search feeds | Product launches, changelog deltas, official announcements, news corroboration. Often useful as primary or corroborating evidence depending on publisher. |
| Equity / ETF / index / crypto prices | Connected | End-of-day market snapshot through the single yfinance-based snapshot path | Market regime, sector pressure, "watch" context, stock boom candidates. Never duplicate this with another price fetcher. |
| Prediction markets | Connected | Manifold / Polymarket / Kalshi probabilities | Forecast context and calibration. Cannot publish alone because it is crowd opinion, not new information. |
| News/blog sources | Wired | Seeded tech, AI infra, semiconductor, and business publications | Corroboration, broad market context, narrative velocity, independent confirmation. |
| EDGAR filings | Wired | SEC 8-K daily; wider windows include 10-Q, 10-K, Form D | Primary evidence for material company events, capex, deals, financing, private-company funding signals. Large project; keep broad EDGAR work late. |
| SEC XBRL companyfacts | Wired | Structured fundamentals from SEC companyfacts | Revenue/capex/fundamentals context for tracked public entities; joins to price data must use the equities snapshot. |
| Investor relations pages | Wired | Company press releases and IR feeds | Primary evidence for launches, guidance, earnings, capex, partnerships. |
| Government / regulatory feeds | Wired | Federal Register, BIS, CHIPS, FERC, regional policy feeds | Policy shocks, export controls, subsidies, infrastructure constraints, regulatory-risk predictions. |
| Government contracts | Wired | SBIR, USAspending, optional SAM.gov | Federal demand signals, procurement pull, startup/customer opportunity hints. |
| CISA KEV | Wired | Known exploited vulnerability catalog | Security risk signals for mapped products/vendors; needs clear action and ideally vendor/GitHub/news corroboration. |
| NVD | Wired | CVE keyword feed | Security corroboration and weaker early risk context; lower priority than CISA KEV. |
| GitHub releases/activity | Wired | Curated repo releases and public activity | Developer adoption, infra ecosystem shifts, open-source momentum. Broad repo intelligence should move to Lab/external repo product. |
| GitHub Archive | Wired | Public hourly GitHub event archive over tracked repos | Backstop for activity spikes; keep bounded to avoid firehose noise. |
| Package registries | Wired | npm/PyPI releases and advisories for curated packages | Developer ecosystem drift, supply-chain risk, adoption/release cadence signals. |
| Hugging Face | Wired | Public model/dataset activity | Model-distribution drift, AI ecosystem adoption, emerging tooling/model trends. |
| Semantic Scholar | Wired bridge | Recent research-paper search | Research corroboration and early technical trend signal. Should eventually be fed by `researchPapers`. |
| YouTube discovery + transcripts | Wired | Technical/market channel RSS plus transcripts; optional API-key search/view-count ranking for brand-awareness probes | Expert commentary, brand-awareness/perception, and narrative context. Weak alone; useful for corroboration or hypothesis formation. Official API does not provide arbitrary third-party transcripts. |
| Podcasts | Wired, optional-key | Podcast Index episode metadata | Long-form commentary discovery. Transcript/summarization is downstream, not daily source truth yet. |
| GDELT | Wired | Broad news search/replay API | Historical backfill and broad corroboration; noisy if used too broadly. |
| Techmeme | Wired | Tech news meta-curation RSS | Detects when a weak/primary event crosses into broader tech attention. |
| Substack / newsletters | Wired | Curated writer RSS feeds | Narrative and founder/developer weak signals; never publish alone. |
| Lobsters / technical forums | Wired | Developer discussion RSS/forum signals | Small but high-quality technical weak signals. |
| Jobs boards | Wired | Greenhouse, Lever, Ashby targets | Hiring velocity, product-focus, budget and expansion clues. |
| Patents | Wired, low-yield | PatentsView grants | Long-horizon technical/product lookahead; current API health is weak. |
| HKEX filings | Wired | HK-listed company announcements | Asia-listed company primary evidence. |
| Macro rates | Wired | ECB FX and optional FRED rates | Macro context; explicitly not an equity-price source. |
| Wikidata | Manual/enrichment | Entity metadata | Entity mapping and enrichment, not prediction volume. |
| Companies House | Manual/enrichment | UK company search | Company enrichment, not daily prediction source. |

## Planned / External Sources

| Data source / producer | Status | What it should own | Prediction / insight use |
| --- | --- | --- | --- |
| `researchPapers` | External, not connected | Paper ingestion, abstracts/full text, paper tags, topic/reviewer signals | Technical trend corroboration, early research shifts, paper-to-product opportunities. High Signal should consume normalized paper evidence, not recrawl papers. |
| GitHub repository product / 14k repo DB | External / Lab-planned | Repo universe, stars/forks, commits, topics, maintainers, issue clusters | Open-source momentum, developer adoption, maintainer risk, emerging repo/story detection. |
| Mention / Agent Eval | Partially migrated | Brand perception, AI answer checks, proof gaps, competitor visibility | Product-specific perception predictions and improvement ideas, not broad public data aggregation. |
| Dedicated market-data service | Future | Price history, ticker universe, market-derived metrics | Could replace current yfinance snapshot later. Until then, no second stock-price source. |
| EDGAR / filings service | Future | Filing replay, XBRL normalization, Form D/company filing warehouse | Strong primary evidence but large scope; move late after v0 source-quality loop is stable. |
| Wayback/CDX and page diffs | Deferred to Mention / Agent Eval | Competitor/product page changes | Useful only when tied to brand perception or product-improvement outcome metrics. |
| Review sites / app stores / Product Hunt / G2 / Capterra | Planned/deferred | Product reviews, launch reactions, customer complaints | Buyer sentiment and feature-gap signals; add after community/GitHub issue quality proves value. |
| Stack Overflow / support forums | Planned/deferred | Developer support friction | Complaint-to-spec and integration failure signals; add after GitHub issues/HN are stable. |
| Funding/private-company datasets | Planned/deferred | Funding rounds, layoffs, hiring, company events | Startup momentum and opportunity discovery; start with free/public sources before licensed data. |
| Licensed datasets | Deferred | Premium market, company, jobs, funding, and alternative data | Premature until free-source hit-rate and source-quality loop are proven. |

## Current Working Pipelines

| Pipeline | Status | Plain name | What it contains | How we use it |
| --- | --- | --- | --- | --- |
| Python ingest, `cron-ingest` | Connected | Daily source fetcher | `pipeline --source all --days 1` over the wired source families below | Creates raw events, clusters by entity, drafts signal markdown, pushes ingest audit rows |
| Prediction markets, `cron-markets` | Connected | Forecast poller | Manifold / Polymarket / Kalshi probability events and quotes | Context and calibration only; prediction-market-only evidence is killed |
| Equities daily snapshot, `cron-equities` | Connected | Stock/market price snapshot | Equity / ETF / index / crypto end-of-day closes through the yfinance snapshot path | Single stock-price ingress; builds market and price context bundles |
| Operator/product brief, `personal-brief` | Connected | Internal daily recommendation report | Reddit, HN, GitHub issues, RSS source refreshes plus market context | Operator-facing product/build recommendations and source-quality audit |
| Draft publishing judge, `cron-publish` | Connected | Auto-publish | Deterministic and AI judge over drafted signals | Clears draft queue without manual gating while preserving cite-or-kill |
| Lab | Wired, not proven running | Discovery substrate | Local Postgres, HN ingest, one-hop materialization, GitHub trending, clustering, scoring | Discovery substrate candidate; keep cheap path only until useful |

Latest local checks on 2026-06-02:

- Seed preflight passed: 294 entities, 175 relationships, 40 signal types, 168 seeded source definitions.
- Personal source registry: 69 configured app/product sources.
- Product-flow refresh records: 2,254 records, latest 2026-06-01.
- Bundled daily source refreshes: 2,028 records, latest 2026-06-01.
- Equities bundle: 3,228 universe rows, 3,073 rows with data, generated 2026-06-01.
- Recent GitHub Actions runs for `cron-ingest`, `cron-markets`, `cron-equities`, `cron-publish`, `personal-brief`, CI, API deploy, and web deploy were green.

## Operator / Product-Opportunity Sources

These are the currently connected sources behind the internal operator brief and
source-quality audit. Earlier notes called this the "personal flow"; that means
"Sarthak/operator-facing product recommendations," not end-user personalization.

| Source | Count | Status | What it is | How we use it |
| --- | ---: | --- | --- | --- |
| Reddit communities | 37 | Connected | Public subreddit discussions around AI, SaaS, small business, devtools, local AI, productivity, and adjacent themes | Repeated complaints, pain clusters, buyer/workflow friction, lifestyle and product-demand drift |
| Hacker News searches | 8 | Connected | HN search themes for agent evaluation, AI observability, product validation, AI coding agents, MCP, RAG citations | Technical narrative shifts, founder/dev objections, launch or adoption debate |
| GitHub issues | 9 | Connected | Issue searches for LLM observability, RAG provenance, local AI, MCP tools, Copilot review, Next.js deploy, OpenTelemetry AI | Concrete workflow pain from real developers; strong input to complaint-to-spec and source-provenance lanes |
| RSS feeds | 15 | Connected | Official blogs, changelogs, developer blogs, and Google News RSS searches | Product launches, changelog deltas, official updates, mainstream SMB/consumer corroboration |

RSS is a polling format, not a single publisher. In this repo it is used because
it gives clean links and timestamps without broad scraping.

GitHub issues are intentionally included because they are closer to executable
product requirements than social opinions. A single issue is weak; repeated
issues across repos or source families can become a product-change signal.

### GitHub Issue Searches

The operator brief does **not** use a private GitHub token for issue searches.
It calls GitHub's public issue-search API against public issues. This means it
is broad keyword search, not a fixed repository watchlist.

Current issue-search topics:

| Source id | Query target | Use |
| --- | --- | --- |
| `github-llm-observability` | `LLM observability tracing evals agent cost` | LLM reliability, traces, evals, cost, agent workflow pain |
| `github-rag-provenance` | `RAG citations provenance source links hallucination` | Citation/provenance/hallucination complaints |
| `github-local-ai` | `local AI privacy offline model routing cost` | Local/private/offline AI requirements |
| `github-mcp-tools` | `MCP server tool use auth agents integration error` | MCP/tool auth, setup, reliability failures |
| `github-copilot-review` | `Copilot code review bug suggestion workflow` | AI code-review quality and workflow gaps |
| `github-rag-retrieval` | `RAG retrieval citation source hallucination chunking` | Retrieval, chunking, citation failures |
| `github-otel-ai` | `OpenTelemetry LLM tracing metrics agents observability` | LLM instrumentation and observability |
| `github-nextjs-deploy` | `Next.js deployment app router edge runtime error` | Deploy/build/runtime friction |
| `github-cloudflare-workers` | `Cloudflare Workers durable objects deploy bindings error pricing` | Workers, Durable Objects, bindings, deploy, pricing friction |

Separate from that, the Python `github` adapter watches a curated repo-release
list: `NVIDIA/cutlass`, `NVIDIA/TensorRT-LLM`, `NVIDIA/Megatron-LM`,
`vllm-project/vllm`, `ggerganov/llama.cpp`, `pytorch/pytorch`,
`triton-lang/triton`, `ROCm/ROCm`, `intel/intel-extension-for-pytorch`,
`openai/triton`, and `huggingface/transformers`.

### RSS Feed Items

When discussing RSS, always name the actual feed items. Current RSS sources are:

| Source id | Feed | Query / filter intent |
| --- | --- | --- |
| `rss-openai-news` | OpenAI news, `https://openai.com/news/rss.xml` | agents, search, model, API, reasoning, evals, safety, enterprise |
| `rss-anthropic-release-notes` | Anthropic release notes, `https://platform.claude.com/docs/en/release-notes/rss.xml` | agent, tool use, computer use, model, API, evals, citations |
| `rss-cloudflare-blog` | Cloudflare blog, `https://blog.cloudflare.com/rss/` | Workers AI, agents, Vectorize, Durable Objects, security, developer platform |
| `rss-github-changelog` | GitHub changelog, `https://github.blog/changelog/feed/` | Copilot, Actions, code review, issues, security, API, workflow |
| `rss-google-developers` | Google Developers blog, `https://feeds.feedburner.com/GDBcode` | AI, search, Gemini, agent, developer API, model workflow |
| `rss-stripe-blog` | Stripe blog, `https://stripe.com/blog/feed.rss` | checkout, billing, pricing, AI agents, payments, developer platform |
| `rss-shopify-changelog` | Shopify changelog, `https://shopify.dev/changelog/feed.xml` | checkout, apps, APIs, payments, catalog, storefront, AI commerce |
| `rss-google-news-smb` | Google News: small business operations | cashflow, rent, hiring, inventory, customers |
| `rss-google-news-india-startups` | Google News: India startups and SMB | funding, jobs, payments, regulation, regional constraints |
| `rss-google-news-consumer-pressure` | Google News: consumer pressure | spending, rent, jobs, subscriptions, prices, budget |
| `rss-google-news-regional-india` | Google News: India regional issues | city traffic, rent, jobs, pollution, local business |
| `rss-google-news-us-local-business` | Google News: US local business | rent, labor, permits, restaurants, retail |
| `rss-google-news-eu-startups` | Google News: Europe startups and SMB | funding, jobs, regulation, payments |
| `rss-google-news-ai-regulation` | Google News: AI regulation and agents | regulation, agents, search, privacy, copyright, enterprise software |
| `rss-google-news-creator-economy` | Google News: creator and content businesses | subscriptions, ads, platforms, income, monetization |

## Python Ingest Source Families

These are reachable from `python/ingest/src/high_signal_ingest/pipeline.py`.

| Source family | Status | Role | How we use it | Notes / risks |
| --- | --- | --- | --- | --- |
| `news` | Wired | Corroboration / weak primary | Reads RSS from seeded AI-infra and semiconductor sources, extracts article text | Depends on feed health and extraction quality; paywalled feeds may be partial |
| `edgar` | Wired | Primary evidence | SEC 8-K daily; expanded windows add 10-Q, 10-K, and Form D search | High ROI but broad EDGAR remains a large late-stage project |
| `sec-xbrl` | Wired | Structured fundamentals | SEC companyfacts fundamentals for tracked public tickers | Uses raw source document payloads; market-cap joins must use equities snapshot |
| `ir` | Wired | Primary evidence | Company IR and press-release feeds | Strong source for official launches, earnings, capex, guidance |
| `gov` | Wired | Primary / regulatory | Federal Register, BIS, CHIPS, FERC, India, Taiwan, Korea, Japan, EU-style policy feeds | Useful for policy and infrastructure constraints |
| `gov-contracts` | Wired | Demand signal | SBIR, USAspending, optional-key SAM.gov opportunities | Raw payload hooks added; SAM requires key |
| `regulations` | Wired | Regulatory follow-up | Regulations.gov dockets and comment windows | Optional-key; best after a Federal Register trigger |
| `cisa-kev` | Wired | Security primary evidence | CISA Known Exploited Vulnerabilities catalog | Use only when vendor/product maps to tracked entities or devtool/security risk |
| `nvd` | Wired | Security corroboration / weak evidence | NVD CVE keyword queries | Lower priority than CISA KEV unless corroborated |
| `github` | Wired | Developer primary / adoption | Releases and activity for tracked repos | Good for devtool and AI infra adoption; token improves rate limits |
| `github-archive` | Wired | Developer activity backstop | Hourly GitHub Archive over tracked repos | Bounded public reader; avoid broad repo firehose |
| `packages` | Wired | Developer ecosystem / supply-chain | npm/PyPI releases and OSV-style advisory events for curated packages | Raw payload hooks added; strong when tied to tracked packages |
| `huggingface` | Wired | AI ecosystem activity | Public Hub model and dataset activity | Useful for model-distribution drift and adoption candidates |
| `semantic-scholar` | Wired | Research weak signal / corroboration | Curated research-paper search via Semantic Scholar | Should eventually be fed by `researchPapers` as a producer |
| `youtube` | Wired | Weak signal / expert commentary / brand-awareness discovery | Channel RSS plus transcripts from selected technical/market channels; optional YouTube Data API discovery/view-count ranking | Transcript availability varies; official API does not provide arbitrary third-party transcripts; should not publish alone |
| `podcast-index` | Wired, optional-key | Long-form commentary metadata | Podcast episode metadata; transcription is downstream | Requires Podcast Index key/secret; raw payload hooks added |
| `reddit` | Wired | Community weak signal | AI-infra and semiconductor subreddits in ingest pipeline | Separate from personal registry Reddit set |
| `lobsters` | Wired | Developer weak signal | Public Lobsters RSS | Small technical discussion source |
| `substack` | Wired | Narrative weak signal | Curated writer RSS feeds | Never auto-publish alone |
| `techmeme` | Wired | Meta-corroboration | Techmeme RSS | Useful when weak events cross into broader attention |
| `gdelt` | Wired | Broad news backstop / replay | GDELT document API queries | Useful for backfills; noisy if too broad |
| `guardian` | Wired, optional-key | Mainstream corroboration | Guardian content API | Skips without `GUARDIAN_API_KEY` |
| `hkex` | Wired | Primary filings | HK-listed announcements | Useful for Asia-listed AI and semiconductor entities |
| `markets` | Connected | Forecast context | Prediction market events and quotes | Not stock prices; never primary evidence alone |
| `macro-rates` | Wired | Macro context | ECB FX and optional-key FRED rates | Not an equity-price source |
| `patents` | Wired but currently low-yield | Long-horizon primary evidence | PatentsView grants | Current adapter notes USPTO API transition page risk |
| `jobs` | Wired | Hiring / budget / product-focus signal | Greenhouse, Lever, Ashby targets | Good leading indicator; requires careful entity mapping |
| `bluesky` | Wired, optional-auth | Social weak signal | AT Protocol search lane | Weak context only; auth required for best path |
| `metaculus` | Wired, optional-auth | Forecast context | Metaculus forecast search | Terms and auth matter; never primary evidence |
| `wikidata` | Explicit / manual | Entity enrichment | Entity lookup and mapping audit | Not included in daily `all`; use for enrichment and mapping |
| `companies-house` | Explicit / manual | UK entity enrichment | Companies House search | Requires key; not included in daily `all` |

## Seeded Source Definitions

`python/ingest/src/high_signal_ingest/seed/sources.yaml` contains 168 source
definitions. These are planned/seeded market-intelligence sources; not every
entry is a separately proven live source.

Complete row-level inventory: `docs/operations/data-source-inventory.csv`.

Important distinction:

- `sources.yaml` is the curated source plan.
- The `news` adapter directly reads only blog/news RSS rows at tier <= 2.
- Several other adapters use hardcoded curated lists or entity records instead
  of reading `sources.yaml` directly.
- Live reliability should be judged by ingest audit rows, source-health rows,
  and accepted signal contribution.

Current inventory status:

| Status | Count | Meaning |
| --- | ---: | --- |
| Wired | 43 | Directly wired from the seed list today: 42 blog/news RSS rows plus SEC EDGAR |
| Seeded | 109 | Curated source definition exists, but current adapters use another input path or no current fetch path |
| Planned | 9 | X/Twitter handles are listed but not integrated |
| Deferred | 7 | Tier-3 news/blog RSS rows not fetched by the default daily tier filter |

| Seed type | Count | Planned use |
| --- | ---: | --- |
| Blog | 26 | Expert commentary, technical narratives, AI infra deep dives |
| News outlet | 24 | Independent corroboration and broader market context |
| IR page | 43 | Official company primary evidence |
| Government | 7 | Policy, export controls, grants, infrastructure constraints |
| Industry association | 8 | Standards, ecosystem coordination, hardware/interconnect shifts |
| GitHub | 8 | Tracked AI infra and developer ecosystem repo activity |
| Reddit | 8 | AI infra community weak signals |
| X handle | 9 | Planned social weak signals; not a preferred first-class source until value is proven |
| YouTube | 4 | Transcripts from technical/market channels |
| Podcast | 5 | Long-form expert commentary; metadata first, transcript later |
| Conference | 11 | Launch/event calendars and disclosure points |
| Jobs | 6 | Hiring and product-focus indicators |
| Forum | 3 | Technical community weak signals |
| Mailing list | 5 | Curated AI/startup narrative RSS |
| SEC filing | 1 | EDGAR primary evidence |

This file is useful as the curated universe, but live status should be judged by
ingest audit rows, source-health rows, and accepted signal contribution.

## External Producers / Not Yet Connected

| Producer / source | Status | What it should own | How High Signal should use it |
| --- | --- | --- | --- |
| `researchPapers` | External producer built, not connected here | Paper ingestion, source-specific paper metadata, abstract/full-text processing, topic tags, reviewer/rating signals | Export normalized research documents and evidence candidates; High Signal uses them for technical trend corroboration, not broad standalone crawl |
| GitHub repository product / 14k repo DB | External / Lab-planned, not connected | Repo universe, stars/forks, commits, topics, releases, maintainer activity, issue clusters | Feed High Signal repo/activity candidates through normalized documents/events; avoid duplicating broad GitHub crawling |
| Mention / Agent Eval legacy repos | Partially migrated, deeper adapters not fully ported | Brand perception, AI answer checks, competitor visibility, page/proof gaps | Feed personal sections: market perception and product-improvement ideas |
| Market data service | Future extraction candidate | Public equity/ETF/index/crypto closes and derived metrics | Replace current yfinance snapshot only when ready; until then no second price ingress |
| EDGAR / filings service | Future extraction candidate | SEC, XBRL, Form D, filings replay, company-facts normalization | Move late because it is large; current High Signal adapters remain enough for v0 |
| Wayback/CDX and competitor page diffs | Deferred to Mention / Agent Eval | Page-change monitoring and competitor proof-surface deltas | Do not add to public brief until an outcome metric exists |
| Review sites / app stores / Product Hunt / G2 / Capterra | Planned / deferred | Review-style product perception and demand signals | Add only after community and mention outcome metrics prove useful |
| Stack Overflow | Rejected / deprioritized | Developer support friction | Do not add now; it is not a high-ROI modern source for this product compared with GitHub issues, HN, Reddit, and product/review sources |
| Licensed datasets | Deferred | Premium finance, company, jobs, funding, and alternative data | Explicitly premature until free-source hit-rate is proven |

## Duplication Rules

- **Stock prices**: one ingress only, `equities_daily.py` to `data/equities-snapshot.jsonl`, then derived bundles.
- **Prediction markets**: context only; they do not count as stock prices or primary evidence.
- **Research papers**: prefer `researchPapers` as producer; keep `semantic-scholar` as a lightweight bridge until integration exists.
- **GitHub repos**: High Signal can keep curated repo releases/issues, but broad repo intelligence should move to Lab or the external repo product.
- **Mentions and page diffs**: keep in Mention / Agent Eval until they have a public-brief outcome metric.
- **Stack Overflow**: do not add as a priority source; use GitHub issues and curated developer communities instead.
- **Raw payloads**: preserve raw source documents, but do not add source-specific columns to signal tables.

## Borrowed Patterns From `last30days`

The `mvanhorn/last30days-skill` repo is useful as a research workflow, not as a
High Signal dependency. We should steal the operating patterns that improve
signal quality while keeping High Signal's source-of-truth model intact.

Adopted:

- **Availability before yield**: first diagnose whether credentials/tools are
  present, then run source-yield audits. Use `pnpm source:diagnose` before
  `pnpm source:quality` when a source looks empty.
- **Recent-window first**: optimize for the last 28-30 days before building
  bigger archives. Historical backfills should prove they improve hit-rate or
  replay value.
- **People-weighted attention, not SEO**: Reddit, HN, GitHub issues, YouTube,
  and prediction markets are useful because they carry engagement, comments,
  issue velocity, or money-at-risk. Preserve those measures as context when
  adapters expose them.
- **Raw evidence trail first**: keep raw source documents and raw/source URLs
  durable enough for replay. Generated briefs and JSON bundles are derived
  artifacts, not canonical source truth.
- **Cross-source clustering**: merge repeated stories across source families
  before synthesis so one story does not appear as many independent insights.

Rejected for High Signal core:

- Do not import `/last30days` as a production dependency.
- Do not add broad social firehoses just because the skill supports them.
- Do not store its local markdown/SQLite outputs as High Signal source truth.
- Do not let social/community engagement publish alone; it remains weak signal
  unless corroborated by independent evidence or hit-rate history.

## Readiness Calls

Ready for current v0:

- Reddit, Hacker News, GitHub issues, and RSS for the internal operator/product-opportunity brief.
- Equities snapshot as the only market-price source.
- Prediction markets as context.
- Python all-source ingest as a scheduled draft generator.
- Auto-publish rules and quality gates.

Needs proof before being called reliable:

- Source-by-source production yield for all wired Python adapters.
- Rich source-document replay and dedupe using preserved payloads.
- Lab cheap path: HN ingest, materialize, GitHub trending, cluster, score.
- External producer contract for `researchPapers` and GitHub repo data.

Do not expand yet:

- More stock-price providers.
- Broad EDGAR/fundamentals warehouse work.
- Licensed data.
- More social firehoses.
- Review/app-store/Product Hunt feeds before the source-quality loop proves value.

## Next Actions

1. Add a normalized producer contract for external products:
   `sourceId`, `sourceType`, `canonicalUrl`, `publishedAt`, `fetchedAt`,
   `rawPayloadRef`, `entities`, `evidence`, `signals`, and `quality`.
2. Run `pnpm source:diagnose` before source-yield audits so empty results can
   be separated from missing credentials/tools.
3. Build a read-only source-yield dashboard from `ingest_runs`, `events`, and
   daily source-health rows.
4. Connect `researchPapers` as the first external producer, but only for
   normalized research documents and evidence candidates.
5. Connect GitHub repo intelligence through Lab or the repo product; keep
   GitHub issues in the personal-flow lane.
6. Use the preserved raw payloads to validate replay and URL dedupe before
   extracting a separate data service.
