'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { useTransition } from 'react';
import { companySearchHref } from './company-search-url';

interface CompanySearchFormProps {
  companyCount: number;
  defaultQuery?: string;
  lastUpdatedAt: string;
}

export function CompanySearchForm({
  companyCount,
  defaultQuery = '',
  lastUpdatedAt,
}: CompanySearchFormProps) {
  const updatedAt = lastUpdatedAt.slice(0, 19).replace('T', ' ');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    if (!event.currentTarget.reportValidity()) return;
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('q') ?? '');
    startTransition(() => router.push(companySearchHref(query) as Route));
  }

  return (
    <section className="mt-8 border border-[var(--color-line)] p-4" aria-label="Search companies">
      <form
        action="/case-studies/search"
        method="get"
        onSubmit={submitSearch}
        aria-busy={isPending}
      >
        <label htmlFor="company-universe-query" className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            search {companyCount.toLocaleString()} companies
          </span>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              id="company-universe-query"
              name="q"
              type="search"
              defaultValue={defaultQuery}
              minLength={2}
              required
              placeholder="AI workflow for finance, climate batteries, Acme Health…"
              className="h-11 w-full border border-[var(--color-line)] bg-transparent px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[var(--color-accent)]"
            />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 border border-[var(--color-accent)] px-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black disabled:cursor-wait disabled:bg-[var(--color-accent)] disabled:text-black"
            >
              {isPending ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="size-3.5" aria-hidden="true" />
              )}
              {isPending ? 'searching' : 'search'}
            </button>
          </div>
        </label>
        <span className="sr-only" role="status" aria-live="polite">
          {isPending ? 'Searching companies' : ''}
        </span>
      </form>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
        manually refreshed snapshot · last updated {updatedAt} UTC
      </p>
    </section>
  );
}
