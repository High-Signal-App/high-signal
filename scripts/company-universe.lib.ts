export const REQUIRED_SOURCES = [
  {
    id: 'yc-company-directory',
    label: 'Y Combinator company directory',
    affiliation: 'Y Combinator',
    url: 'https://www.ycombinator.com/companies',
    minimumCount: 1_000,
  },
  {
    id: 'antler-portfolio',
    label: 'Antler portfolio directory',
    affiliation: 'Antler',
    url: 'https://www.antler.co/portfolio',
    minimumCount: 100,
  },
  {
    id: 'a16z-investment-list',
    label: 'Andreessen Horowitz official investment list',
    affiliation: 'Andreessen Horowitz',
    url: 'https://a16z.com/investment-list/',
    minimumCount: 100,
  },
  {
    id: 'techstars-portfolio',
    label: 'Techstars accelerator portfolio',
    affiliation: 'Techstars',
    url: 'https://www.techstars.com/portfolio',
    minimumCount: 1_000,
  },
] as const;

export type RequiredSourceId = (typeof REQUIRED_SOURCES)[number]['id'];

export interface SourceEvidence {
  source: RequiredSourceId;
  sourceUrl: string;
  fund: string;
  position: number;
  title: string;
  description: string;
  cohort?: string;
  program?: string;
  location?: string;
  website?: string;
  status?: string;
}

export interface Company {
  slug: string;
  name: string;
  description: string;
  category: string;
  investors: string[];
  sourceEvidence: SourceEvidence[];
  competitors: Array<{
    slug: string;
    name: string;
    score: number;
    reason: string;
  }>;
}

export interface SourceStat {
  id: RequiredSourceId;
  label: string;
  fetchedCount: number;
  uniqueCompanyCount: number;
  providerReportedCount: number | null;
  reconciled: boolean | null;
}

export interface YcSearchHit {
  id?: number | string;
  name?: string;
  slug?: string;
  one_liner?: string;
  long_description?: string;
  batch?: string;
  status?: string;
  website?: string;
  all_locations?: string;
}

export interface TechstarsDocument {
  company_id?: string;
  company_name?: string;
  brief_description?: string;
  website?: string;
  program_names?: string[];
  first_session_year?: number | string;
  city?: string;
  state_province?: string;
  country?: string;
  worldregion?: string;
  is_accelerator_company?: boolean;
}

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['AI agents', /\bagent|agentic|copilot|assistant|automation|workflow ai/i],
  ['AI infrastructure', /\bai|machine learning|model|llm|mlops|inference|synthetic|red teaming/i],
  [
    'Developer tools',
    /\bdeveloper|deploy|code|api|github|cloud|observability|database|devops|infrastructure|kubernetes/i,
  ],
  ['Cybersecurity', /\bsecurity|secure|fraud|identity|compliance|privacy|risk|vulnerability/i],
  ['Fintech', /\bfintech|bank|loan|mortgage|payment|payroll|credit|insurance|wealth|financial/i],
  [
    'Healthcare',
    /\bhealth|caregiver|clinical|therapeutic|patient|medical|biotech|drug|diagnostic/i,
  ],
  [
    'Sales and marketing',
    /\bsales|marketing|crm|gtm|revenue|customer engagement|commerce marketing/i,
  ],
  ['Data and analytics', /\bdata|analytics|predictive|warehouse|etl|intelligence|dashboard/i],
  [
    'Collaboration and productivity',
    /\bcollaboration|productivity|meeting|notes|workspace|project management|roadmap/i,
  ],
  ['E-commerce', /\be-?commerce|shopify|retail|marketplace|merchant|checkout/i],
  ['Crypto and web3', /\bcrypto|web3|blockchain|wallet|dao|defi|token/i],
  ['Gaming and media', /\bgame|gaming|media|video|creator|metaverse|photo|content/i],
  ['Real estate', /\breal estate|property|landlord|tenant|mortgage/i],
  ['Climate and energy', /\bclimate|energy|carbon|electric|battery|solar|sustainability/i],
  ['HR and talent', /\btalent|hiring|recruit|employee|workforce|people/i],
  ['Enterprise SaaS', /\bsaas|enterprise|software|platform|business/i],
];

