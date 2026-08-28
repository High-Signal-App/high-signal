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
              className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
            >
              Source
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
