import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  REQUIRED_SOURCES,
  type RequiredSourceId,
  type SourceEvidence,
  type TechstarsDocument,
  type YcSearchHit,
  buildSourceStats,
  mapCompetitors,
  mergeCompanies,
  nextAntlerPage,
  parseAntlerPage,
  parseOfficialA16z,
  parseTechstarsClientConfig,
  parseTechstarsDocuments,
  parseYcClientConfig,
  parseYcHits,
  validateCoverage,
} from './company-universe.lib';
import { writeWebCompanyUniverseArtifact } from './company-universe-web-artifact';

const ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(ROOT, 'apps/web/src/data/company-universe.json');
const FETCH_CONCURRENCY = Number(process.env.HIGH_SIGNAL_COMPANY_UNIVERSE_CONCURRENCY ?? 8);
const FETCH_TIMEOUT_MS = Number(process.env.HIGH_SIGNAL_COMPANY_UNIVERSE_TIMEOUT_MS ?? 20_000);

interface YcQueryResponse {
  hits?: YcSearchHit[];
  nbHits?: number;
  facets?: { batch?: Record<string, number> };
}

interface TechstarsSearchResponse {
  found?: number;
  page?: number;
  hits?: Array<{ document?: TechstarsDocument }>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'high-signal-company-universe/0.2' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'high-signal-company-universe/0.2',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

async function mapConcurrent<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchYc(): Promise<{ evidence: SourceEvidence[]; reportedCount: number }> {
  const source = REQUIRED_SOURCES[0];
  const html = await fetchText(source.url);
  const config = parseYcClientConfig(html);
  const endpoint = `https://${config.appId.toLowerCase()}-dsn.algolia.net/1/indexes/YCCompany_production/query`;
  const headers = {
    'content-type': 'application/json',
    'x-algolia-application-id': config.appId,
    'x-algolia-api-key': config.apiKey,
  };
  const facetResponse = await fetchJson<YcQueryResponse>(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: '', hitsPerPage: 0, facets: ['batch'] }),
  });
  const reportedCount = Number(facetResponse.nbHits ?? 0);
  const batches = Object.entries(facetResponse.facets?.batch ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (!reportedCount || !batches.length) throw new Error('YC batch facets were empty');

  const pages = await mapConcurrent(batches, async ([batch, expected]) => {
    const response = await fetchJson<YcQueryResponse>(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: '',
        hitsPerPage: Math.max(expected, 1),
        page: 0,
        facetFilters: [`batch:${batch}`],
      }),
    });
    const hits = response.hits ?? [];
    if (Number(response.nbHits ?? 0) !== expected || hits.length !== expected) {
      throw new Error(
        `YC batch ${batch} returned ${hits.length}/${response.nbHits ?? 0}; expected ${expected}`
      );
    }
    return hits;
  });

  const evidence: SourceEvidence[] = [];
  for (const hits of pages) evidence.push(...parseYcHits(hits, evidence.length + 1));
  console.log(JSON.stringify({ source: source.id, reportedCount, fetched: evidence.length }));
  return { evidence, reportedCount };
}

async function fetchAntler(): Promise<{ evidence: SourceEvidence[] }> {
  const source = REQUIRED_SOURCES[1];
  const evidence: SourceEvidence[] = [];
  const seenPages = new Set<number>();
  let page = 1;
  while (!seenPages.has(page) && page <= 100) {
    seenPages.add(page);
    const pageUrl = `${source.url}?0b933bfd_page=${page}`;
    const html = await fetchText(pageUrl);
    const rows = parseAntlerPage(html, page);
    if (!rows.length) throw new Error(`Antler page ${page} returned no portfolio cards`);
    evidence.push(...rows);
    const nextPage = nextAntlerPage(html);
    if (!nextPage) break;
    page = nextPage;
  }
  if (page > 100) throw new Error('Antler pagination exceeded the 100-page safety limit');
  console.log(
    JSON.stringify({ source: source.id, pages: seenPages.size, fetched: evidence.length })
  );
  return { evidence };
}

