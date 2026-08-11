export type DataParityStatus = 'covered' | 'partial' | 'unavailable';
export type DataParityMappingKind = 'sources' | 'product-capability';

export interface DataParityCapability {
  id: string;
  label: string;
  status: DataParityStatus;
  mappingKind: DataParityMappingKind;
  highSignalSourceIds: string[];
  productCapability?: string;
  limitation: string;
}

export interface DataParityReference {
  id: string;
  name: string;
  officialUrl: string;
  verifiedOn: string;
  capabilities: DataParityCapability[];
}

export const DATA_PARITY_VERIFIED_ON = '2026-08-11';

export const DATA_PARITY_REFERENCES: readonly DataParityReference[] = [
  {
    id: 'the-daily-diff',
    name: 'The Daily Diff',
    officialUrl: 'https://tdd.cat/',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'developer-papers-edition',
        label: 'Hacker News, GitHub, and research-paper discovery',
        status: 'covered',
        mappingKind: 'sources',
        highSignalSourceIds: ['hackernews', 'github', 'semantic-scholar'],
        limitation:
          'High Signal applies its own evidence gate and does not copy story volume or delay rules.',
      },
    ],
  },
  {
    id: 'octolens',
    name: 'Octolens',
    officialUrl: 'https://octolens.com/features',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'developer-community-listening',
        label: 'Developer, community, video, podcast, newsletter, and news monitoring',
        status: 'covered',
        mappingKind: 'sources',
        highSignalSourceIds: [
          'reddit',
          'github',
          'hackernews',
          'youtube',
          'bluesky',
          'stackexchange',
          'dev-ecosystems',
          'podcast-index',
          'substack',
          'producthunt',
          'news',
        ],
        limitation: 'Coverage is batch intelligence, not a real-time mention-delivery SLA.',
      },
      {
        id: 'restricted-social-platforms',
        label: 'X, LinkedIn, TikTok, and Medium monitoring',
        status: 'partial',
        mappingKind: 'sources',
        highSignalSourceIds: ['news', 'bluesky'],
        limitation: 'No dependable first-party X, LinkedIn, TikTok, or Medium firehose is claimed.',
      },
    ],
  },
  {
    id: 'peekaboo',
    name: 'Peekaboo',
    officialUrl: 'https://www.aipeekaboo.com/features/citation-sources',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'ai-answer-citations',
        label: 'Multi-model answer and citation-source tracking',
        status: 'covered',
        mappingKind: 'product-capability',
        highSignalSourceIds: [],
        productCapability:
          'Mentions/OpenLens visibility matrix, cited URL index, and provider fan-out',
        limitation:
          'Provider coverage depends on configured credentials; Google AI Mode remains partial.',
      },
    ],
  },
  {
    id: 'subreddit-signals',
    name: 'Subreddit Signals',
    officialUrl: 'https://www.subredditsignals.com/',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'reddit-intent',
        label:
          'Reddit posts/comments, buyer intent, pain points, competitor context, and reply drafting',
        status: 'covered',
        mappingKind: 'product-capability',
        highSignalSourceIds: ['reddit'],
        productCapability:
          'Community research plus intent-opportunity classification and draft routes',
        limitation:
          'Managed service, conversion attribution, and real-time delivery claims are not compared.',
      },
    ],
  },
  {
    id: 'alphasense',
    name: 'AlphaSense',
    officialUrl: 'https://help.alpha-sense.com/hc/en-us/articles/41921559843475-Content-Overview',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'public-company-and-regulatory',
        label: 'Company filings, press releases, news, regulatory, and macro sources',
        status: 'covered',
        mappingKind: 'sources',
        highSignalSourceIds: ['edgar', 'sec-xbrl', 'ir', 'hkex', 'news', 'gov', 'global-macro'],
        limitation:
          'Coverage is public and curated rather than an enterprise searchable document universe.',
      },
      {
        id: 'premium-research-expert-calls',
        label: 'Broker research, expert calls, and licensed private-company data',
        status: 'unavailable',
        mappingKind: 'sources',
        highSignalSourceIds: [],
        limitation: 'High Signal does not license these premium or proprietary datasets.',
      },
    ],
  },
  {
    id: 'quartr',
    name: 'Quartr',
    officialUrl: 'https://quartr.com/docs/introduction',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'first-party-ir',
        label: 'First-party filings, reports, and investor-relations updates',
        status: 'covered',
        mappingKind: 'sources',
        highSignalSourceIds: ['edgar', 'sec-xbrl', 'ir', 'hkex'],
        limitation:
          'High Signal links public documents and does not claim Quartr-scale global company coverage.',
      },
      {
        id: 'live-earnings-media',
        label: 'Live earnings audio, real-time transcripts, backlog transcripts, and slides',
        status: 'unavailable',
        mappingKind: 'sources',
        highSignalSourceIds: [],
        limitation: 'No equivalent licensed real-time global earnings media dataset is present.',
      },
    ],
  },
  {
    id: 'ravenpack',
    name: 'RavenPack',
    officialUrl: 'https://www.ravenpack.com/solutions/alpha-generation/commodities',
    verifiedOn: DATA_PARITY_VERIFIED_ON,
    capabilities: [
      {
        id: 'news-social-entity-graph',
        label: 'News/social observations, entity mapping, and relationship graphs',
        status: 'covered',
        mappingKind: 'sources',
        highSignalSourceIds: ['news', 'gdelt', 'reddit', 'hackernews', 'github', 'techmeme'],
        limitation:
          'No parity claim is made for proprietary models, source volume, languages, or latency.',
      },
    ],
  },
] as const;

export const MATERIAL_DATA_PARITY_GAPS = [
  'premium broker and analyst research',
  'expert-call libraries',
  'licensed private-company datasets',
  'real-time global earnings audio, transcripts, and slides',
  'dependable X, LinkedIn, and TikTok firehoses',
] as const;
