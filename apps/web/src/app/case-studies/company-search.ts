import type { UniverseCompany } from './data';

const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'companies',
  'company',
  'do',
  'does',
  'doing',
  'for',
  'in',
  'is',
  'of',
  'startup',
  'startups',
  'that',
  'the',
  'this',
  'to',
  'what',
  'which',
  'who',
  'with',
]);

const SIMILARITY_STOP_WORDS = new Set(
  [
    'a',
    'across',
    'allow',
    'all',
    'about',
    'an',
    'agent',
    'ai',
    'also',
    'and',
    'are',
    'as',
    'at',
    'be',
    'been',
    'by',
    'can',
    'change',
    'choose',
    'data',
    'each',
    'based',
    'build',
    'built',
    'business',
    'for',
    'company',
    'every',
    'first',
    'from',
    'get',
    'has',
    'have',
    'help',
    'how',
    'if',
    'in',
    'its',
    'it',
    'is',
    'into',
    'learn',
    'make',
    'new',
    'not',
    'of',
    'open',
    'only',
    'on',
    'one',
    'or',
    'more',
    'our',
    'platform',
    'powered',
    'product',
    'provide',
    'self',
    'service',
    'solution',
    'software',
    'startup',
    'source',
    'team',
    'technology',
    'they',
    'that',
    'than',
    'them',
    'then',
    'the',
    'their',
    'this',
    'through',
    'to',
    'tool',
    'turn',
    'using',
    'use',
    'user',
    'was',
    'way',
    'we',
    'were',
    'where',
    'which',
    'will',
    'without',
    'work',
    'with',
    'world',
    'your',
    'you',
  ].map(stemToken)
);

const GENERIC_ENTITY_CONCEPTS = new Set([
  'ai',
  'ai agents',
  'artificial intelligence',
  'data',
  'platform',
  'software',
  'technology',
]);

const SIMILARITY_THEMES: Array<{ label: string; terms: Set<string> }> = [
  {
    label: 'context and memory',
    terms: new Set([
      'audio',
      'brain',
      'capture',
      'context',
      'history',
      'memory',
      'recall',
      'record',
      'screen',
      'searchable',
      'transcript',
    ]),
  },
  {
    label: 'workflow automation',
    terms: new Set(['automate', 'automation', 'process', 'productivity', 'sop', 'workflow']),
  },
  {
    label: 'developer infrastructure',
    terms: new Set([
      'api',
      'cloud',
      'code',
      'database',
      'deploy',
      'developer',
      'devops',
      'infrastructure',
    ]),
  },
  {
    label: 'finance and payments',
    terms: new Set([
      'accounting',
      'bank',
      'credit',
      'finance',
      'fintech',
      'insurance',
      'payment',
      'wealth',
    ]),
  },
  {
    label: 'health and clinical care',
    terms: new Set([
      'care',
      'clinical',
      'diagnostic',
      'health',
      'medical',
      'patient',
      'therapeutic',
    ]),
  },
  {
    label: 'sales and marketing',
    terms: new Set(['customer', 'gtm', 'marketing', 'revenue', 'sale', 'seller']),
  },
  {
    label: 'security and compliance',
    terms: new Set(['compliance', 'fraud', 'identity', 'privacy', 'risk', 'secure', 'security']),
  },
  {
    label: 'climate and energy',
    terms: new Set([
      'battery',
      'carbon',
      'climate',
      'electric',
      'energy',
      'solar',
      'sustainability',
    ]),
  },
];

interface SimilarityFeatures {
  tokens: Set<string>;
  themes: Set<string>;
  entities: Set<string>;
  entityTokens: Set<string>;
}

interface SimilarityLookup {
  bySlug: Map<string, UniverseCompany>;
  features: Map<string, SimilarityFeatures>;
  inverted: Map<string, Set<string>>;
}

interface CompanySearchDocument {
  company: UniverseCompany;
  name: string;
  description: string;
  category: string;
  affiliations: string;
  evidence: string;
  entities: string;
  searchable: string;
  nameWords: Set<string>;
}

