import Link from 'next/link';
import type { Route } from 'next';

import { ArticleJsonLd, BreadcrumbJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import { MarkdownView } from '@/components/system/MarkdownView';
import { ReadableMutedTheme } from '@/components/content/ReadableMutedTheme';
import type { Article } from '@/data/articles';

export function ArticlePage({ article }: { article: Article }) {
  return (
    <>
      <ReadableMutedTheme />
      <PageShell max="max-w-4xl">
        <BreadcrumbJsonLd
          trail={[
            { name: 'Home', path: '/' },
            { name: 'Articles', path: '/articles' },
            { name: article.title, path: article.path },
          ]}
        />
        <ArticleJsonLd article={article} />

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
          <Link
            className="min-h-11 py-3 hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            href={'/articles' as Route}
          >
            Articles
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="py-3 text-[var(--color-fg)]">
            {article.eyebrow}
          </span>
        </nav>

        <article className="mt-8">
          <header className="border-b border-[var(--color-line)] pb-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              {article.eyebrow}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-medium tracking-[-0.025em] text-[var(--color-fg)] sm:text-5xl">
              {article.title}
            </h1>
            <p className="mt-5 max-w-[72ch] text-base leading-7 text-[var(--color-muted)]">
              {article.metaDescription}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
              published {article.publishedAt}
            </p>
          </header>

          <div className="mt-10">
            <MarkdownView markdown={article.bodyMd} />
          </div>

          <section className="mt-12" aria-labelledby={`${article.slug}-research-path`}>
            <h2
              id={`${article.slug}-research-path`}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
            >
              continue the research
            </h2>
            <nav className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {article.related.map((link) => (
                <Link
                  key={link.href}
                  href={link.href as Route}
                  className="group grid gap-2 py-4 transition-colors hover:bg-white/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1fr)] sm:items-baseline"
                >
                  <span className="font-medium text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
                    {link.title}
                  </span>
                  <span className="text-sm leading-6 text-[var(--color-muted)] sm:text-right">
                    {link.description}
                  </span>
                </Link>
              ))}
            </nav>
          </section>

          <footer className="mt-12 border border-[var(--color-line)] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              next step
            </p>
            <Link
              href={article.cta.href as Route}
              className="mt-4 inline-block text-2xl font-medium tracking-tight text-[var(--color-fg)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              {article.cta.title} →
            </Link>
            <p className="mt-3 max-w-[72ch] text-sm leading-6 text-[var(--color-muted)]">
              {article.cta.description}
            </p>
          </footer>
        </article>
      </PageShell>
    </>
  );
}
