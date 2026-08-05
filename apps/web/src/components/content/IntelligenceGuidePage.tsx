import Link from 'next/link';
import type { Route } from 'next';

import { BreadcrumbJsonLd, IntelligenceGuideJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import type { IntelligenceGuide } from '@/data/intelligence-guides';
import { ReadableMutedTheme } from '@/components/content/ReadableMutedTheme';

export function IntelligenceGuidePage({ guide }: { guide: IntelligenceGuide }) {
  return (
    <>
      <ReadableMutedTheme />
      <PageShell max="max-w-4xl">
        <BreadcrumbJsonLd
          trail={[
            { name: 'Home', path: '/' },
            { name: 'Intelligence guides', path: '/explore' },
            { name: guide.title, path: guide.slug },
          ]}
        />
        <IntelligenceGuideJsonLd guide={guide} />

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
            href="/explore"
          >
            Intelligence guides
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="py-3 text-[var(--color-fg)]">
            {guide.eyebrow}
          </span>
        </nav>

        <article className="mt-8">
          <header className="border-b border-[var(--color-line)] pb-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              {guide.eyebrow}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-medium tracking-[-0.025em] text-[var(--color-fg)] sm:text-5xl">
              {guide.title}
            </h1>
            <p className="mt-5 max-w-[72ch] text-base leading-7 text-[var(--color-muted)]">
              {guide.summary}
            </p>
          </header>

          <section
            className="mt-8 border-y border-[var(--color-line)]"
            aria-labelledby={`${guide.key}-evidence`}
          >
            <div className="grid gap-2 py-4 sm:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.6fr)] sm:gap-10">
              <h2
                id={`${guide.key}-evidence`}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
              >
                evidence receipt
              </h2>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Public facts used on this page. Open any row to inspect the corresponding High
                Signal surface.
              </p>
            </div>
            <div className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
              {guide.evidence.map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href as Route}
                  className="group grid gap-2 py-4 transition-colors hover:bg-white/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.25fr)_auto] sm:items-baseline sm:gap-6"
                >
                  <span className="font-medium text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
                    {item.label}
                  </span>
                  <span className="text-sm leading-6 text-[var(--color-muted)]">{item.detail}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    verified {item.verifiedAt}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <div className="divide-y divide-[var(--color-line)] border-b border-[var(--color-line)]">
            {guide.sections.map((section) => (
              <section
                key={section.title}
                className="grid gap-4 py-8 md:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.6fr)] md:gap-10"
              >
                <h2 className="text-xl font-medium tracking-tight text-[var(--color-fg)]">
                  {section.title}
                </h2>
                <div className="space-y-4">
                  {section.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="max-w-[72ch] text-sm leading-7 text-[var(--color-muted)]"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="mt-12" aria-labelledby={`${guide.key}-research-path`}>
            <h2
              id={`${guide.key}-research-path`}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
            >
              continue the research
            </h2>
            <nav className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {guide.related.map((link) => (
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
              href={guide.cta.href as Route}
              className="mt-4 inline-block text-2xl font-medium tracking-tight text-[var(--color-fg)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              {guide.cta.title} →
            </Link>
            <p className="mt-3 max-w-[72ch] text-sm leading-6 text-[var(--color-muted)]">
              {guide.cta.description}
            </p>
          </footer>
        </article>
      </PageShell>
    </>
  );
}
