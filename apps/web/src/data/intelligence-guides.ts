export type IntelligenceGuideKey =
  | 'daily-intelligence-brief'
  | 'startup-intelligence-platform'
  | 'market-intelligence-for-founders'
  | 'technology-trend-intelligence';

export interface GuideSection {
  title: string;
  paragraphs: string[];
}

export interface GuideLink {
  href: string;
  title: string;
  description: string;
}

export interface GuideEvidence {
  href: string;
  label: string;
  detail: string;
  verifiedAt: string;
}

export interface IntelligenceGuide {
  key: IntelligenceGuideKey;
  slug: `/${string}`;
  eyebrow: string;
  title: string;
  metaDescription: string;
  summary: string;
  schemaKind: 'article' | 'dataset' | 'howto';
  sections: GuideSection[];
  evidence: GuideEvidence[];
  related: GuideLink[];
  cta: GuideLink;
}

export const INTELLIGENCE_GUIDES: Record<IntelligenceGuideKey, IntelligenceGuide> = {
  'daily-intelligence-brief': {
    key: 'daily-intelligence-brief',
    slug: '/daily-intelligence-brief',
    eyebrow: 'daily intelligence',
    title: 'Daily intelligence brief for technology, startups, and finance',
    metaDescription:
      'See how High Signal builds one evidence-first daily intelligence brief across technology, startups, and finance, with sources and a public track record.',
    summary:
      'A daily intelligence brief should reduce the number of things an operator must inspect, not create another feed to clear. High Signal turns public evidence from technology, startup, and finance sources into one end-of-day brief. It keeps the source links, publishes the method, and records whether directional calls were right after their measurement window closes.',
    schemaKind: 'article',
    sections: [
      {
        title: 'What the brief answers',
        paragraphs: [
          'The public brief is organized around three operator questions: which stocks are worth watching for a boom, which business ideas are emerging from real demand, and which lifestyle or behavior shifts are becoming visible. When a user connects a brand, two additional sections focus on how the market perceives that product and which agent-readiness gaps could become product improvements. Region is a filter, not a paid gate.',
        ],
      },
      {
        title: 'From evidence to a published signal',
        paragraphs: [
          'High Signal ingests a documented catalog of public sources across technology, startups, and finance. A candidate must survive curation, cleaning, de-duplication, and a cite-or-kill gate. A published claim needs at least two independent sources; a prediction-market quote cannot stand alone as evidence. Published signals carry confidence and a maturity window. When the window closes, the outcome is recorded as hit, miss, or push in the public track-record ledger.',
        ],
      },
      {
        title: 'Why the ledger matters',
        paragraphs: [
          "Most brief products make today's summary easy to read and yesterday's judgment hard to inspect. High Signal preserves dated briefs, signal pages, evidence links, methodology, and the public hit-rate ledger. A reader can move from a claim to its sources, inspect earlier calls, and see where the available sample is still early. Missing evidence is not converted into confidence.",
        ],
      },
      {
        title: 'How to use High Signal',
        paragraphs: [
          "Start with today's brief for the compressed view. Open a signal when you need the evidence and confidence behind a claim. Use the company universe to investigate a startup or product, the signal taxonomies to follow a recurring pattern, and the track record to inspect matured outcomes. The methodology page documents the rules used across these surfaces.",
          'High Signal is free for now and the public brief does not require a signup. The product is an intelligence layer for deciding what deserves attention; it is not investment advice and does not replace primary research.',
        ],
      },
    ],
    evidence: [
      {
        href: '/methodology',
        label: 'Publication contract',
        detail: 'Published claims require at least two independent sources and matured calls enter the public ledger.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/brief/archive',
        label: 'Dated brief archive',
        detail: 'Permanent daily snapshots preserve what readers could see at the time.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/track-record',
        label: 'Outcome record',
        detail: 'Hits, misses, pushes, sample sizes, and attributed fallback rates remain inspectable.',
        verifiedAt: '2026-08-05',
      },
    ],
    related: [
      { href: '/brief', title: "Today's Daily Brief", description: 'Read the current compressed view.' },
      { href: '/methodology', title: 'Methodology', description: 'Inspect the cite-or-kill rules.' },
      { href: '/track-record', title: 'Public track record', description: 'Check matured calls and sample size.' },
      { href: '/brief/archive', title: 'Brief archive', description: 'Return to a permanent dated brief.' },
    ],
    cta: {
      href: '/brief',
      title: "Read today's Daily Brief",
      description: 'Then inspect the methodology and public track record behind it.',
    },
  },
  'startup-intelligence-platform': {
    key: 'startup-intelligence-platform',
    slug: '/startup-intelligence-platform',
    eyebrow: 'startup intelligence',
    title: 'Startup intelligence platform built on public evidence',
    metaDescription:
      "Explore High Signal's evidence-backed startup intelligence platform: 12,964 companies, qualified profiles, product facets, and links to current signals.",
    summary:
      'A startup intelligence platform should help an operator move from a broad market question to inspectable companies, products, demand signals, and evidence. High Signal combines a daily brief with a public company universe and evidence-backed signal archive. It is designed for discovery and follow-up research, not as a private-company database with unverifiable completeness claims.',
    schemaKind: 'dataset',
    sections: [
      {
        title: 'What High Signal covers',
        paragraphs: [
          "High Signal's company universe is built from official YC, Antler, a16z, and Techstars directories. The underlying corpus contains 12,964 unique companies. The public discovery policy does not index every generated profile: it currently marks 5,178 company pages eligible only when the description, product facets, and similarity evidence clear the published threshold. Pages below that threshold remain available where appropriate but are withheld from search discovery until their evidence improves.",
        ],
      },
      {
        title: 'Find companies by what they do',
        paragraphs: [
          'Company profiles retain source affiliation, description, cohort or program evidence when available, and extracted product, use-case, customer, industry, and technology facets. Search uses those fields instead of relying only on a company name. Similar-company links are deterministic and reciprocal, with match reasons exposed so the connection can be inspected rather than accepted as a black-box recommendation.',
        ],
      },
      {
        title: 'Connect the directory to live signals',
        paragraphs: [
          'A directory is most useful when it connects static company context to changing evidence. High Signal links its company universe to published signals, entities, sectors, opportunities, and recurring signal types. The Daily Brief compresses the strongest current observations; the deeper pages let a reader inspect the companies and evidence behind them.',
        ],
      },
      {
        title: 'What the platform does not claim',
        paragraphs: [
          'High Signal does not claim that every startup has complete funding, revenue, employee, or customer data. It does not turn a short accelerator description into an authoritative company profile. The corpus policy deliberately withholds thin pages from indexing. Source links and update timestamps remain visible so a reader can verify freshness and scope.',
        ],
      },
      {
        title: 'A practical research path',
        paragraphs: [
          'Begin with the company universe when you know a company, category, accelerator, location, or product facet. Move to similar companies to map a local competitive set. Then inspect signals and the Daily Brief to see whether current evidence changes the picture. Use the methodology and data pages to understand what High Signal ingests and what qualifies for public discovery.',
        ],
      },
    ],
    evidence: [
      {
        href: '/case-studies',
        label: '12,964 source-backed companies',
        detail: 'Built from official YC, Antler, a16z, and Techstars directory evidence.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/case-studies',
        label: '5,178 discovery-eligible profiles',
        detail: 'Profiles clear description, product-facet, provenance, and similarity thresholds.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/data',
        label: 'Public source catalog',
        detail: 'Source roles, access, freshness windows, and retained fields are documented.',
        verifiedAt: '2026-08-05',
      },
    ],
    related: [
      { href: '/case-studies', title: 'Company universe', description: 'Search the qualified company graph.' },
      { href: '/signals', title: 'Current signals', description: 'Connect company context to changing evidence.' },
      { href: '/opportunities', title: 'Opportunities', description: 'Inspect source-backed product hypotheses.' },
      { href: '/data', title: 'Data sources', description: 'Review source coverage and freshness.' },
    ],
    cta: {
      href: '/case-studies',
      title: 'Explore the qualified company universe',
      description: 'Then follow its evidence into current signals and opportunities.',
    },
  },
  'market-intelligence-for-founders': {
    key: 'market-intelligence-for-founders',
    slug: '/market-intelligence-for-founders',
    eyebrow: 'founder workflow',
    title: 'Market intelligence for founders',
    metaDescription:
      "A practical founder workflow for turning High Signal's daily brief, converging evidence, company universe, and track record into focused research.",
    summary:
      'Founders rarely need more undifferentiated news. They need a repeatable way to notice changing demand, map the companies involved, test whether several source classes agree, and decide what deserves direct research. High Signal organizes that workflow around one Daily Brief and a set of public evidence surfaces.',
    schemaKind: 'howto',
    sections: [
      {
        title: '1. Scan for change, not volume',
        paragraphs: [
          'Start with the Daily Brief. Its public sections compress market, business-idea, and behavior signals across technology, startups, and finance. Each published claim retains evidence links and a confidence band. The brief is a triage surface: it should identify what deserves attention, not replace the source material.',
        ],
      },
      {
        title: '2. Check whether the signal converges',
        paragraphs: [
          "A single headline, forum post, or prediction-market price is weak evidence. High Signal's cite-or-kill rule requires at least two independent sources for a published claim. The convergence view and signal-type pages help a founder see whether a pattern appears across distinct source classes and whether similar calls have accumulated enough history for a meaningful hit rate.",
        ],
      },
      {
        title: '3. Map the companies and alternatives',
        paragraphs: [
          'Use the company universe to find products by name, accelerator, category, location, or extracted product facet. Profiles expose their source context and similar-company reasons. This can turn a vague market observation into a research list without pretending that the directory contains private revenue or customer truth.',
        ],
      },
      {
        title: '4. Translate evidence into an opportunity',
        paragraphs: [
          'The opportunities and ideas surfaces connect public changes, complaints, and demand evidence to possible products. Treat these as hypotheses. Inspect the target user, problem, evidence mix, why-now argument, risk, and next validation step before acting. A strong opportunity still needs customer conversations and primary research.',
        ],
      },
      {
        title: '5. Connect your own product when useful',
        paragraphs: [
          'The public brief works without signup. Connecting a brand adds two product-specific sections: market perception of that product and agent-readiness gaps that may suggest improvements. These sections depend on connected-brand evidence; they should not be confused with the public market feed.',
        ],
      },
      {
        title: '6. Return to the record',
        paragraphs: [
          "Use dated brief archives and the public track record to check what changed and whether earlier directional calls matured into hits, misses, or pushes. When the sample is small, High Signal says so. This makes the workflow measurable over time instead of allowing today's narrative to overwrite yesterday's prediction.",
        ],
      },
    ],
    evidence: [
      {
        href: '/brief',
        label: 'Current brief',
        detail: 'The public market, business-idea, and behavior sections work without signup.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/convergence',
        label: 'Independent-source convergence',
        detail: 'Fresh evidence is grouped across distinct source classes instead of headline count alone.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/opportunities',
        label: 'Opportunity briefs',
        detail: 'Hypotheses expose target user, problem, evidence mix, why now, risk, and next validation step.',
        verifiedAt: '2026-08-05',
      },
    ],
    related: [
      { href: '/brief', title: 'Daily Brief', description: 'Scan the current evidence-backed changes.' },
      { href: '/convergence', title: 'Convergence', description: 'Check independent source classes together.' },
      { href: '/case-studies', title: 'Company universe', description: 'Map companies and local alternatives.' },
      { href: '/track-record', title: 'Track record', description: 'Return to matured outcomes.' },
    ],
    cta: {
      href: '/brief',
      title: "Read today's brief",
      description: 'Investigate one converging signal and turn it into a source-backed research list.',
    },
  },
  'technology-trend-intelligence': {
    key: 'technology-trend-intelligence',
    slug: '/technology-trend-intelligence',
    eyebrow: 'technology trends',
    title: 'Technology trend intelligence from converging evidence',
    metaDescription:
      "Track technology trends through High Signal's cited signals, source convergence, entities, sectors, taxonomies, and public outcome history.",
    summary:
      'Technology trend intelligence is the practice of finding changes that repeat across products, companies, technical ecosystems, capital allocation, regulation, and user behavior. High Signal tracks those changes through public sources, publishes evidence-backed signals, and groups them into entities, sectors, and recurring signal types.',
    schemaKind: 'article',
    sections: [
      {
        title: 'Separate a trend from an isolated event',
        paragraphs: [
          'One product launch or one popular post can matter, but it does not establish a durable trend. High Signal looks for corroboration across independent source classes. Its technology catalog includes sources such as GitHub, Hugging Face, package registries, developer ecosystems, security advisories, papers, Hacker News, and public company or government evidence where relevant. A published signal still has to clear the same cite-or-kill rule.',
        ],
      },
      {
        title: 'Follow the layers of evidence',
        paragraphs: [
          'Use the Daily Brief for the compressed view. Open the signals feed to inspect recent claims and their evidence. Signal-type pages collect recurring patterns such as adoption, infrastructure buildout, design wins, platform momentum, and regulatory shifts. Entity and sector pages show where those patterns concentrate. The convergence view is the place to inspect independent source classes appearing together.',
        ],
      },
      {
        title: 'Read confidence and history carefully',
        paragraphs: [
          'High Signal records confidence as a band rather than false precision. A directional market signal also carries a measurement window. When the window closes, the scorer records hit, miss, or push. A signal type needs enough matured samples before its direct hit rate is displayed; otherwise the interface falls back to a clearly attributed family rate or labels the evidence as early.',
        ],
      },
      {
        title: 'Use trends as research prompts',
        paragraphs: [
          'A trend page should help answer four questions: what changed, which companies or sectors are involved, which independent sources support it, and what would disconfirm it? High Signal provides the first three through its public graph and evidence surfaces. The fourth remains a research responsibility: open the primary sources, check timestamps and scope, and decide whether the evidence applies to your product or market.',
        ],
      },
      {
        title: 'Explore without losing provenance',
        paragraphs: [
          'The qualified public corpus currently includes 199 cited signal pages, 34 evidence-qualified entity pages, 26 entity-month archives, 14 populated signal taxonomies, and 38 dated briefs. Thin or under-supported candidates are withheld from discovery. The goal is not the largest index; it is a connected, inspectable record of meaningful change.',
        ],
      },
    ],
    evidence: [
      {
        href: '/signals',
        label: '199 qualified signal pages',
        detail: 'Published signal pages retain cited evidence and substantive signal content.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/entities',
        label: '34 qualified entities and 26 monthly archives',
        detail: 'Entity surfaces qualify from eligible signals or substantive relationship evidence.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/signals/types',
        label: '14 populated signal taxonomies',
        detail: 'A taxonomy enters discovery only after enough eligible child signals exist.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/brief/archive',
        label: '38 dated briefs',
        detail: 'Retained snapshots preserve required sections and citations.',
        verifiedAt: '2026-08-05',
      },
    ],
    related: [
      { href: '/signals', title: 'Signals', description: 'Inspect current claims and evidence.' },
      { href: '/signals/types', title: 'Signal types', description: 'Follow recurring patterns over time.' },
      { href: '/convergence', title: 'Convergence', description: 'See independent source classes together.' },
      { href: '/sectors', title: 'Sectors', description: 'Find where patterns concentrate.' },
    ],
    cta: {
      href: '/signals',
      title: 'Explore current signals',
      description: 'Follow one pattern through its type, entities, sectors, evidence, and track record.',
    },
  },
};

export const INTELLIGENCE_GUIDE_LINKS: GuideLink[] = Object.values(INTELLIGENCE_GUIDES).map(
  (guide) => ({
    href: guide.slug,
    title: guide.title,
    description: guide.summary,
  }),
);

export function intelligenceGuide(key: IntelligenceGuideKey): IntelligenceGuide {
  return INTELLIGENCE_GUIDES[key];
}
