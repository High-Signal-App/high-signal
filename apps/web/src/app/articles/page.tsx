import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';

import { ReadableMutedTheme } from '@/components/content/ReadableMutedTheme';
import { BreadcrumbJsonLd } from '@/components/seo/structured-data';
import { PageShell, SectionHeader } from '@/components/system/HighSignalUI';
import { ARTICLES } from '@/data/articles';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Articles — evidence-first research practice',
  description:
    'Long-form High Signal articles on evidence standards, source mix, spillover mapping, signal memory, and the design of an accountable daily brief.',
  alternates: { canonical: `${SITE_URL}/articles` },
};

export default function ArticlesPage() {
  return (
    <>
      <ReadableMutedTheme />
      <PageShell max="max-w-4xl">
        <BreadcrumbJsonLd
          trail={[
            { name: 'Home', path: '/' },
            { name: 'Articles', path: '/articles' },
          ]}
        />

        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]"
        >
          <Link
            className="min-h-11 py-3 hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            href="/"
          >
            High Signal
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="py-3 text-[var(--color-fg)]">
            articles
          </span>
        </nav>

        <SectionHeader eyebrow="articles" title="Research practice, in long form">
          How the evidence-first model behind the Daily Brief works: source mix, corroboration
          gates, spillover mapping, versioned signal memory, and the public ledger that keeps every
          claim accountable.
        </SectionHeader>

        <div className="mt-8 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {ARTICLES.map((article) => (
            <Link
              key={article.slug}
              href={article.path as Route}
              className="group grid gap-2 py-6 transition-colors hover:bg-white/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10"
            >
              <span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  {article.eyebrow}
                </span>
                <span className="mt-2 block text-lg font-medium tracking-tight text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
                  {article.title}
                </span>
              </span>
              <span className="text-sm leading-6 text-[var(--color-muted)]">
                {article.metaDescription}
              </span>
            </Link>
          ))}
        </div>
      </PageShell>
    </>
  );
}
