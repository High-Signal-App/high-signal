export type IntelligenceGuideKey =
  | 'daily-intelligence-brief'
  | 'daily-briefs-compared'
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
      'Read the daily technology, startup and finance brief: distinguish attributed news from verified signals, inspect source records, and check measured outcomes.',
    summary:
      'Use High Signal to catch up on technology, startups, and finance, then choose which developments deserve closer research. The Daily Brief separates attributed news from verified signals. This guide shows what to open, what each layer establishes, and where the evidence stops. No reader account is required.',
    schemaKind: 'article',
    sections: [
      {
        title: '1. Read the news, then open its source',
        paragraphs: [
          'Start with the selected news in the current brief. Related reporting is grouped so you can follow one development without reading every repeated headline. Use the source links to read the original account. A report based on one source remains attributed to that source; its inclusion does not make it an independently verified market call.',
          'Where a retained-record link is available beside a source, open it to inspect the captured material and provenance. A retained excerpt may be incomplete or unavailable. Compare it with the original page and its publication date before relying on a claim. Use “all stories” when you want the full retained collection rather than the short selection.',
        ],
      },
      {
        title: '2. Inspect a verified signal separately',
        paragraphs: [
          'The verified-signals section uses a separate publication gate. A signal needs at least two independent sources; a prediction-market probability cannot stand alone as equity-price evidence. Open the signal title for its full proof, source provenance, confidence and uncertainty. Separate the observed event from the inferred impact and check whether the evidence supports the exact claim.',
          'For example, a company announcing a product establishes what that company said. Several sites repeating the announcement do not independently establish adoption, revenue or customer results. Those claims require their own evidence. When the section says no verified signals, no call cleared the gates for that edition. An unavailable or pending section has a different status; check its message before drawing a conclusion.',
        ],
      },
      {
        title: '3. Read opportunities as research prompts',
        paragraphs: [
          'When business-opportunity or behavior-and-culture reports are present, inspect their supporting passages, citations and stated uncertainty. Community attention can identify a question worth investigating. It does not establish market size, willingness to pay or representative customer demand. Follow the evidence, then test the idea with people and conditions relevant to your decision.',
        ],
      },
      {
        title: '4. Check the outcome record before trusting a pattern',
        paragraphs: [
          'Use Signals to browse today and yesterday’s published calls, then open Track Record for measured directional outcomes. Earlier dated history requires a human check. A market call needs its measurement window to close before its outcome can be assessed. Read the hit, miss or push label together with the sample size and any fallback-rate attribution. News stories and unmeasured opportunity ideas are not successful predictions merely because they appeared in an edition.',
          'Use today and yesterday to change editions, and the region selector to change the view. Check the edition date and publication status before assuming the page is current. Source availability and publication gates can leave sections pending, unavailable or empty. High Signal helps decide what deserves attention; it does not replace primary research or provide investment advice.',
        ],
      },
    ],
    evidence: [
      {
        href: '/methodology',
        label: 'Publication contract',
        detail:
          'Verified signals have a separate publication gate; attributed news is not a verified market call.',
        verifiedAt: '2026-11-15',
      },
      {
        href: '/signals',
        label: 'Published signal history',
        detail: 'Today and yesterday are open; earlier dated history requires a human check.',
        verifiedAt: '2026-11-15',
      },
      {
        href: '/track-record',
        label: 'Outcome record',
        detail:
          'Hits, misses, pushes, sample sizes, and attributed fallback rates remain inspectable.',
        verifiedAt: '2026-11-15',
      },
    ],
    related: [
      {
        href: '/',
        title: "Today's Daily Brief",
        description: 'Read the current compressed view.',
      },
      {
        href: '/data',
        title: 'Source coverage and freshness',
        description: 'Check which sources are available before drawing conclusions from absence.',
      },
      {
        href: '/methodology',
        title: 'Methodology',
        description: 'Inspect the cite-or-kill rules.',
      },
      {
        href: '/track-record',
        title: 'Public track record',
        description: 'Check matured calls and sample size.',
      },
      {
        href: '/signals',
        title: 'Signal history',
        description: 'Inspect published calls and their original proof.',
      },
    ],
    cta: {
      href: '/',
      title: "Read today's Daily Brief",
      description: 'Then inspect the methodology and public track record behind it.',
    },
  },
  'daily-briefs-compared': {
    key: 'daily-briefs-compared',
    slug: '/compared',
    eyebrow: 'comparison',
    title: 'TLDR, Techmeme, or High Signal: choosing a daily tech brief',
    metaDescription:
      'Compare TLDR, Techmeme, and High Signal by reading format, source links, coverage, and evidence checks. Choose a daily tech news routine that fits your work.',
    summary:
      'TLDR delivers a daily tech email. Techmeme groups coverage of developing stories. High Signal offers a public brief across technology, startups, and finance, with a separate verified-signal record. Choose by reading format and the evidence you need. This comparison is written by High Signal.',
    schemaKind: 'article',
    sections: [
      {
        title: 'Start with the job you need done',
        paragraphs: [
          'For a quick catch-up, check whether the current edition covers your field and links to the reporting behind each summary. For an important claim, open those sources and check who originated the information. Several articles repeating one announcement do not amount to independent confirmation.',
          'Email delivery, a live news page, and an evidence ledger are different features. Pick the reading format you will use, then decide which stories deserve a deeper source check. A source link alone does not prove a claim is correct.',
        ],
      },
      {
        title: 'TLDR: a daily email digest',
        paragraphs: [
          'TLDR describes its flagship as a free daily email covering startups, technology, and programming. Its public site shows summaries with links to the source articles, so you can inspect the format before subscribing.',
          'Choose this format when inbox delivery helps you keep a daily reading habit. The public issue and signup pages are the basis for this description; we have not tested its email delivery or audited its editorial verification process.',
        ],
      },
      {
        title: 'Techmeme: follow coverage of a developing story',
        paragraphs: [
          'Techmeme groups a leading technology story with related coverage and discussion. Its public page also offers a time-based archive. That makes it a useful format when you want to see how several outlets are covering the same event.',
          'Choose this format for a developing-story overview rather than a fixed daily stopping point. Related coverage is a navigation aid; inspect the originating sources before treating those reports as independent corroboration.',
        ],
      },
      {
        title: 'High Signal: a daily brief with a separate signal record',
        paragraphs: [
          'The public Daily Brief groups attributed reporting across technology, startups, and finance without requiring a reader account. A news item can carry an attributed single-source report. The stricter publication gate applies to verified signals: a claim needs an aligned primary source and independently originating corroboration. The methodology explains which evidence qualifies.',
          'Choose High Signal when you want to scan one edition, then inspect the evidence behind a signal. Check the edition date and available signal history first: a day can have no newly published verified signals. The public outcome ledger is early and does not establish predictive reliability. High Signal is not a real-time market terminal or investment advice. Its update emails cover product changes; the Daily Brief itself is read on the website.',
        ],
      },
      {
        title: 'Try one story before choosing a routine',
        paragraphs: [
          'Open the current issue or homepage of each service. Find one story relevant to your work, follow its source link, and check the original date, scope, and evidence. Then choose the format that helps you understand that story with the fewest unnecessary steps. You may prefer an email for the daily skim and a grouped news page for follow-up research.',
          'The linked public pages were checked on 31 October 2026. This comparison does not claim that any service is more accurate, faster to read, or more comprehensive than another; those claims would require a matched study.',
        ],
      },
    ],
    evidence: [
      {
        href: 'https://signup.tldr.tech/',
        label: 'TLDR public issue and signup',
        detail: 'Published description, email format, summaries, and source links.',
        verifiedAt: '2026-10-31',
      },
      {
        href: 'https://www.techmeme.com/',
        label: 'Techmeme live news page',
        detail: 'Grouped reporting, discussion links, and time-based archive.',
        verifiedAt: '2026-10-31',
      },
      {
        href: '/methodology',
        label: 'Cite-or-kill rules',
        detail: 'Verified signals require aligned primary evidence and independent corroboration.',
        verifiedAt: '2026-10-31',
      },
    ],
    related: [
      {
        href: '/daily-intelligence-brief',
        title: 'Category guide',
        description: 'What a source-backed daily brief needs.',
      },
      {
        href: '/',
        title: "Today's Daily Brief",
        description: 'Read the current compressed view.',
      },
      {
        href: '/methodology',
        title: 'Methodology',
        description: 'Inspect publication rules.',
      },
      {
        href: '/track-record',
        title: 'Track record',
        description: 'Check matured outcomes.',
      },
    ],
    cta: {
      href: '/',
      title: "Open today's brief",
      description: 'Judge the product from a real sample, then inspect sources on any signal.',
    },
  },
  'startup-intelligence-platform': {
    key: 'startup-intelligence-platform',
    slug: '/startup-intelligence-platform',
    eyebrow: 'startup intelligence',
    title: 'Startup intelligence platform built on public evidence',
    metaDescription:
      "Explore High Signal's evidence-backed startup intelligence platform: source-backed companies, qualified profiles, product facets, and links to current signals.",
    summary:
      'A startup intelligence platform should help an operator move from a broad market question to inspectable companies, products, demand signals, and evidence. High Signal combines a daily brief with a public company universe and evidence-backed signal archive. It is designed for discovery and follow-up research, not as a private-company database with unverifiable completeness claims.',
    schemaKind: 'dataset',
    sections: [
      {
        title: 'What High Signal covers',
        paragraphs: [
          "High Signal's company universe is built from official YC, Antler, a16z, and Techstars directories. The public discovery policy does not index every generated profile: pages qualify only when their official sources, description, product facets, and similarity evidence clear the published threshold. Pages below that threshold remain available where appropriate but are withheld from search discovery until their evidence improves. Browse the live company universe to inspect the available profiles and their provenance.",
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
        label: 'Source-backed company universe',
        detail: 'Built from official YC, Antler, a16z, and Techstars directory evidence.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/case-studies',
        label: 'Evidence-qualified company profiles',
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
      {
        href: '/case-studies',
        title: 'Company universe',
        description: 'Search the qualified company graph.',
      },
      {
        href: '/signals',
        title: 'Current signals',
        description: 'Connect company context to changing evidence.',
      },
      {
        href: '/track-record',
        title: 'Track record',
        description: 'Check how matured signals performed.',
      },
      {
        href: '/data',
        title: 'Data sources',
        description: 'Review source coverage and freshness.',
      },
    ],
    cta: {
      href: '/case-studies',
      title: 'Explore the qualified company universe',
      description: 'Then follow its evidence into current signals and their proofs.',
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
        title: '4. Separate observation from opportunity',
        paragraphs: [
          'Business opportunities appear inside the Daily Brief only when the underlying observation clears the same evidence gates. Treat the suggested product or business implication as an inference: open the signal, inspect its proofs, and do primary customer research before acting.',
        ],
      },
      {
        title: '5. Return to the record',
        paragraphs: [
          "Use the chronological signal record and public track record to check what changed and whether earlier directional calls matured into hits, misses, or pushes. When the sample is small, High Signal says so. This makes the workflow measurable over time instead of allowing today's narrative to overwrite yesterday's prediction.",
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
        detail:
          'Fresh evidence is grouped across distinct source classes instead of headline count alone.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/signals',
        label: 'Proof-bearing signals',
        detail: 'Observed events, impacts, inferences, and supporting evidence stay distinct.',
        verifiedAt: '2026-08-26',
      },
    ],
    related: [
      {
        href: '/brief',
        title: 'Daily Brief',
        description: 'Scan the current evidence-backed changes.',
      },
      {
        href: '/convergence',
        title: 'Convergence',
        description: 'Check independent source classes together.',
      },
      {
        href: '/case-studies',
        title: 'Company universe',
        description: 'Map companies and local alternatives.',
      },
      { href: '/track-record', title: 'Track record', description: 'Return to matured outcomes.' },
    ],
    cta: {
      href: '/brief',
      title: "Read today's brief",
      description:
        'Investigate one converging signal and turn it into a source-backed research list.',
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
          'The public discovery corpus includes only pages that clear the evidence rubric. Signals need substantive cited evidence; entity pages, monthly archives, and signal taxonomies qualify from their underlying public records. Thin or under-supported candidates remain withheld from discovery. Open the live signals, sources, and track record to inspect the available evidence and measured outcomes.',
        ],
      },
    ],
    evidence: [
      {
        href: '/signals',
        label: 'Evidence-qualified signal pages',
        detail: 'Published signal pages retain cited evidence and substantive signal content.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/entities',
        label: 'Qualified entities and monthly archives',
        detail:
          'Entity surfaces qualify from eligible signals or substantive relationship evidence.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/signals/types',
        label: 'Populated signal taxonomies',
        detail: 'A taxonomy enters discovery only after enough eligible child signals exist.',
        verifiedAt: '2026-08-05',
      },
      {
        href: '/signals',
        label: 'Dated briefs',
        detail: 'Retained snapshots preserve required sections and citations.',
        verifiedAt: '2026-08-05',
      },
    ],
    related: [
      { href: '/signals', title: 'Signals', description: 'Inspect current claims and evidence.' },
      {
        href: '/signals/types',
        title: 'Signal types',
        description: 'Follow recurring patterns over time.',
      },
      {
        href: '/convergence',
        title: 'Convergence',
        description: 'See independent source classes together.',
      },
      { href: '/sectors', title: 'Sectors', description: 'Find where patterns concentrate.' },
    ],
    cta: {
      href: '/signals',
      title: 'Explore current signals',
      description:
        'Follow one pattern through its type, entities, sectors, evidence, and track record.',
    },
  },
};

export const INTELLIGENCE_GUIDE_LINKS: GuideLink[] = Object.values(INTELLIGENCE_GUIDES).map(
  (guide) => ({
    href: guide.slug,
    title: guide.title,
    description: guide.summary,
  })
);

export function intelligenceGuide(key: IntelligenceGuideKey): IntelligenceGuide {
  return INTELLIGENCE_GUIDES[key];
}