async function fetchA16z(): Promise<{ evidence: SourceEvidence[] }> {
  const source = REQUIRED_SOURCES[2];
  const evidence = parseOfficialA16z(await fetchText(source.url));
  console.log(JSON.stringify({ source: source.id, fetched: evidence.length }));
  return { evidence };
}

async function fetchTechstars(): Promise<{ evidence: SourceEvidence[]; reportedCount: number }> {
  const source = REQUIRED_SOURCES[3];
  const html = await fetchText(source.url);
  const config = parseTechstarsClientConfig(html);
  const perPage = 250;
  const queryBy = [
    'company_name',
    'brief_description',
    'city',
    'state_province',
    'country',
    'worldregion',
    'program_names',
    'industry_vertical',
  ].join(',');
  const fetchPage = async (page: number) => {
    const url = new URL('/collections/companies/documents/search', config.baseUrl);
    url.searchParams.set('q', '*');
    url.searchParams.set('query_by', queryBy);
    url.searchParams.set('filter_by', 'is_accelerator_company:=true');
    url.searchParams.set('sort_by', 'website_order:asc');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    return fetchJson<TechstarsSearchResponse>(url.toString(), {
      headers: { 'X-TYPESENSE-API-KEY': config.apiKey },
    });
  };

  const first = await fetchPage(1);
  const reportedCount = Number(first.found ?? 0);
  if (!reportedCount) throw new Error('Techstars reported zero accelerator companies');
  const pageCount = Math.ceil(reportedCount / perPage);
  const remaining = await mapConcurrent(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2),
    fetchPage
  );
  const responses = [first, ...remaining];
  const evidence: SourceEvidence[] = [];
  for (const response of responses) {
    const documents = (response.hits ?? [])
      .map((hit) => hit.document)
      .filter((document): document is TechstarsDocument => Boolean(document));
    evidence.push(...parseTechstarsDocuments(documents, evidence.length + 1));
  }
  console.log(
    JSON.stringify({ source: source.id, pages: pageCount, reportedCount, fetched: evidence.length })
  );
  return { evidence, reportedCount };
}

async function main() {
  const [yc, antler, a16z, techstars] = await Promise.all([
    fetchYc(),
    fetchAntler(),
    fetchA16z(),
    fetchTechstars(),
  ]);
  const allEvidence = [...yc.evidence, ...antler.evidence, ...a16z.evidence, ...techstars.evidence];
  const providerReportedCounts: Partial<Record<RequiredSourceId, number>> = {
    'yc-company-directory': yc.reportedCount,
    'techstars-portfolio': techstars.reportedCount,
  };
  const sourceStats = buildSourceStats(allEvidence, providerReportedCounts);
  const companies = mapCompetitors(mergeCompanies(allEvidence)).sort(
    (a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
  );
  validateCoverage(companies, sourceStats);

  const artifact = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/build-company-universe.ts',
    strictHighSignalOnly: true,
    companyCount: companies.length,
    sourceInputs: REQUIRED_SOURCES.map(({ id, label, url }) => ({ id, label, url })),
    sourceStats,
    competitorMapping: {
      method:
        'deterministic indexed graph: same category + shared accelerator/investor + cohort adjacency + description keyword overlap',
      minimumScore: 7,
      maxCompetitorsPerCompany: 6,
    },
    companies,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  const webArtifactBytes = await writeWebCompanyUniverseArtifact(artifact);
  const outputStat = await stat(OUT_PATH);
  console.log(
    JSON.stringify(
      {
        out: OUT_PATH,
        companies: companies.length,
        evidence: allEvidence.length,
        sourceStats,
        crossAffiliated: companies.filter((company) => company.investors.length > 1).length,
        withCompetitors: companies.filter((company) => company.competitors.length > 0).length,
        artifactBytes: outputStat.size,
        webArtifactBytes,
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