const SIMILARITY_CACHE = new WeakMap<UniverseCompany[], SimilarityLookup>();
const COMPANY_SEARCH_CACHE = new WeakMap<UniverseCompany[], CompanySearchDocument[]>();
export const MATERIALIZED_SIMILARITY_VERSION = 1;
export const COMPANY_SEARCH_PAGE_SIZE = 20;

export interface CompanySearchOptions {
  page?: number;
  pageSize?: number;
}

export interface CompanySearchResult {
  companies: UniverseCompany[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SimilarCompany {
  company: UniverseCompany;
  score: number;
  reason: string;
}

export interface ReciprocalSimilarityGraph {
  edgesBySlug: Map<string, UniverseCompany['competitors']>;
  candidateEdgeCount: number;
  undirectedEdgeCount: number;
  companiesWithPeers: number;
  maxDegree: number;
}

export function searchCompanyUniverse(
  companies: UniverseCompany[],
  input: string,
  options: CompanySearchOptions = {}
): CompanySearchResult {
  const pageSize = positiveInteger(options.pageSize, COMPANY_SEARCH_PAGE_SIZE);
  const query = normalize(input);
  if (!query) return emptyCompanySearchResult(pageSize);

  const rawTokens = tokenize(query);
  const meaningfulTokens = rawTokens.filter((token) => !SEARCH_STOP_WORDS.has(token));
  const tokens = [...new Set(meaningfulTokens.length ? meaningfulTokens : rawTokens)];
  if (!tokens.length) return emptyCompanySearchResult(pageSize);

  const ranked = getCompanySearchDocuments(companies)
    .map((document) => ({ document, score: scoreCompany(document, query, tokens) }))
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.company.name.localeCompare(right.document.company.name)
    );
  const totalPages = Math.ceil(ranked.length / pageSize);
  const requestedPage = positiveInteger(options.page, 1);
  const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
  const offset = (page - 1) * pageSize;

  return {
    companies: ranked.slice(offset, offset + pageSize).map((result) => result.document.company),
    total: ranked.length,
    page,
    pageSize,
    totalPages,
  };
}

function scoreCompany(document: CompanySearchDocument, query: string, tokens: string[]): number {
  const { name, description, category, affiliations, evidence, entities, searchable, nameWords } =
    document;
  if (!tokens.every((token) => searchable.includes(token))) return 0;

  let score = 1;
  if (name === query) score += 10_000;
  else if (name.startsWith(query)) score += 5_000;
  else if (name.includes(query)) score += 2_500;

  if (description.includes(query)) score += 700;
  if (category === query) score += 650;
  else if (category.includes(query)) score += 300;
  if (affiliations.includes(query)) score += 250;
  if (evidence.includes(query)) score += 150;

  for (const token of tokens) {
    if (nameWords.has(token)) score += 400;
    else if (name.includes(token)) score += 180;
    if (description.includes(token)) score += 80;
    if (category.includes(token)) score += 60;
    if (affiliations.includes(token)) score += 50;
    if (evidence.includes(token)) score += 30;
    if (entities.includes(token)) score += 70;
  }
  return score;
}

function getCompanySearchDocuments(companies: UniverseCompany[]): CompanySearchDocument[] {
  const cached = COMPANY_SEARCH_CACHE.get(companies);
  if (cached) return cached;

  const documents = companies.map((company) => buildCompanySearchDocument(company));
  COMPANY_SEARCH_CACHE.set(companies, documents);
  return documents;
}

function buildCompanySearchDocument(company: UniverseCompany): CompanySearchDocument {
  const name = normalize(company.name);
  const description = normalize(company.description);
  const category = normalize(company.category);
  const affiliations = normalize(
    company.investors.flatMap((investor) => [investor, affiliationAlias(investor)]).join(' ')
  );
  const evidence = normalize(
    [
      ...(company.searchMetadata ?? []),
      ...company.sourceEvidence.flatMap((item) => [
        item.cohort,
        item.program,
        item.location,
        item.website,
        item.status,
      ]),
    ]
      .filter(Boolean)
      .join(' ')
  );
  const entities = normalize(
    company.entities?.flatMap((entity) => [entity.text, entity.label]).join(' ') ?? ''
  );
  const searchable = `${name} ${description} ${category} ${affiliations} ${evidence} ${entities}`;
  return {
    company,
    name,
    description,
    category,
    affiliations,
    evidence,
    entities,
    searchable,
    nameWords: new Set(tokenize(name)),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function emptyCompanySearchResult(pageSize: number): CompanySearchResult {
  return { companies: [], total: 0, page: 1, pageSize, totalPages: 0 };
}

export function getSimilarCompanyCluster(
  companies: UniverseCompany[],
  anchor: UniverseCompany,
  limit = 6
): SimilarCompany[] {
  let lookup = SIMILARITY_CACHE.get(companies);
  if (!lookup) {
    lookup = buildSimilarityLookup(companies);
    SIMILARITY_CACHE.set(companies, lookup);
  }

  if (anchor.similarityVersion === MATERIALIZED_SIMILARITY_VERSION) {
    return resolveExistingEdges(anchor, lookup.bySlug).slice(0, Math.max(1, limit));
  }

  const lexicalCluster = rankSimilarityCandidates(anchor, lookup);
  if (lexicalCluster.length) return lexicalCluster.slice(0, Math.max(1, limit));

  return resolveExistingEdges(anchor, lookup.bySlug).slice(0, Math.max(1, limit));
}

export function buildReciprocalSimilarityGraph(
  companies: UniverseCompany[],
  options: { candidateLimit?: number; maxPeersPerCompany?: number } = {}
): ReciprocalSimilarityGraph {
  const candidateLimit = Math.max(1, options.candidateLimit ?? 24);
  const maxPeersPerCompany = Math.max(1, options.maxPeersPerCompany ?? 6);
  const lookup = buildSimilarityLookup(companies);
  const candidateLists = new Map<string, CandidateEdge[]>();
  const edgeByKey = new Map<string, CandidateEdge>();

  for (const company of companies) {
    const lexical = rankSimilarityCandidates(company, lookup).slice(0, candidateLimit);
    const ranked = lexical.length ? lexical : resolveExistingEdges(company, lookup.bySlug);
    const candidates = ranked
      .slice(0, candidateLimit)
      .map((peer) => candidateEdge(company, peer.company, peer.score, peer.reason));
    candidateLists.set(company.slug, candidates);
    for (const edge of candidates) {
      const existing = edgeByKey.get(edge.key);
      if (!existing || edge.score > existing.score) edgeByKey.set(edge.key, edge);
    }
  }

  const edgesBySlug = new Map<string, UniverseCompany['competitors']>(
    companies.map((company) => [company.slug, []])
  );
  const degrees = new Map(companies.map((company) => [company.slug, 0]));
  const selectedKeys = new Set<string>();
  const selectEdge = (edge: CandidateEdge): boolean => {
    if (selectedKeys.has(edge.key)) return false;
    if (
      (degrees.get(edge.left.slug) ?? 0) >= maxPeersPerCompany ||
      (degrees.get(edge.right.slug) ?? 0) >= maxPeersPerCompany
    ) {
      return false;
    }
    selectedKeys.add(edge.key);
    degrees.set(edge.left.slug, (degrees.get(edge.left.slug) ?? 0) + 1);
    degrees.set(edge.right.slug, (degrees.get(edge.right.slug) ?? 0) + 1);
    edgesBySlug.get(edge.left.slug)?.push({
      slug: edge.right.slug,
      name: edge.right.name,
      score: edge.score,
      reason: edge.reason,
    });
    edgesBySlug.get(edge.right.slug)?.push({
      slug: edge.left.slug,
      name: edge.left.name,
      score: edge.score,
      reason: edge.reason,
    });
    return true;
  };

  const scarceFirst = [...companies].sort((left, right) => {
    const countDifference =
      (candidateLists.get(left.slug)?.length ?? 0) - (candidateLists.get(right.slug)?.length ?? 0);
    return countDifference || left.slug.localeCompare(right.slug);
  });
  for (const company of scarceFirst) {
    if ((degrees.get(company.slug) ?? 0) > 0) continue;
    for (const candidate of candidateLists.get(company.slug) ?? []) {
      if (selectEdge(edgeByKey.get(candidate.key) ?? candidate)) break;
    }
  }

  const globallyRanked = [...edgeByKey.values()].sort(
    (left, right) => right.score - left.score || left.key.localeCompare(right.key)
  );
  for (const edge of globallyRanked) selectEdge(edge);

  for (const peers of edgesBySlug.values()) {
    peers.sort(
      (left, right) =>
        right.score - left.score || (left.name ?? left.slug).localeCompare(right.name ?? right.slug)
    );
  }
  const degreeValues = [...degrees.values()];
  return {
    edgesBySlug,
    candidateEdgeCount: edgeByKey.size,
    undirectedEdgeCount: selectedKeys.size,
    companiesWithPeers: degreeValues.filter((degree) => degree > 0).length,
    maxDegree: Math.max(0, ...degreeValues),
  };
}

interface CandidateEdge {
  key: string;
  left: UniverseCompany;
  right: UniverseCompany;
  score: number;
  reason: string;
}

function candidateEdge(
  first: UniverseCompany,
  second: UniverseCompany,
  score: number,
  reason: string
): CandidateEdge {
  const [left, right] =
    first.slug.localeCompare(second.slug) <= 0 ? [first, second] : [second, first];
  return {
    key: `${left.slug}\u0000${right.slug}`,
    left,
    right,
    score,
    reason,
  };
}

function rankSimilarityCandidates(
  anchor: UniverseCompany,
  lookup: SimilarityLookup
): SimilarCompany[] {
  const feature = lookup.features.get(anchor.slug);
  const candidateSlugs = new Set<string>();
  if (feature) {
    for (const token of feature.tokens) {
      for (const slug of lookup.inverted.get(`token:${token}`) ?? []) candidateSlugs.add(slug);
    }
    for (const theme of feature.themes) {
      for (const slug of lookup.inverted.get(`theme:${theme}`) ?? []) candidateSlugs.add(slug);
    }
  }
  candidateSlugs.delete(anchor.slug);

  return feature
    ? [...candidateSlugs]
        .map((slug) => {
          const peer = lookup.bySlug.get(slug);
          const peerFeature = lookup.features.get(slug);
          if (!peer || !peerFeature) return null;
          return scoreSimilarity(anchor, feature, peer, peerFeature);
        })
        .filter((item): item is SimilarCompany => item !== null)
        .sort(
          (left, right) =>
            right.score - left.score || left.company.name.localeCompare(right.company.name)
        )
    : [];
}

function buildSimilarityLookup(companies: UniverseCompany[]): SimilarityLookup {
  const bySlug = new Map(companies.map((company) => [company.slug, company]));
  const features = new Map(
    companies.map((company) => [company.slug, similarityFeatures(company)] as const)
  );
  const inverted = new Map<string, Set<string>>();

  for (const company of companies) {
    const feature = features.get(company.slug);
    if (!feature) continue;
    for (const token of feature.tokens) addToIndex(inverted, `token:${token}`, company.slug);
    for (const theme of feature.themes) addToIndex(inverted, `theme:${theme}`, company.slug);
  }

  return { bySlug, features, inverted };
}

function similarityFeatures(company: UniverseCompany): SimilarityFeatures {
  const entityText = company.entities?.map((entity) => entity.text).join(' ') ?? '';
  const normalizedText = normalize(`${company.description} ${entityText}`);
  const rawTokens = tokenize(normalizedText).map(stemToken);
  const tokens = new Set(rawTokens.filter((token) => !SIMILARITY_STOP_WORDS.has(token)));
  const themes = new Set(
    SIMILARITY_THEMES.filter((theme) => rawTokens.some((token) => theme.terms.has(token))).map(
      (theme) => theme.label
    )
  );
  if (
    normalizedText.includes('open source') ||
    normalizedText.includes('local first') ||
    normalizedText.includes('on device')
  ) {
    themes.add('open source and local first');
  }
  const normalizedName = normalize(company.name);
  const entities = new Set(
    company.entities
      ?.filter((entity) => entity.label !== 'product')
      ?.map((entity) => normalize(entity.text))
      .filter(
        (entity) =>
          Boolean(entity) &&
          entity !== normalizedName &&
          entity !== normalize(company.category) &&
          !GENERIC_ENTITY_CONCEPTS.has(entity) &&
          tokenize(entity)
            .map(stemToken)
            .some((token) => !SIMILARITY_STOP_WORDS.has(token))
      ) ?? []
  );
  const entityTokens = new Set(
    [...entities]
      .flatMap((entity) => tokenize(entity))
      .map(stemToken)
      .filter((token) => !SIMILARITY_STOP_WORDS.has(token))
  );
  return { tokens, themes, entities, entityTokens };
}

function scoreSimilarity(
  anchor: UniverseCompany,
  anchorFeature: SimilarityFeatures,
  peer: UniverseCompany,
  peerFeature: SimilarityFeatures
): SimilarCompany | null {
  const sharedTokens = [...anchorFeature.tokens].filter((token) => peerFeature.tokens.has(token));
  const sharedThemes = [...anchorFeature.themes].filter((theme) => peerFeature.themes.has(theme));
  const sharedEntities = [...anchorFeature.entities].filter((entity) =>
    peerFeature.entities.has(entity)
  );
  const exactEntityTokens = new Set(
    sharedEntities.flatMap((entity) => tokenize(entity).map(stemToken))
  );
  const sharedEntityTokens = [...anchorFeature.entityTokens].filter(
    (token) => peerFeature.entityTokens.has(token) && !exactEntityTokens.has(token)
  );
  if (!sharedTokens.length && !sharedThemes.length && !sharedEntities.length) return null;

  const sameCategory = anchor.category === peer.category && anchor.category !== 'Other';
  const strongCrossCategoryMatch =
    sharedEntities.length > 0 ||
    sharedEntityTokens.length >= 2 ||
    sharedTokens.length >= 2 ||
    sharedThemes.length >= 2;
  if (!sameCategory && !strongCrossCategoryMatch) return null;

  let score =
    sharedTokens.length * 8 +
    sharedThemes.length * 5 +
    sharedEntities.length * 12 +
    sharedEntityTokens.length * 10;
  const reasons: string[] = [];
  if (sharedEntities.length)
    reasons.push(`shared extracted concepts: ${sharedEntities.slice(0, 3).join(', ')}`);
  else if (sharedEntityTokens.length)
    reasons.push(`shared extracted concept terms: ${sharedEntityTokens.slice(0, 4).join(', ')}`);
  if (sharedTokens.length)
    reasons.push(`shared product terms: ${sharedTokens.slice(0, 4).join(', ')}`);
  if (sharedThemes.length) reasons.push(`shared product theme: ${sharedThemes.join(', ')}`);
  if (sameCategory) {
    score += 3;
    reasons.push(`same category: ${anchor.category}`);
  }
  const sharedAffiliations = peer.investors.filter((investor) =>
    anchor.investors.includes(investor)
  );
  if (sharedAffiliations.length) {
    score += 1;
    reasons.push(`shared affiliation: ${sharedAffiliations.join(', ')}`);
  }
  return { company: peer, score, reason: reasons.join('; ') };
}

function addToIndex(index: Map<string, Set<string>>, key: string, slug: string): void {
  const values = index.get(key) ?? new Set<string>();
  values.add(slug);
  index.set(key, values);
}

function resolveExistingEdges(
  anchor: UniverseCompany,
  bySlug: Map<string, UniverseCompany>
): SimilarCompany[] {
  return anchor.competitors
    .map((edge) => {
      const company = bySlug.get(edge.slug);
      return company ? { company, score: edge.score, reason: edge.reason } : null;
    })
    .filter((item): item is SimilarCompany => item !== null);
}

function stemToken(token: string): string {
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function affiliationAlias(investor: string): string {
  if (investor === 'Y Combinator') return 'YC';
  if (investor === 'Andreessen Horowitz') return 'a16z';
  return '';
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value.match(/[a-z0-9]{2,}/g) ?? [];
}
