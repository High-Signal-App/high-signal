import type { Route } from 'next';
import Link from 'next/link';
import { getSimilarCompanyCluster } from './company-search';
import {
  CASE_STUDIES,
  CASE_STUDIES_PAGE_SIZE,
  CASE_STUDIES_TOTAL_PAGES,
  caseStudiesPageHref,
  type UniverseCompany,
} from './data';
import { CompanyUniverseTable } from './CompanyUniverseTable';

interface CompanyUniverseListProps {
  companies: UniverseCompany[];
  page: number;
  paginated?: boolean;
  summary?: string;
}

export function CompanyUniverseList({
  companies,
  page,
  paginated = true,
  summary,
}: CompanyUniverseListProps) {
  const start = (page - 1) * CASE_STUDIES_PAGE_SIZE + 1;
  const end = start + companies.length - 1;
  const peerNamesBySlug = Object.fromEntries(
    companies.map((company) => [
      company.slug,
      getSimilarCompanyCluster(CASE_STUDIES, company, 3).map((peer) => peer.company.name),
    ])
  );

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {summary ?? (
            <>
              showing {start.toLocaleString()}-{end.toLocaleString()} · page {page} of{' '}
              {CASE_STUDIES_TOTAL_PAGES}
            </>
          )}
        </div>
        {paginated && <Pagination page={page} />}
      </div>

      <CompanyUniverseTable companies={companies} peerNamesBySlug={peerNamesBySlug} />

      {paginated && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Pagination page={page} />
        </div>
      )}
    </section>
  );
}

function Pagination({ page }: { page: number }) {
  const pages = pageWindow(page);
  const lastPageInWindow = pages[pages.length - 1] ?? 1;
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Company universe pagination">
      {page > 1 && <PageLink page={page - 1} label="prev" />}
      {pages[0] > 1 && (
        <>
          <PageLink page={1} />
          <span className="font-mono text-[10px] text-zinc-600">...</span>
        </>
      )}
      {pages.map((item) => (
        <PageLink key={item} page={item} active={item === page} />
      ))}
      {lastPageInWindow < CASE_STUDIES_TOTAL_PAGES && (
        <>
          <span className="font-mono text-[10px] text-zinc-600">...</span>
          <PageLink page={CASE_STUDIES_TOTAL_PAGES} />
        </>
      )}
      {page < CASE_STUDIES_TOTAL_PAGES && <PageLink page={page + 1} label="next" />}
    </nav>
  );
}

function PageLink({
  page,
  active = false,
  label,
}: {
  page: number;
  active?: boolean;
  label?: string;
}) {
  return (
    <Link
      href={caseStudiesPageHref(page) as Route}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'border border-[var(--color-accent)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]'
          : 'border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition hover:border-zinc-600'
      }
    >
      {label ?? page}
    </Link>
  );
}

function pageWindow(page: number) {
  const start = Math.max(1, page - 2);
  const end = Math.min(CASE_STUDIES_TOTAL_PAGES, page + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