const KEYWORD_STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'company',
  'platform',
  'software',
  'helps',
  'builds',
  'offers',
  'other',
  'startup',
  'startups',
  'technology',
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function cleanText(input: unknown): string {
  return decodeHtml(String(input ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferCategory(name: string, description: string): string {
  const haystack = `${name} ${description}`;
  return CATEGORY_RULES.find(([, regex]) => regex.test(haystack))?.[0] ?? 'Other';
}

export function isValidCompanyName(name: string): boolean {
  return (
    Boolean(name) &&
    name.length <= 120 &&
    !name.includes('[') &&
    !/^(untitled|unknown|company)$/i.test(name)
  );
}

export function parseYcClientConfig(html: string): { appId: string; apiKey: string } {
  const raw = html.match(/window\.AlgoliaOpts\s*=\s*(\{[^;]+\})/)?.[1];
  if (!raw) throw new Error('YC directory did not expose AlgoliaOpts');
  const parsed = JSON.parse(raw) as { app?: string; key?: string };
  if (!parsed.app || !parsed.key) throw new Error('YC AlgoliaOpts is incomplete');
  return { appId: parsed.app, apiKey: parsed.key };
}

export function parseYcHits(hits: YcSearchHit[], startPosition = 1): SourceEvidence[] {
  return hits
    .map((hit, index) => {
      const title = cleanText(hit.name);
      const slug = cleanText(hit.slug) || slugify(title);
      const oneLiner = cleanText(hit.one_liner);
      const longDescription = cleanText(hit.long_description);
      const description = (
        longDescription.length > oneLiner.length ? longDescription : oneLiner
      ).slice(0, 500);
      return {
        source: 'yc-company-directory' as const,
        sourceUrl: slug
          ? `https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`
          : REQUIRED_SOURCES[0].url,
        fund: 'Y Combinator',
        position: startPosition + index,
        title,
        description,
        cohort: cleanText(hit.batch) || undefined,
        location: cleanText(hit.all_locations) || undefined,
        website: normalizeWebsite(hit.website),
        status: cleanText(hit.status) || undefined,
      } satisfies SourceEvidence;
    })
    .filter((item) => isValidCompanyName(item.title));
}

export function parseAntlerPage(html: string, page: number): SourceEvidence[] {
  const cardStart = '<div role="listitem" class="w-dyn-item"><div class="portco_card">';
  return html
    .split(cardStart)
    .slice(1)
    .map((card, index) => {
      const title = cleanText(card.match(/fs-cmsfilter-field="name"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
      const description = cleanText(
        card.match(/fs-cmsfilter-field="description"[^>]*>([\s\S]*?)<\/p>/)?.[1]
      );
      const tags = [...card.matchAll(/class="tag_small_text"[^>]*>([\s\S]*?)<\/div>/g)].map(
        (match) => cleanText(match[1])
      );
      const website = normalizeWebsite(card.match(/class="clickable_link[^>]*href="([^"]+)"/)?.[1]);
      return {
        source: 'antler-portfolio' as const,
        sourceUrl: `${REQUIRED_SOURCES[1].url}?0b933bfd_page=${page}`,
        fund: 'Antler',
        position: (page - 1) * 100 + index + 1,
        title,
        description,
        cohort: tags[2] ? `Antler ${tags[2]}` : undefined,
        program: tags[1] || undefined,
        location: tags[0] || undefined,
        website,
      } satisfies SourceEvidence;
    })
    .filter((item) => isValidCompanyName(item.title));
}

export function nextAntlerPage(html: string): number | null {
  const next = html.match(/href="\?0b933bfd_page=(\d+)"[^>]*aria-label="Next Page"/)?.[1];
  return next ? Number(next) : null;
}

export function parseOfficialA16z(html: string): SourceEvidence[] {
  const names = [...html.matchAll(/<li>([^<]{2,120})<\/li>/g)]
    .map((match) => cleanText(match[1]))
    .filter(
      (name) =>
        isValidCompanyName(name) &&
        !/^(AI|Consumer|Crypto|Enterprise|Fintech|Growth|Infrastructure|Portfolio|Team)$/.test(name)
    );
  return names.map((name, index) => ({
    source: 'a16z-investment-list',
    sourceUrl: REQUIRED_SOURCES[2].url,
    fund: 'Andreessen Horowitz',
    position: index + 1,
    title: name,
    description: '',
  }));
}

export function parseTechstarsClientConfig(html: string): { baseUrl: string; apiKey: string } {
  const baseUrl = html.match(/"TYPESENSE_SEARCH_URL":"([^"]+)"/)?.[1];
  const apiKey = html.match(/"TYPESENSE_SEARCH_TOKEN":"([^"]+)"/)?.[1];
  if (!baseUrl || !apiKey) throw new Error('Techstars portfolio did not expose Typesense config');
  return { baseUrl, apiKey };
}

export function parseTechstarsDocuments(
  documents: TechstarsDocument[],
  startPosition = 1
): SourceEvidence[] {
  return documents
    .filter((document) => document.is_accelerator_company !== false)
    .map((document, index) => {
      const title = cleanText(document.company_name);
      const location = [document.city, document.state_province, document.country]
        .map(cleanText)
        .filter(Boolean)
        .join(', ');
      const programs = (document.program_names ?? []).map(cleanText).filter(Boolean);
      const year = cleanText(document.first_session_year);
      return {
        source: 'techstars-portfolio' as const,
        sourceUrl: REQUIRED_SOURCES[3].url,
        fund: 'Techstars',
        position: startPosition + index,
        title,
        description: cleanText(document.brief_description),
        cohort: year ? `Techstars ${year}` : undefined,
        program: programs.join('; ') || undefined,
        location: location || cleanText(document.worldregion) || undefined,
        website: normalizeWebsite(document.website),
      } satisfies SourceEvidence;
    })
    .filter((item) => isValidCompanyName(item.title));
}

export function mergeCompanies(evidence: SourceEvidence[]): Company[] {
  const bySlug = new Map<string, Company>();
  for (const item of evidence) {
    const slug = slugify(item.title);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (existing) {
      existing.investors = Array.from(new Set([...existing.investors, item.fund])).sort();
      existing.sourceEvidence.push(item);
      if (item.description.length > existing.description.length)
        existing.description = item.description;
      existing.category = inferCategory(existing.name, existing.description);
      continue;
    }
    bySlug.set(slug, {
      slug,
      name: item.title,
      description: item.description,
      category: inferCategory(item.title, item.description),
      investors: [item.fund],
      sourceEvidence: [item],
      competitors: [],
    });
  }
  return [...bySlug.values()];
}

export function buildSourceStats(
  evidence: SourceEvidence[],
  providerReportedCounts: Partial<Record<RequiredSourceId, number>> = {}
): SourceStat[] {
  return REQUIRED_SOURCES.map((source) => {
    const rows = evidence.filter((item) => item.source === source.id);
    const providerReportedCount = providerReportedCounts[source.id] ?? null;
    return {
      id: source.id,
      label: source.label,
      fetchedCount: rows.length,
      uniqueCompanyCount: new Set(rows.map((item) => slugify(item.title))).size,
      providerReportedCount,
      reconciled: providerReportedCount == null ? null : providerReportedCount === rows.length,
    };
  });
}

export function validateCoverage(
  companies: Company[],
  stats: SourceStat[],
  minimumCounts: Partial<Record<RequiredSourceId, number>> = {}
): void {
  const errors: string[] = [];
  for (const required of REQUIRED_SOURCES) {
    const stat = stats.find((item) => item.id === required.id);
    const minimum = minimumCounts[required.id] ?? required.minimumCount;
    if (!stat || stat.fetchedCount < minimum) {
      errors.push(
        `${required.id} returned ${stat?.fetchedCount ?? 0}; expected at least ${minimum}`
      );
    }
    if (stat?.reconciled === false) {
      errors.push(
        `${required.id} returned ${stat.fetchedCount}; provider reported ${stat.providerReportedCount}`
      );
    }
    if (!companies.some((company) => company.investors.includes(required.affiliation))) {
      errors.push(`${required.id} affiliation is absent from merged companies`);
    }
  }
  if (errors.length)
    throw new Error(`company-universe coverage validation failed:\n- ${errors.join('\n- ')}`);
}

export function mapCompetitors(companies: Company[]): Company[] {
  const bySlug = new Map(companies.map((company) => [company.slug, company]));
  const candidateMap = new Map(companies.map((company) => [company.slug, new Set<string>()]));
  const keywordCache = new Map(companies.map((company) => [company.slug, keywords(company)]));

  const addGroupedNeighbors = (groups: Map<string, Company[]>, radius: number) => {
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.slug.localeCompare(b.slug));
      for (let index = 0; index < sorted.length; index += 1) {
        const candidates = candidateMap.get(sorted[index].slug);
        if (!candidates) continue;
        for (
          let peerIndex = Math.max(0, index - radius);
          peerIndex <= Math.min(sorted.length - 1, index + radius);
          peerIndex += 1
        ) {
          if (peerIndex !== index) candidates.add(sorted[peerIndex].slug);
        }
      }
    }
  };

  addGroupedNeighbors(
    groupBy(companies, (company) => company.investors, 1),
    8
  );
  addGroupedNeighbors(
    groupBy(companies, (company) => [company.category], 1),
    8
  );
  addGroupedNeighbors(
    groupBy(
      companies,
      (company) =>
        company.sourceEvidence
          .map((item) => `${item.fund}:${item.cohort || item.program || 'all'}`)
          .filter(Boolean),
      1
    ),
    6
  );
  addGroupedNeighbors(
    groupBy(companies, (company) => [...(keywordCache.get(company.slug) ?? [])].slice(0, 8), 2),
    2
  );

  for (const company of companies) {
    const ownKeywords = keywordCache.get(company.slug) ?? new Set<string>();
    const candidates = [...(candidateMap.get(company.slug) ?? [])]
      .map((slug) => bySlug.get(slug))
      .filter((other): other is Company => Boolean(other))
      .map((other) =>
        scoreCompetitor(company, other, ownKeywords, keywordCache.get(other.slug) ?? new Set())
      )
      .filter((candidate) => candidate.score >= (company.category === 'Other' ? 4 : 7))
      .sort((a, b) => b.score - a.score || a.other.name.localeCompare(b.other.name))
      .slice(0, 6);

    company.competitors = candidates.map(({ other, score, reason }) => ({
      slug: other.slug,
      name: other.name,
      score,
      reason,
    }));
  }
  return companies;
}

function scoreCompetitor(
  company: Company,
  other: Company,
  ownKeywords: Set<string>,
  otherKeywords: Set<string>
): { other: Company; score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];
  if (company.category !== 'Other' && other.category === company.category) {
    score += 6;
    reasons.push(`same category: ${company.category}`);
  }
  const sharedInvestors = other.investors.filter((investor) =>
    company.investors.includes(investor)
  );
  if (sharedInvestors.length) {
    score += sharedInvestors.length * 2;
    reasons.push(`shared affiliation: ${sharedInvestors.join(', ')}`);
  }
  const overlap = [...ownKeywords].filter((word) => otherKeywords.has(word));
  score += Math.min(overlap.length, 6);
  if (overlap.length) reasons.push(`shared terms: ${overlap.slice(0, 4).join(', ')}`);

  const companyCohorts = new Set(
    company.sourceEvidence.map((item) => `${item.fund}:${item.cohort || item.program || ''}`)
  );
  const sharedCohort = other.sourceEvidence.find((item) =>
    companyCohorts.has(`${item.fund}:${item.cohort || item.program || ''}`)
  );
  if (sharedCohort?.cohort || sharedCohort?.program) {
    score += 4;
    reasons.push(`shared cohort: ${sharedCohort.cohort || sharedCohort.program}`);
  }

  const nearby = company.sourceEvidence.some((left) =>
    other.sourceEvidence.some(
      (right) => right.fund === left.fund && Math.abs(right.position - left.position) <= 12
    )
  );
  if (nearby) {
    score += company.category === 'Other' ? 4 : 3;
    reasons.push('nearby official-directory cohort');
  }
  return { other, score, reason: reasons.join('; ') || 'weak indexed adjacency' };
}

function groupBy(
  companies: Company[],
  keysFor: (company: Company) => string[],
  minimumGroupSize: number
): Map<string, Company[]> {
  const groups = new Map<string, Company[]>();
  for (const company of companies) {
    for (const key of new Set(keysFor(company).filter(Boolean))) {
      const group = groups.get(key) ?? [];
      group.push(company);
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    if (group.length < minimumGroupSize) groups.delete(key);
  }
  return groups;
}

function keywords(company: Pick<Company, 'name' | 'description' | 'category'>): Set<string> {
  return new Set(
    `${company.name} ${company.description} ${company.category}`
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g)
      ?.filter((word) => !KEYWORD_STOP.has(word))
      .slice(0, 24) ?? []
  );
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function normalizeWebsite(input: unknown): string | undefined {
  const value = cleanText(input);
  if (!value || value === '#') return undefined;
  return value;
}
