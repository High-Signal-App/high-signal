# High Signal

Research brief updated: 2026-05-25

**Current product direction (canonical, supersedes earlier framing):** High Signal is **one** product — a Daily Brief synthesized from many noisy sources, covering three domains (technology, startups, finance). The brief has five sections (three public, two brand-aware sections that require a connected brand). Region is a free filter. The earlier "umbrella + 5 sub-products" framing in `plans/0004-platform-consolidation.md` is superseded.

**Scope reset, 2026-06-03:** keep Daily Brief, Signals, Evidence, Track Record, a small source pipeline, Mentions, Agent Eval, and a narrow Markets lens active. Park Lab, personal/operator cockpit, standalone equities UI, standalone communities product, and broad source expansion. Parked means kept in code, not deleted, but not expanded or presented as a primary product path. See `docs/scope-reset-2026-06-03.md`.

See `agents.md` "Locked decisions" for the authoritative product-direction snapshot. The thesis below is unchanged.

Signal intelligence for companies and sectors, driven by news, filings, docs, related-entity shifts, AI-assistant answers, and public evidence surfaces.

## Working Thesis

High Signal should sit in the middle between:
- a narrow stock up/down predictor
- a vague "predict all global trends" product

The strongest version is not "AI predicts everything."

It is:
- what changed
- who is affected
- what related entities move with it
- what direction the signal points to
- how confident the system is
- what evidence supports the view

For product builders, the same signal layer should answer:

- I have this idea
- what is the world already pulling toward?
- what products should be built because a world-level change created new constraints, budgets, behavior, or urgency?
- what smaller app requirements and common complaints are repeating before the market names the category?
- where is demand, pain, budget, distribution, or timing improving?
- what evidence supports or weakens the idea?
- should I pursue, test, watch, or avoid it?

This is product intelligence, not random insight generation and not only stock
market prediction.

For operators and brands, the next product layer should answer:

- when a human discovers us through a reel, what should they remember?
- when they ask an agent to evaluate us, what will the agent find?
- are we legible, credible, and recommendable versus alternatives?
- what evidence, pricing, proof, docs, reviews, comparisons, or policies are missing?
- what short-form content should create the first attention slice without making claims the evidence layer cannot support?

This is agent-evaluation intelligence, not generic SEO and not generic content generation.

## Product Shape

Track important changes around companies, communities, and sectors, then surface evidence-backed directional signals.

The system should ingest:
- AI assistant responses
- brand/company mentions
- product pages, pricing pages, docs, policies, FAQs, case studies, comparison pages, reviews, and public complaints
- subreddit and forum discussion
- news
- earnings / filings
- company docs and announcements
- pricing pages and changelogs
- sector and competitor updates
- community discussion where relevant

Then it should build relationships across:
- companies
- suppliers / customers
- peers in the same category
- sectors and sub-sectors
- products, launches, and features

And output:
- proactive product opportunities: what to build, for whom, why now, and what evidence supports it
- company visibility and share-of-voice signals
- agent-readiness audits and recommendation-worthiness scores
- missing-evidence tasks for pricing, proof, docs, comparisons, support, security, integrations, and policies
- reel briefs that turn the strongest proof or point of view into a human attention hook
- community pain, demand, and narrative signals
- directional scenarios
- sector pressure changes
- related-company impact maps
- confidence + supporting evidence
- change logs over time

## What High Signal Is Not

- not a generic chatbot over finance documents
- not a pure stock trading tool
- not a prediction market
- not just "trend discovery"
- not just "news sentiment"

## Core Output Objects

- `Signal card`: what changed, why it matters, affected entities, confidence, sources
- `Product opportunity`: world-level change -> app requirement or complaint cluster -> product to build -> target user -> next validation step
- `Personal command brief`: product opportunity -> actual owned product -> build/change/watch/pause recommendation -> next action
- `Idea flow`: a product idea checked against market, community, mention, news, and resource signals with a decision recommendation
- `Agent evaluation audit`: how assistants and buyer agents are likely to compare, trust, cite, or reject a brand based on public evidence
- `Reel brief`: hook, thesis, proof points, visual beats, CTA, and claim boundaries for short-form content tied back to the evidence bundle
- `Collection`: a tracked company, community set, market wedge, competitor set, or custom watchlist
- `Entity page`: company, peer set, supplier/customer links, recent signals, score history
- `Impact chain`: event -> direct impact -> second-order impact -> watchlist updates
- `Scenario view`: base case, upside case, downside case, evidence for each
- `Evidence bundle`: linked filings, docs, posts, news, and prior internal signal history

