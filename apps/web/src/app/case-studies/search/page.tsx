import type { Metadata } from 'next';
import { BackLink, HeroHeader, PageShell, Panel } from '@/components/system/HighSignalUI';
import { fetchJson } from '@/lib/api';
import { CompanySearchForm } from '../CompanySearchForm';
import { CompanyUniverseTable } from '../CompanyUniverseTable';
import { parseCompanySearchPage } from '../company-search-url';
import type { UniverseCompany } from '../data';
import { CompanySearchPagination } from './CompanySearchPagination';

interface SearchPageProps {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[] }>;
}

export const metadata: Metadata = {
  title: 'Search companies — High Signal',
  description: 'Search what companies backed by YC, Antler, a16z, and Techstars are building.',
  robots: { index: false, follow: true },
};

interface CompanySearchResponse {
  generatedAt: string | null;
  universeCount?: number;
  companyCount: number;
  limit: number;
  page?: number;
  totalPages?: number;
  companies: UniverseCompany[];
}

async function loadCompanySearch(
  query: string,
  requestedPage: number
): Promise<CompanySearchResponse> {
  const apiParams = new URLSearchParams({ limit: query ? '20' : '1' });
  if (query) {
    apiParams.set('q', query);
    apiParams.set('page', String(requestedPage));
    apiParams.set('ranked', 'true');
  }

  try {
    return await fetchJson<CompanySearchResponse>(`/company-universe?${apiParams}`);
  } catch {
    const [{ searchCompanyUniverse }, universe] = await Promise.all([
      import('../company-search'),
      import('../data'),
    ]);
    const fallback = searchCompanyUniverse(universe.CASE_STUDIES, query, {
      page: requestedPage,
    });
    return {
      generatedAt: universe.COMPANY_UNIVERSE_LAST_UPDATED,
      universeCount: universe.COMPANY_UNIVERSE.companyCount,
      companyCount: fallback.total,
      limit: fallback.pageSize,
      page: fallback.page,
      totalPages: fallback.totalPages,
      companies: fallback.companies,
    };
  }
}

export default async function CompanySearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const rawQuery = params.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? '';
  const requestedPage = parseCompanySearchPage(params.page);
  const results = await loadCompanySearch(query, requestedPage);
  const page = results.page ?? 1;
  const totalPages = results.totalPages ?? 0;
  const updatedAt = results.generatedAt?.slice(0, 19).replace('T', ' ') ?? 'unavailable';
  const firstResult = (page - 1) * results.limit + 1;
  const lastResult = firstResult + results.companies.length - 1;

  return (
    <PageShell max="max-w-5xl">
      <BackLink href="/case-studies">back to company universe</BackLink>
      <HeroHeader eyebrow="company search" title="What is each company building?" size="md">
        Search names and descriptions, or combine categories, affiliations, programs, and locations.
      </HeroHeader>

      <CompanySearchForm
        companyCount={results.universeCount ?? results.companyCount}
        defaultQuery={query}
        lastUpdatedAt={results.generatedAt ?? 'unavailable'}
      />

      <Panel eyebrow="snapshot freshness" title={`Last updated ${updatedAt} UTC`}>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
          This is a manually refreshed directory from the four official source surfaces, followed by
          offline product-facet extraction. Search results reflect that frozen snapshot; no
          automatic-refresh claim is made.
        </p>
      </Panel>

      {query ? (
        results.companies.length > 0 ? (
          <>
            <section className="mt-8">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                {results.companyCount.toLocaleString()} ranked matches for “{query}” · showing{' '}
                {firstResult.toLocaleString()}-{lastResult.toLocaleString()} based on match
              </div>
              <CompanyUniverseTable companies={results.companies} />
            </section>
            <CompanySearchPagination page={page} query={query} totalPages={totalPages} />
          </>
        ) : (
          <Panel eyebrow="0 matches" title={`No companies matched “${query}”`}>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
              Try fewer terms, a category such as fintech or healthcare, an affiliation such as YC
              or Antler, or a location.
            </p>
          </Panel>
        )
      ) : (
        <Panel eyebrow="search ready" title="Describe a company, market, or problem">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Examples: “screenpipe”, “AI workflow finance”, “climate batteries”, “Techstars India”,
            or an exact company name. Open any result to explore its similar-company cluster.
          </p>
        </Panel>
      )}
    </PageShell>
  );
}
