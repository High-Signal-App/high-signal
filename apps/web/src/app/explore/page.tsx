import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';

import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/explore` },
  title: 'Explore High Signal',
  description:
    'The core High Signal reading path: the Daily Brief, signals and their proof, sources, companies, and the public track record.',
};

interface Surface {
  href: string;
  label: string;
  note: string;
}

interface Group {
  title: string;
  blurb: string;
  surfaces: Surface[];
}

const GROUPS: Group[] = [
  {
    title: 'Start here',
    blurb: 'Read the change, inspect its proof, then check how similar calls performed.',
    surfaces: [
      {
        href: '/',
        label: 'Daily Brief',
        note: "Today's and yesterday's evidence-qualified editions.",
      },
      {
        href: '/signals',
        label: 'Signals',
        note: 'The chronological record and detailed proof pages.',
      },
      {
        href: '/data',
        label: 'Sources',
        note: 'Every configured data source, its cadence, health, and latest retained data.',
      },
      {
        href: '/case-studies',
        label: 'Company Universe',
        note: 'Source-backed companies from official accelerator and investor directories.',
      },
      {
        href: '/track-record',
        label: 'Track Record',
        note: 'The public ledger of matured directional calls.',
      },
    ],
  },
  {
    title: 'Research indexes',
    blurb: 'Supporting ways to follow entities and market context behind the brief.',
    surfaces: [
      { href: '/entities', label: 'Entities', note: 'Companies, products, and relationships.' },
      { href: '/sectors', label: 'Sectors', note: 'Signals and outcomes grouped by sector.' },
      { href: '/markets', label: 'Markets', note: 'Market context used by the brief.' },
      {
        href: '/convergence',
        label: 'Convergence',
        note: 'Entities appearing across several source classes.',
      },
      {
        href: '/unmapped',
        label: 'Unmapped entities',
        note: 'New names observed before graph resolution.',
      },
    ],
  },
  {
    title: 'How it works',
    blurb: 'Product scope, evidence rules, public APIs, and policies.',
    surfaces: [
      { href: '/about', label: 'About', note: 'What High Signal is and is not.' },
      {
        href: '/methodology',
        label: 'Methodology',
        note: 'How evidence becomes a published signal.',
      },
      {
        href: '/editorial-policy',
        label: 'Editorial policy',
        note: 'Independence, corrections, inference, and publication rules.',
      },
      { href: '/api-docs', label: 'API & feeds', note: 'Daily data and signal feeds.' },
      { href: '/privacy', label: 'Privacy', note: 'Reader and operator privacy.' },
      { href: '/terms', label: 'Terms', note: 'Research-use terms.' },
    ],
  },
];

export default function ExplorePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
      >
        ← high signal
      </Link>
      <header className="mt-3 border-b border-[var(--color-line)] pb-7">
        <h1 className="text-3xl font-medium tracking-tight">Explore High Signal</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
          One brief, a chronological signal record, and the evidence needed to verify it. The
          supporting indexes help you investigate without becoming separate products.
        </p>
      </header>

      <div className="mt-10 space-y-12">
        {GROUPS.map((group) => {
          const headingId = `explore-${group.title.toLowerCase().replaceAll(' ', '-')}`;
          return (
            <section key={group.title} aria-labelledby={headingId}>
              <h2 id={headingId} className="text-lg font-medium text-[var(--color-fg)]">
                {group.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                {group.blurb}
              </p>
              <ul className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
                {group.surfaces.map((surface) => (
                  <li key={surface.href}>
                    <Link
                      href={surface.href as Route}
                      prefetch={false}
                      className="group grid min-h-16 gap-1 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)] sm:grid-cols-[12rem_1fr] sm:items-baseline sm:gap-6"
                    >
                      <span className="text-sm font-medium text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
                        {surface.label} <span aria-hidden="true">→</span>
                      </span>
                      <span className="max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                        {surface.note}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