## Best First Wedge

The first Market Intelligence wedge starts with one specific domain:
- AI infra / semiconductors

Future collections can include:
- Indian public markets as the first national stock watch
- US/global public markets and international sector watchlists
- enterprise SaaS categories
- a company/brand watchlist
- a subreddit/community watchlist

One collection, one signal contract, one user workflow at a time.

## Best First Buyer

- market researchers
- sector analysts
- operators who track competitive shifts
- serious retail investors who want structured context

The first buyer should care about:
- seeing important changes early
- understanding spillover effects
- having evidence, not just a score

## MVP Direction

- one app shell under the High Signal brand
- four product areas: Mention Intelligence, Community Intelligence, Market Intelligence, Agent Evaluation Intelligence
- one migrated workflow at a time
- one forecast horizon only
- proactive product opportunity radar from world-level changes, app requirements, and complaint clusters
- company + sector watchlists
- high-level national and international stock watch; defer deep single-stock research
- entity graph showing related names
- daily or weekly signal digest
- evidence trail for every signal
- simple backtest / hit-rate view

## Research Snapshot

As of 2026-04-05, this space is real but fragmented.

There is no single clear incumbent for the exact wedge here. Instead, the market is split across:
- finance signal engines
- AI research copilots
- company / market intelligence platforms
- trend detection products
- forecasting and market-based prediction platforms

That matters because the earlier list was intentionally broader than a strict competitor list. It was not random, but it did mix:
- direct competitors
- adjacent products
- tangential products that solve nearby jobs

## Verified Competitor Tiers

### Direct Competitors

These are the closest products to the actual `High Signal` concept.

