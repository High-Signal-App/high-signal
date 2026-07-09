import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface FundSource {
  id: string;
  label: string;
  url: string;
  pageUrl: (page: number) => string;
}

interface SourceEvidence {
  source: string;
  sourceUrl: string;
  fund: string;
  position: number;
  title: string;
  description: string;
}

interface JsonLdListItem {
  position?: number;
  item?: {
    name?: string;
    description?: string;
  };
}

interface JsonLdGraphItem {
  '@type'?: string;
  itemListElement?: JsonLdListItem[];
}

interface Company {
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

const ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(ROOT, 'apps/web/src/data/company-universe.json');
const TARGET_COUNT = Number(process.env.HIGH_SIGNAL_COMPANY_UNIVERSE_TARGET ?? 2200);
const FETCH_CONCURRENCY = Number(process.env.HIGH_SIGNAL_COMPANY_UNIVERSE_CONCURRENCY ?? 12);
const FETCH_TIMEOUT_MS = Number(process.env.HIGH_SIGNAL_COMPANY_UNIVERSE_TIMEOUT_MS ?? 10000);

const SOURCES: FundSource[] = [
  {
    id: 'vcbacked-a16z',
    label: 'Andreessen Horowitz',
    url: 'https://www.vcbacked.co/directory/investors/andreessen-horowitz',
    pageUrl: (page) =>
      page === 1
        ? 'https://www.vcbacked.co/directory/investors/andreessen-horowitz'
        : `https://www.vcbacked.co/directory/investors/andreessen-horowitz/page/${page}`,
  },
  {
    id: 'vcbacked-sequoia',
    label: 'Sequoia Capital',
    url: 'https://www.vcbacked.co/directory/investors/sequoia-capital',
    pageUrl: (page) =>
      page === 1
        ? 'https://www.vcbacked.co/directory/investors/sequoia-capital'
        : `https://www.vcbacked.co/directory/investors/sequoia-capital/page/${page}`,
  },
  {
    id: 'vcbacked-bessemer',
    label: 'Bessemer Venture Partners',
    url: 'https://www.vcbacked.co/directory/investors/bessemer-venture-partners',
    pageUrl: (page) =>
      page === 1
        ? 'https://www.vcbacked.co/directory/investors/bessemer-venture-partners'
        : `https://www.vcbacked.co/directory/investors/bessemer-venture-partners/page/${page}`,
  },
];

const OFFICIAL_SOURCE_URLS = {
  a16z: 'https://a16z.com/investment-list/',
  bvp: 'https://www.bvp.com/companies',
  sequoia: 'https://sequoiacap.com/our-companies/',
} as const;

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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function text(input: unknown): string {
  return String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCategory(name: string, description: string): string {
  const haystack = `${name} ${description}`;
  return CATEGORY_RULES.find(([, regex]) => regex.test(haystack))?.[0] ?? 'Other';
}

function isValidCompanyName(name: string): boolean {
  return Boolean(name) && !name.includes('[') && !/^(untitled|unknown|company)$/i.test(name);
}

function keywords(company: Pick<Company, 'name' | 'description' | 'category'>): Set<string> {
  const stop = new Set([
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
  ]);
  return new Set(
    `${company.name} ${company.description} ${company.category}`
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g)
      ?.filter((word) => !stop.has(word))
      .slice(0, 30) ?? []
  );
}

function parseJsonLdCompanies(
  html: string,
  source: FundSource,
  sourceUrl: string
): SourceEvidence[] {
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!script) return [];
  const parsed = JSON.parse(script) as { '@graph'?: JsonLdGraphItem[] };
  const graph = parsed['@graph'] ?? [];
  const list = graph.find((item) => item['@type'] === 'ItemList');
  const elements = list?.itemListElement ?? [];
  return elements
    .map((entry) => ({
      source: source.id,
      sourceUrl,
      fund: source.label,
      position: Number(entry?.position ?? 0),
      title: text(entry?.item?.name),
      description: text(entry?.item?.description),
    }))
    .filter((entry: SourceEvidence) => isValidCompanyName(entry.title));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'high-signal-company-universe/0.1' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchFund(source: FundSource, remaining: () => number): Promise<SourceEvidence[]> {
  const firstHtml = await fetchText(source.pageUrl(1));
  const count = Number(firstHtml.match(/"numberOfItems":(\d+)/)?.[1] ?? 250);
  const pages = Math.ceil(count / 10);
  const out = parseJsonLdCompanies(firstHtml, source, source.pageUrl(1));
  console.log(JSON.stringify({ source: source.id, pages, firstPageItems: out.length }));

  const pageNumbers = Array.from({ length: Math.max(pages - 1, 0) }, (_, index) => index + 2);
  for (let i = 0; i < pageNumbers.length && remaining() > 0; i += FETCH_CONCURRENCY) {
    const batch = pageNumbers.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (page) => {
        const pageUrl = source.pageUrl(page);
        try {
          const html = await fetchText(pageUrl);
          return parseJsonLdCompanies(html, source, pageUrl);
        } catch {
          return [];
        }
      })
    );
    out.push(...results.flat());
    if (i % (FETCH_CONCURRENCY * 4) === 0) {
      console.log(JSON.stringify({ source: source.id, page: batch.at(-1), items: out.length }));
    }
  }
  return out;
}

