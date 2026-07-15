import type { Route } from 'next';
import Link from 'next/link';
import {
  CASE_STUDIES_PAGE_SIZE,
  CASE_STUDIES_TOTAL_PAGES,
  caseStudiesPageHref,
  type UniverseCompany,
} from './data';

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

      <div className="overflow-x-auto border border-[var(--color-line)]">
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.7fr)_minmax(12rem,1.1fr)_minmax(14rem,1.4fr)] border-b border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            <div>company</div>
            <div>category</div>
            <div>source</div>
            <div>similar companies</div>
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {companies.map((item) => (
              <Link
                key={item.slug}
                href={`/case-studies/${item.slug}` as Route}
                className="grid grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.7fr)_minmax(12rem,1.1fr)_minmax(14rem,1.4fr)] gap-3 px-3 py-3 text-sm transition hover:bg-zinc-950"
              >
                <div>
                  <div className="font-medium text-zinc-100">{item.name}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-zinc-500">
                    {item.description || 'source-backed company entry'}
                  </div>
                </div>
                <div className="text-zinc-400">{item.category}</div>
                <div className="text-zinc-500">{item.investors.join(', ')}</div>
                <div className="text-zinc-400">
                  {item.competitors
                    .slice(0, 3)
                    .map(({ name }) => name)
                    .join(', ')}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

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