- [SignalRadar](https://www.signalradar.ai/)
  - Why it belongs: closest live product to "external signal -> forecast adjustment."
  - Verified features: adjusts forecasts using predictive signals from news, models impact on margins / COGS / demand.
  - Why it matters: this is the strongest proof that the wedge is real.

- [RavenPack](https://www.ravenpack.com/products/edge/data/news-analytics)
  - Why it belongs: mature event and signal engine for companies, sectors, and markets.
  - Verified features: sentiment analysis, relevance scoring, novelty tracking, temporal scoring, topic tagging, entity/event detection, research agents.
  - Why it matters: shows what a high-end signal stack looks like once the data layer becomes serious.

- [Accern Rhea](https://www.accern.com/products/rhea)
  - Why it belongs: explicit "research, summarize, alert, and aid in decision-making" platform over public and connected data.
  - Verified features: Q&A, widgets, alerts, reports, file uploads, database connectors, auto-references, industry lenses.
  - Why it matters: close to the "decision layer" version of this idea.

- [Intellizence](https://intellizence.com/platform/)
  - Why it belongs: company and ecosystem signal monitoring with structured trigger events.
  - Verified features: company news signals, industry signals, M&A data, funding, layoffs, business expansion, major hiring, CXO changes, breach data, API.
  - Why it matters: strong example of a company-futures product built from business signals instead of stock charts.

### Adjacent Competitors

These are not exact copies, but they solve major parts of the same workflow.

- [Octolens](https://octolens.com/)
  - Role: AI-filtered social listening for SaaS and developer brands.
  - Verified features: Reddit, X, LinkedIn, GitHub, Hacker News, podcasts/news coverage; Slack/email/webhook/API/MCP delivery; competitor and buying-intent feeds.
  - Why it matters: sets the integration/workflow bar for Mentions. High Signal must beat it on interpretation, evidence linkage, and Daily Brief actions, not raw notification delivery.

- [Peekaboo](https://www.aipeekaboo.com/)
  - Role: AI search visibility and analytics platform for brands/agencies.
  - Verified features: ChatGPT/Gemini/Perplexity/Google AI Mode tracking, AI visibility score, competitor comparison, brand visibility over time, citation/content pickup, GSC/Looker/GA/CMS integrations.
  - Why it matters: validates the AI-visibility category. High Signal should beat it by connecting visibility gaps to cited evidence tasks, community demand, and recommendation-worthiness rather than generic GEO.

- [Subreddit Signals](https://www.subredditsignals.com/)
  - Role: Reddit buyer-intent and lead-generation product.
  - Verified features: buyer-intent classification, subreddit discovery, reply guidance, Reddit/AI traffic attribution, case-study led proof, managed Reddit service.
  - Why it matters: validates Reddit intent as a paid wedge. High Signal should generalize the intent inbox across sources and keep replies operator-reviewed.

- [AlphaSense](https://www.alpha-sense.com/press/alphasense-launches-autonomous-ai-agent-interviewer-debuts-channel-checks-to-deliver-real-time-market-signals-across-all-sectors-of-the-economy/)
  - Role: market intelligence and agentic research platform.
  - Verified features: Generative Search, Deep Research, workflow agents, expert interviews, channel checks, internal content support.
  - Why it matters: owns the "research faster with trusted sources" workflow.

- [Quartr](https://quartr.com/)
  - Role: qualitative public-market research infrastructure.
  - Verified features: live earnings calls, transcripts, filings and reports, slide presentations, AI chat, summaries, API, webhooks, desktop/mobile.
  - Why it matters: very strong source layer for IR-driven company analysis.

- [Brightwave](https://www.brightwave.io/)
  - Role: AI research platform for investment workflows.
  - Verified features: autonomous research agents, reports/charts/tables/grids/slides, data room ingestion, SEC filings, earnings calls, sentence-level citations.
  - Why it matters: shows how far "research copilots" are pushing toward deliverables, not just chat.

- [Rogo](https://rogo.ai/news/scaling-rogo-to-build-the-future-of-investment-banking-our-75m-series-c-and-european-expansion)
  - Role: end-to-end AI platform for finance.
  - Verified features: agentic financial workflows plus growing data partnerships with LSEG, PitchBook, Preqin, Third Bridge, Fitch, S&P Capital IQ and others.
  - Why it matters: shows the enterprise direction if this becomes a full operating system for finance teams.

- [Fira](https://firaresearch.com/)
  - Role: finance AI analyst and research workspace.
  - Verified features: company research, financial calculations, Excel agent, document workflow, public filings, connected cloud storage, exact citations to cells/paragraphs, Excel export.
  - Why it matters: another adjacent example of "trustworthy, cited research over multiple finance documents."

- [AeraVision](https://aeravision.com/competitive-intelligence-platform/)
  - Role: AI-native competitive intelligence platform.
  - Verified features: tracks product launches, pricing changes, ad campaigns, messaging shifts, new hires, reviews, social, market reports; pushes actions into Jira, Slack, CRM.
  - Why it matters: important proof that the same underlying idea can be aimed at product and GTM teams, not just investors.

- [CB Insights](https://www.cbinsights.com/)
  - Role: predictive intelligence on private companies and markets.
  - Verified features: strategy maps, relationship graphs, market maps, AI analysis over private-company activity.
  - Why it matters: relevant if High Signal extends into private-company or market-map intelligence.

- [Similarweb](https://www.similarweb.com/corp/custom-performance-reporting/market-share-dashboard//)
  - Role: digital intelligence on market share and competitor behavior.
  - Verified features: traffic, competitor, keyword, app, audience, and market insights; category dashboards and trend reporting.
  - Why it matters: useful signal layer for company momentum, especially in consumer or SaaS markets.

- [Dataminr](https://www.dataminr.com/press/announcement/dataminr-intel-agents-for-the-physical-world)
  - Role: real-time event, threat, and risk intelligence.
  - Verified features: multimodal event detection, Live Briefs, Intel Agents, predictive intelligence roadmap, 1M+ public data sources.
  - Why it matters: not a company-futures product, but a very strong reference for early-signal detection at scale.

- [Exploding Topics](https://explodingtopics.com/feature/meta-trends)
  - Role: trend detection and market research.
  - Verified features: trend database, meta trends, early-growth tracking, curated macro/micro trend groupings.
  - Why it matters: good reference for trend discovery UX and market categorization.

- [Glimpse](https://meetglimpse.com/google-trends/compare-terms/)
  - Role: search and channel-level trend intelligence.
  - Verified features: search-volume overlays for Google Trends, forecasting, seasonality, channel breakdowns, exports/API positioning.
  - Why it matters: useful reference for "weak-signal" detection in consumer and creator markets.

### Tangent Products

These are worth watching, but they are not true direct competitors.

- [Danelfin](https://danelfin.com/)
  - AI scoring for public equities.

- [TrendSpider](https://trendspider.com/)
  - technical analysis and trader workflow software.

- [Quiver Quant](https://www.quiverquant.com/datasources)
  - alternative datasets and market signals.

- [Stockpulse](https://stockpulse.ai/)
  - social sentiment and market monitoring.

- [Kalshi](https://help.kalshi.com/en/articles/13823766-what-are-prediction-markets), [Polymarket](https://polymarket.com/), [Metaculus](https://www.metaculus.com/)
  - forecasting outputs through markets or crowd forecasts, not the same product shape.

## Why The Earlier List Was Not Random

The products were pulled in for three different reasons:

- direct competitors:
  - they already turn external signals into company or sector intelligence
- adjacent competitors:
  - they own the same research workflow or source layer
- tangent products:
  - they compete for the user's attention when the job is "figure out what happens next"

That means the earlier list was useful for landscape mapping, but only a subset should be treated as true competitors.

## Verified Feature Patterns Across The Market

The serious products in this category usually have some mix of:
- source ingestion from many external channels
- entity extraction and normalization
- watchlists and alerts
- source-linked answers or reports
- workflow integrations
- report or memo generation
- historical monitoring
- some kind of proprietary taxonomy or graph

The most common feature clusters are:

- `ingestion`
  - news, filings, transcripts, websites, jobs, social, internal docs

- `structure`
  - entity/event tagging, taxonomy, relevance, novelty, sentiment, metadata

- `monitoring`
  - watchlists, notifications, scheduled reports, webhooks

- `analysis`
  - summaries, Q&A, comparisons, signal scoring, forecasts, scenario output

- `outputs`
  - reports, memos, tables, graphs, decks, battlecards, APIs

- `trust`
  - citations, source previews, audit trails, first-party or premium content

## What Serious Products Already Have

- evidence-linked outputs
- alerts and monitoring
- entity and event classification
- enterprise connectors and APIs
- domain-specific workflows
- enough source coverage that they are not just "news + Reddit"

## What Still Looks Open

- clean spillover mapping from one event to peers, suppliers, customers, and second-order effects
- a stronger bridge between product signals and market / company signals
- transparent versioned signal history instead of one-off summaries
- signal hit-rate tracking by signal type
- a product that feels like "company futures intelligence" rather than "research assistant" or "trading tool"
- one brand-connected loop that combines AI visibility, cited-source gaps, buyer-intent community posts, proof tasks, and report-ready next actions

## Data Sources Reality

The mature products do not rely only on news and Reddit.

They usually combine:
- public web data
- official company materials
- social / forum / community signals
- jobs and hiring signals
- licensed datasets
- customer-connected internal data

Also, many of them do not rely purely on scraping. They use a mix of:
- scraping
- official feeds
- APIs
- licensed content
- user-connected sources

## Source Coverage By Product

- [RavenPack](https://www.ravenpack.com/products/edge)
  - 40,000+ news and social sources
  - premium sources including Dow Jones, WSJ, Barron's, FactSet, MT Newswires, Benzinga, LinkUp
  - jobs datasets

- [Accern Rhea](https://www.accern.com/products/rhea)
  - 1 billion public news websites and blogs
  - uploaded files and folders
  - connected enterprise databases

- [AlphaSense](https://www.alpha-sense.com/press/alphasense-launches-autonomous-ai-agent-interviewer-debuts-channel-checks-to-deliver-real-time-market-signals-across-all-sectors-of-the-economy/)
  - 500M+ premium business documents
  - equity research
  - earnings calls
  - expert interviews
  - filings
  - news
  - client internal content

- [Quartr](https://quartr.com/newsroom/press-release/quartr-partners-with-tradingview-the-worlds-leading-charting-platform-for-investors)
  - first-party investor relations material
  - earnings calls
  - filings and reports
  - slide presentations
  - transcripts

- [Dataminr](https://www.dataminr.com/press/announcement/dataminr-intel-agents-for-the-physical-world)
  - text in 150 languages
  - image, video, audio, and sensor signals
  - 1M public data sources

- [Exploding Topics](https://explodingtopics.com/blog/find-trending-topics)
  - social
  - search
  - forums
  - news
  - blogs
  - e-commerce
  - podcasts

- [Glimpse](https://meetglimpse.com/google-trends/compare-terms/)
  - Google search trend overlays
  - social/channel breakdowns
  - trend forecasts

- [AeraVision](https://aeravision.com/competitive-intelligence-platform/)
  - websites
  - social media
  - job postings
  - market reports
  - reviews
  - publicly available information only

- [Intellizence](https://intellizence.com/platform/)
  - curated company signals
  - curated industry signals
  - structured event datasets for business activity

## Recommended Source Roadmap For High Signal

### V0: Cheap, Fast, Enough To Prove Value

Use:
- news
- company blogs
- docs and changelogs
- pricing pages
- IR pages
- filings
- Reddit
- X
- niche forums

Goal:
- prove that the product can detect meaningful changes and explain why they matter

### V1: Better Company and Product Coverage

Add:
- job boards and hiring pages
- app store metadata and reviews
- G2 / Capterra / Reddit review-style sources
- YouTube / podcast transcripts where relevant
- GitHub releases and repo activity
- ad libraries and launch directories

Goal:
- make the signal graph richer and more product-aware

### V2: Premium Quality Upgrade

Add:
- licensed earnings transcripts
- reliable market / fundamentals datasets
- traffic and app intelligence
- better document feeds
- expert or channel-check style inputs if commercially justified

Goal:
- move from good prototype to serious research product

### V3: Customer-Specific Operating Layer

Add:
- customer forecast models
- CRM / pipeline data
- internal documents
- watchlists and custom taxonomies

Goal:
- turn the product from a general dashboard into a company-specific decision layer

## Scrape Everything? Not Quite

The right framing is:
- scrape what is public and stable enough to be useful
- use APIs where they exist
- license the expensive or high-value datasets later

The wrong framing is:
- scrape the entire internet first

Why that is a mistake:
- too much engineering before product value is proven
- hard to normalize low-quality sources
- legal and operational risk rises quickly
- most of the useful signal still needs entity resolution and relationship mapping

## What To Copy

- citations and evidence trails
- watchlists and scheduled monitoring
- entity / event normalization
- strong source-linking and source previews
- report-ready outputs
- clear confidence framing instead of fake certainty

## What To Avoid

- a generic finance chatbot
- one-number "AI score" without explanation
- starting with too many sources
- pretending weak evidence is a forecast
- shipping a beautiful dashboard before the signal logic is useful

## Strongest Differentiation

The moat is not "we also read news."

The moat is:
- relationship mapping
- spillover analysis
- cross-source evidence synthesis
- versioned signal memory
- a product that shows what changed and what likely follows

## Best Buildable Direction Right Now

Start with:
- one wedge
- one horizon
- one user
- one evidence-backed output

The strongest first cut is:
- event -> affected company map
- peer / supplier / customer spillover graph
- directional scenario with confidence
- evidence trail
- simple backtest

## Funding / Revenue Status

Public snapshot as of 2026-04-05. Use this as context, not as a complete cap-table database.

- RavenPack: venture-backed private company. Known outside investment includes Molten Ventures, GP Bullhound, and a 2025 strategic investment from FT Ventures. No public revenue number found.
- Stockpulse: private SaaS/API business. No public funding or revenue disclosure found.
- Danelfin: venture-backed. Announced a EUR 2M round led by Nauta Capital in 2024. No public revenue number found.
- TrendSpider: private subscription software. I could not verify a current public funding total or revenue number.
- Quiver Quant: appears venture-backed in third-party databases, but I could not verify a company-announced current funding total or revenue number.
- AlphaSense: heavily venture-backed. Announced that it surpassed $500M ARR on 2025-10-07.
- Quartr: venture-backed. Announced a $10M raise in 2025. The company separately reported 4x ARR growth in May 2025 and later described 3x ARR growth year-over-year in its July 2025 fundraise press release.
- Accern / Rhea: venture-backed. Announced a $20M Series B in 2022 and was acquired by Wand AI in 2025.
- Brightwave: venture-backed. Announced $6M seed plus $15M Series A and said revenue grew 4x since seed.
- Rogo: venture-backed. Announced a $75M Series C in January 2026, bringing total funding to more than $165M.
- Fira: early-stage and backed by Y Combinator. No public funding total or revenue number found.
- CB Insights: historically revenue-funded, then raised a $10M Series A in 2015. No current public revenue number found.
- Similarweb: public company. Revenue is publicly disclosed in filings.
- Dataminr: heavily venture-funded. Announced $250M in financing in 2025. I did not verify a current company-announced revenue number.
- Exploding Topics: acquired by Semrush in 2024.
- Glimpse: no public funding or revenue disclosure found.
- Kalshi: venture-backed. Raised $185M Series C at a $2B valuation in June 2025, $300M Series D at a $5B valuation in October 2025, and a $1B Series E at an $11B valuation in December 2025.
- Polymarket: venture-backed. Had raised $70M by 2024 and then received a major ICE investment in 2025. No public revenue number found.
- Metaculus: benefit corporation / public-good platform primarily backed by grants. Open Philanthropy-backed grants include $5.5M in 2022 and $2.75M in 2024.
- SignalRadar: early private company. No public funding or revenue disclosure found.
- AeraVision: very early startup. No public funding announced.
- High Signal Labs: preview-stage. No public funding or revenue disclosure found.

## Naming Note

The name `High Signal` has nearby usage already, including High Signal Labs and High Signal HQ, so branding should be re-checked before shipping.

## Source Notes

Primary official pages checked for this brief:

- [SignalRadar](https://www.signalradar.ai/)
- [RavenPack News Analytics](https://www.ravenpack.com/products/edge/data/news-analytics)
- [RavenPack Edge](https://www.ravenpack.com/products/edge)
- [Accern Rhea](https://www.accern.com/products/rhea)
- [Intellizence Platform](https://intellizence.com/platform/)
- [Intellizence API](https://intellizence.com/api/)
- [AlphaSense AI Agent Interviewer / Channel Checks](https://www.alpha-sense.com/press/alphasense-launches-autonomous-ai-agent-interviewer-debuts-channel-checks-to-deliver-real-time-market-signals-across-all-sectors-of-the-economy/)
- [AlphaSense AlphaSummit 2025 announcements](https://www.alpha-sense.com/resources/product-articles/alphasummit-2025-product-announcements/)
- [Quartr homepage](https://quartr.com/)
- [Quartr API docs](https://docs.quartr.com/)
- [Quartr AI Chat press release](https://quartr.com/newsroom/press-release/quartr-pro-introduces-its-ai-chat)
- [Quartr funding press release](https://quartr.com/newsroom/press-release/quartr-raises-10m-to-deepen-its-leadership-in-qualitative-public-market-research)
- [Brightwave](https://www.brightwave.io/)
- [Fira](https://firaresearch.com/)
- [Rogo Series C](https://rogo.ai/news/scaling-rogo-to-build-the-future-of-investment-banking-our-75m-series-c-and-european-expansion)
- [AeraVision competitive intelligence platform](https://aeravision.com/competitive-intelligence-platform/)
- [CB Insights](https://www.cbinsights.com/)
- [Similarweb market share dashboards](https://www.similarweb.com/corp/custom-performance-reporting/market-share-dashboard//)
- [Dataminr Intel Agents](https://www.dataminr.com/press/announcement/dataminr-intel-agents-for-the-physical-world)
- [Exploding Topics Meta Trends](https://explodingtopics.com/feature/meta-trends)
- [Exploding Topics data-source note](https://explodingtopics.com/blog/find-trending-topics)
- [Glimpse compare terms](https://meetglimpse.com/google-trends/compare-terms/)
