'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useTransition } from 'react';
import { companySearchHref } from '../company-search-url';

interface CompanySearchPaginationProps {
  page: number;
  query: string;
  totalPages: number;
}

export function CompanySearchPagination({ page, query, totalPages }: CompanySearchPaginationProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pages = pageWindow(page, totalPages);
  const lastPageInWindow = pages.at(-1) ?? 1;

  if (totalPages <= 1) return null;

  function navigate(event: MouseEvent<HTMLAnchorElement>, nextPage: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (isPending) return;
    startTransition(() => router.push(companySearchHref(query, nextPage) as Route));
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <nav
        className="flex flex-wrap items-center gap-2"
        aria-label="Company search pagination"
        aria-busy={isPending}
      >
        {page > 1 && (
          <PageLink
            page={page - 1}
            query={query}
            label="prev"
            pending={isPending}
            onNavigate={navigate}
          />
        )}
        {(pages[0] ?? 1) > 1 && (
          <>
            <PageLink page={1} query={query} pending={isPending} onNavigate={navigate} />
            <span className="font-mono text-[10px] text-zinc-600">...</span>
          </>
        )}
        {pages.map((item) => (
          <PageLink
            key={item}
            page={item}
            query={query}
            active={item === page}
            pending={isPending}
            onNavigate={navigate}
          />
        ))}
        {lastPageInWindow < totalPages && (
          <>
            <span className="font-mono text-[10px] text-zinc-600">...</span>
            <PageLink page={totalPages} query={query} pending={isPending} onNavigate={navigate} />
          </>
        )}
        {page < totalPages && (
          <PageLink
            page={page + 1}
            query={query}
            label="next"
            pending={isPending}
            onNavigate={navigate}
          />
        )}
      </nav>
      <span
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500"
        role="status"
        aria-live="polite"
      >
        {isPending ? 'loading matches...' : `page ${page} of ${totalPages}`}
      </span>
    </div>
  );
}

function PageLink({
  page,
  query,
  active = false,
  label,
  pending,
  onNavigate,
}: {
  page: number;
  query: string;
  active?: boolean;
  label?: string;
  pending: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, page: number) => void;
}) {
  return (
    <Link
      href={companySearchHref(query, page) as Route}
      onClick={(event) => onNavigate(event, page)}
      aria-current={active ? 'page' : undefined}
      aria-disabled={pending || undefined}
      className={
        active
          ? 'border border-[var(--color-accent)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]'
          : 'border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition hover:border-zinc-600 aria-disabled:cursor-wait aria-disabled:opacity-50'
      }
    >
      {label ?? page}
    </Link>
  );
}

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