async function fetchOfficialA16z(): Promise<SourceEvidence[]> {
  const html = await fetchText(OFFICIAL_SOURCE_URLS.a16z);
  const names = [...html.matchAll(/<li>([^<]{2,100})<\/li>/g)]
    .map((match) => text(match[1].replace(/&amp;/g, '&')))
    .filter(
      (name) =>
        isValidCompanyName(name) &&
        !/^(AI|Consumer|Crypto|Enterprise|Fintech|Growth|Infrastructure|Portfolio|Team)$/.test(name)
    );
  return names.map((name, index) => ({
    source: 'a16z-investment-list',
    sourceUrl: OFFICIAL_SOURCE_URLS.a16z,
    fund: 'Andreessen Horowitz',
    position: index + 1,
    title: name,
    description: '',
  }));
}

async function fetchOfficialBvp(): Promise<SourceEvidence[]> {
  const html = await fetchText(OFFICIAL_SOURCE_URLS.bvp);
  const out: SourceEvidence[] = [];
  const regex = /<a[^>]+href="([^"]*\/companies\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match = regex.exec(html);
  while (match) {
    const title = text(
      match[2]
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
    );
    if (!isValidCompanyName(title) || title.length > 100) {
      match = regex.exec(html);
      continue;
    }
    out.push({
      source: 'bvp-companies',
      sourceUrl: match[1].startsWith('http') ? match[1] : `https://www.bvp.com${match[1]}`,
      fund: 'Bessemer Venture Partners',
      position: out.length + 1,
      title,
      description: '',
    });
    match = regex.exec(html);
  }
  return out;
}

