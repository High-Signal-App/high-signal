import type { Metadata } from 'next';
import { BackLink, HeroHeader, PageShell, Panel, StatGrid } from '@/components/system/HighSignalUI';
import { SITE_URL } from '@/lib/site';
import { CompanyUniverseList } from './CompanyUniverseList';
import { CompanyLookupForm } from './CompanyLookupForm';
import { CompanySearchForm } from './CompanySearchForm';
import {
  CASE_STUDIES,
  COMPANY_UNIVERSE,
  COMPANY_UNIVERSE_LAST_UPDATED,
  FLOW,
  getCaseStudiesPage,
} from './data';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Company universe',
  description:
    'Generated High Signal company universe with source-backed companies and competitor mappings.',
  alternates: { canonical: `${SITE_URL}/case-studies` },
};

export default function CaseStudiesPage() {
  const withCompetitors = CASE_STUDIES.filter((item) => item.competitors.length > 0).length;
  const page = 1;
  const companies = getCaseStudiesPage(page);

  return (
    <PageShell max="max-w-5xl">
      <BackLink href="/explore">back to explore</BackLink>
      <HeroHeader eyebrow="generated artifact" title="Company universe" size="md">
        Startups backed by YC, Antler, a16z, or Techstars. Every row retains first-party source
        evidence and includes deterministic competitor mappings.
      </HeroHeader>

      <StatGrid
        items={[
          ...FLOW,
          {
            label: 'coverage',
            value: withCompetitors.toLocaleString(),
            sub: 'Companies with mapped competitors.',
          },
          {
            label: 'last updated',
            value: COMPANY_UNIVERSE_LAST_UPDATED.slice(0, 10),
            sub: `${COMPANY_UNIVERSE_LAST_UPDATED.slice(11, 16)} UTC`,
          },
        ]}
      />

      <CompanySearchForm
        companyCount={COMPANY_UNIVERSE.companyCount}
        lastUpdatedAt={COMPANY_UNIVERSE_LAST_UPDATED}
      />

      <Panel eyebrow="source boundary" title="Four first-party directories">
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--color-muted)]">
          Generated at {COMPANY_UNIVERSE.generatedAt.slice(0, 16).replace('T', ' ')} UTC by{' '}
          <code>{COMPANY_UNIVERSE.generatedBy}</code>. Source inputs:{' '}
          {COMPANY_UNIVERSE.sourceInputs.map((source) => source.label).join(', ')}. Competitors are
          mapped by: {COMPANY_UNIVERSE.competitorMapping.method}. The same generated run is synced
          into D1 for API/search reads; this static artifact keeps the SEO pages crawlable.
          {COMPANY_UNIVERSE.entityExtraction && (
            <>
              {' '}
              The manual GLiNER pass extracted{' '}
              {COMPANY_UNIVERSE.entityExtraction.entityCount.toLocaleString()} product facets from{' '}
              {COMPANY_UNIVERSE.entityExtraction.enrichedCompanyCount.toLocaleString()} companies at{' '}
              {COMPANY_UNIVERSE.entityExtraction.generatedAt.slice(0, 19).replace('T', ' ')} UTC.
            </>
          )}
        </p>
        <CompanyLookupForm />
      </Panel>

      <CompanyUniverseList companies={companies} page={page} />
    </PageShell>
  );
}
