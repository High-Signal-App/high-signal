import type { Metadata } from 'next';
import { BackLink, HeroHeader, PageShell, Panel } from '@/components/system/HighSignalUI';
import { CompanySearchForm } from '../CompanySearchForm';
import { CompanyUniverseList } from '../CompanyUniverseList';
import { searchCompanyUniverse } from '../company-search';
import { CASE_STUDIES, COMPANY_UNIVERSE, COMPANY_UNIVERSE_LAST_UPDATED } from '../data';

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export const metadata: Metadata = {
  title: 'Search companies — High Signal',
  description: 'Search what companies backed by YC, Antler, a16z, and Techstars are building.',
  robots: { index: false, follow: true },
};

export default async function CompanySearchPage({ searchParams }: SearchPageProps) {
  const rawQuery = (await searchParams).q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? '';
  const results = searchCompanyUniverse(CASE_STUDIES, query);
  const updatedAt = COMPANY_UNIVERSE_LAST_UPDATED.slice(0, 19).replace('T', ' ');

  return (
    <PageShell max="max-w-5xl">
      <BackLink href="/case-studies">back to company universe</BackLink>
      <HeroHeader eyebrow="company search" title="What is each company building?" size="md">
        Search names and descriptions, or combine categories, affiliations, programs, and locations.
      </HeroHeader>

      <CompanySearchForm
        companyCount={COMPANY_UNIVERSE.companyCount}
        defaultQuery={query}
        lastUpdatedAt={COMPANY_UNIVERSE_LAST_UPDATED}
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
          <CompanyUniverseList
            companies={results.companies}
            page={1}
            paginated={false}
            summary={`${results.total.toLocaleString()} ranked matches for “${query}” · showing top ${results.companies.length}`}
          />
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