async function fetchOfficialSequoiaSpotlights(): Promise<SourceEvidence[]> {
  const html = await fetchText(OFFICIAL_SOURCE_URLS.sequoia);
  const out: SourceEvidence[] = [];
  const regex =
    /<a class="ink"[\s\S]*?href="([^"]+)"[\s\S]*?<h2 class="ink__title"[\s\S]*?>([^<]+)<\/h2>[\s\S]*?<div class="ink__detail"[\s\S]*?>([^<]+)<\/div>/g;
  let match = regex.exec(html);
  while (match) {
    out.push({
      source: 'sequoia-our-companies',
      sourceUrl: match[1],
      fund: 'Sequoia Capital',
      position: out.length + 1,
      title: text(match[2].replace(/&#039;/g, "'").replace(/&amp;/g, '&')),
      description: text(match[3].replace(/&#039;/g, "'").replace(/&amp;/g, '&')),
    });
    match = regex.exec(html);
  }
  return out;
}

function mergeCompanies(evidence: SourceEvidence[]): Company[] {
  const bySlug = new Map<string, Company>();
  for (const item of evidence) {
    const slug = slugify(item.title);
    const existing = bySlug.get(slug);
    if (existing) {
      existing.investors = Array.from(new Set([...existing.investors, item.fund])).sort();
      existing.sourceEvidence.push(item);
      if (item.description.length > existing.description.length) {
        existing.description = item.description;
      }
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

function mapCompetitors(companies: Company[]): Company[] {
  const keywordCache = new Map<string, Set<string>>();
  for (const company of companies) keywordCache.set(company.slug, keywords(company));

  for (const company of companies) {
    const ownKeywords = keywordCache.get(company.slug) ?? new Set<string>();
    const candidates = companies
      .filter((other) => other.slug !== company.slug)
      .map((other) => {
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
          reasons.push(`shared investor: ${sharedInvestors.join(', ')}`);
        }
        const otherKeywords = keywordCache.get(other.slug) ?? new Set<string>();
        const overlap = [...ownKeywords].filter((word) => otherKeywords.has(word));
        score += Math.min(overlap.length, 6);
        if (overlap.length) reasons.push(`shared terms: ${overlap.slice(0, 4).join(', ')}`);
        const sameFundPositions = company.sourceEvidence
          .flatMap((left) =>
            other.sourceEvidence
              .filter((right) => right.fund === left.fund)
              .map((right) => Math.abs((right.position || 9999) - (left.position || 9999)))
          )
          .filter((delta) => delta <= 12);
        if (sameFundPositions.length) {
          score += company.category === 'Other' ? 4 : 3;
          reasons.push(
            company.category === 'Other'
              ? 'nearby fund-directory cohort (low-confidence peer)'
              : 'nearby fund-directory cohort'
          );
        }
        return { other, score, reason: reasons.join('; ') || 'weak lexical adjacency' };
      })
      .filter(
        (candidate) =>
          candidate.score >= 7 || (company.category === 'Other' && candidate.score >= 4)
      )
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

async function main() {
  const allEvidence: SourceEvidence[] = [];
  allEvidence.push(
    ...(await fetchOfficialA16z()),
    ...(await fetchOfficialBvp()),
    ...(await fetchOfficialSequoiaSpotlights())
  );
  console.log(
    JSON.stringify({
      source: 'official-fund-pages',
      items: allEvidence.length,
      unique: new Set(allEvidence.map((item) => slugify(item.title))).size,
    })
  );
  for (const source of SOURCES) {
    const evidence = await fetchFund(
      source,
      () => TARGET_COUNT - new Set(allEvidence.map((item) => slugify(item.title))).size
    );
    allEvidence.push(...evidence);
    const uniqueCount = new Set(allEvidence.map((item) => slugify(item.title))).size;
    if (uniqueCount >= TARGET_COUNT) break;
  }

  const companies = mapCompetitors(mergeCompanies(allEvidence))
    .sort((a, b) => {
      const aMin = Math.min(...a.sourceEvidence.map((item) => item.position || 9999));
      const bMin = Math.min(...b.sourceEvidence.map((item) => item.position || 9999));
      return aMin - bMin || a.name.localeCompare(b.name);
    })
    .slice(0, TARGET_COUNT);

  const artifact = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/build-company-universe.ts',
    strictHighSignalOnly: true,
    targetCount: TARGET_COUNT,
    companyCount: companies.length,
    sourceInputs: SOURCES.map((source) => ({
      id: source.id,
      label: source.label,
      url: source.url,
    })).concat([
      {
        id: 'a16z-investment-list',
        label: 'Andreessen Horowitz official investment list',
        url: OFFICIAL_SOURCE_URLS.a16z,
      },
      {
        id: 'bvp-companies',
        label: 'Bessemer Venture Partners official companies',
        url: OFFICIAL_SOURCE_URLS.bvp,
      },
      {
        id: 'sequoia-our-companies',
        label: 'Sequoia official company spotlights',
        url: OFFICIAL_SOURCE_URLS.sequoia,
      },
    ]),
    competitorMapping: {
      method:
        'deterministic High Signal graph: same inferred category + shared investor/source + description keyword overlap',
      minimumScore: 7,
      maxCompetitorsPerCompany: 6,
    },
    companies,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        out: OUT_PATH,
        companies: companies.length,
        sources: SOURCES.length,
        withCompetitors: companies.filter((company) => company.competitors.length > 0).length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
