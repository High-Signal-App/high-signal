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
          className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          Source ↗
        </a>
      </nav>
    </PageShell>
  );
}
