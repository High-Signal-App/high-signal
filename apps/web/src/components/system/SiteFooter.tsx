import Link from 'next/link';
import type { Route } from 'next';

import { SITE_URL } from '@/lib/site';

interface FooterLink {
  href: string;
  label: string;
}

const PRODUCT: FooterLink[] = [
  { href: '/', label: 'Brief' },
  { href: '/signals', label: 'Signals' },
  { href: '/data', label: 'Sources' },
  { href: '/case-studies', label: 'Company Universe' },
  { href: '/track-record', label: 'Track record' },
];

const RESEARCH: FooterLink[] = [
  { href: '/markets', label: 'Markets' },
  { href: '/entities', label: 'Entities' },
  { href: '/sectors', label: 'Sectors' },
  { href: '/convergence', label: 'Convergence' },
];

const OPERATOR: FooterLink[] = [
  { href: '/review', label: 'Review queue' },
  { href: '/explore', label: 'Explore all features' },
  { href: '/api-docs', label: 'API docs' },
];

const LEGAL: FooterLink[] = [
  { href: '/about', label: 'About' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/methodology/data-parity', label: 'Data parity' },
  { href: '/editorial-policy', label: 'Editorial policy' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-[var(--color-line)]">
      <div className="mx-auto max-w-5xl px-6 pt-10 pb-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          Every signal cites ≥ 2 sources. Hit-rate tracked from day one.
          <span className="mx-3 opacity-30">—</span>
          <a href="/track-record" className="hover:text-[var(--color-fg)]">
            See the ledger →
          </a>
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-[var(--color-muted)]">
          A free, public Daily Brief across technology, startups, and finance. No reader account,
          paid tier, or personalization; when evidence does not clear the bar, a section stays
          empty.
        </p>
      </div>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <FooterColumn title="Product" links={PRODUCT} />
          <FooterColumn title="Research" links={RESEARCH} />
          <FooterColumn title="Operator" links={OPERATOR} />
          <FooterColumn title="Legal" links={LEGAL} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] pt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <span>© {year} High Signal</span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="https://sarthakagrawal.dev"
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              Sarthak
            </a>
            <a
              href="https://sassmaker.com"
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              Foundry
            </a>
            <a
              href="https://github.com/High-Signal-App/high-signal/issues"
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              Roadmap
            </a>
            <a
              href="https://github.com/High-Signal-App/high-signal"
              aria-label="GitHub repository"
              title="GitHub repository"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              <span className="sr-only">GitHub repository</span>
              <svg
                viewBox="0 0 16 16"
                width="20"
                height="20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
            <a
              href={`${SITE_URL}/signals/rss`}
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              Signals RSS
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
        {title}
      </div>
      <ul className="mt-2 text-xs">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href as Route}
              prefetch={false}
              className="inline-flex min-h-11 items-center text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
