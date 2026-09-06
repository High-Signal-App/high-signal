import type { Metadata } from 'next';

import { BackLink, HeroHeader, PageShell } from '@/components/system/HighSignalUI';
import { SITE_URL } from '@/lib/site';

const entries = [
  {
    date: '2026-07-25',
    title: 'A clearer, product-owned intelligence loop',
    outcomes: [
      'Daily Brief publishing was verified across twelve consecutive days, with a populated five-section brief and 25–33 publishable signals per day in the latest audited window.',
      'AI visibility analysis now uses the shared Fleet evaluation package while High Signal continues to own its sources, evidence, schedules, reports, and customer experience.',
    ],
  },
  {
    date: '2026-07-15',
    title: '12,964 source-backed company profiles',
    outcomes: [
      'The company universe now draws only from official YC, Antler, a16z, and Techstars directories and preserves first-party evidence for every company.',
      'Search, filters, company pages, and reciprocal competitor links make the directory useful without hiding how each result was assembled.',
    ],
  },
  {
    date: '2026-07-13',
    title: 'Delivery, watchlists, and mention reports became dependable',
    outcomes: [
      'Private RSS, Atom, and compact JSON brief feeds joined retryable email delivery, with owner-scoped failure recovery and explicit retry timing.',
      'Watched entities now influence signed-in briefs through evidence-backed direct and spillover impacts, while mention reports support controlled sharing.',
    ],
  },
  {
    date: '2026-07-09',
    title: 'A public library of company case studies',
    outcomes: [
      'High Signal added browsable, searchable company profiles with source evidence, competitor context, and stable pages that can be cited and shared.',
    ],
  },
] as const;

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/changelog` },
  title: 'Changelog',
  description: 'Verified, user-visible improvements shipped by High Signal.',
};

export default function ChangelogPage() {
  return (
    <PageShell max="max-w-4xl">
      <BackLink />
      <HeroHeader eyebrow="product changelog" title="What changed">
        A concise record of shipped improvements. Future work lives in GitHub Issues; this page
        covers verified product outcomes only.
      </HeroHeader>

      <div className="divide-y divide-[var(--color-line)] border-b border-[var(--color-line)]">
        {entries.map((entry) => (
          <article
            key={`${entry.date}-${entry.title}`}
            className="grid gap-4 py-8 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-8"
          >
            <time
              dateTime={entry.date}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]"
            >
              {entry.date}
            </time>
            <div>
              <h2 className="text-xl font-medium tracking-tight text-[var(--color-fg)]">
                {entry.title}
              </h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--color-muted)]">
                {entry.outcomes.map((outcome) => (
                  <li key={outcome} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1 shrink-0 bg-[var(--color-accent)]"
                    />
                    <span>{outcome}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <nav
        aria-label="Project links"
        className="mt-8 flex flex-wrap gap-x-6 gap-y-3 font-mono text-[11px] uppercase tracking-[0.14em]"
      >
        <a
          href="https://github.com/High-Signal-App/high-signal/issues"
          className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          Roadmap ↗
        </a>
        <a
          href="https://github.com/High-Signal-App/high-signal"
          aria-label="GitHub repository"
          title="GitHub repository"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          <span className="sr-only">GitHub repository</span>
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </nav>
    </PageShell>
  );
}
