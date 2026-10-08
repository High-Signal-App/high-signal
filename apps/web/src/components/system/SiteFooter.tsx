import Link from 'next/link';
import type { Route } from 'next';
import { createElement } from 'react';

import { SITE_URL } from '@/lib/site';
import { APP_HEALTH_LIVE_URL } from '@/lib/app-health-public';

interface FooterLink {
  href: string;
  label: string;
}

const READ: FooterLink[] = [
  { href: '/', label: 'Brief' },
  { href: '/signals', label: 'Signals' },
  { href: '/track-record', label: 'Track record' },
  { href: '/articles', label: 'Articles' },
];

const VERIFY: FooterLink[] = [
  { href: '/data', label: 'Sources' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/editorial-policy', label: 'Editorial policy' },
];

const PROJECT: FooterLink[] = [
  { href: '/about', label: 'About' },
  { href: '/api-docs', label: 'API & feeds' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export function SiteFooter() {
  return createElement(
    'fleet-footer-extension',
    {
      'data-fleet-footer-project': 'high-signal',
      'product-name': 'High Signal',
      surface: 'app',
      theme: 'dark',
      'font-base': '/fonts/fleet-footer-precise-v1/',
      'art-src': '/footer-art/high-signal.webp',
      'art-alt':
        'A signal-watch desk centers one daily sheet whose physical source ribbons remain visible. Scattered public-source slips pass through a narrow sorting aperture; a restrained tuning instrument and loose paper occupy the wings.',
      'art-width': '2171',
      'art-height': '724',
      'art-position': '50% 50%',
      'art-credit': 'Original illustration for High Signal',
    },
    <>
      {createElement('saas-maker-newsletter-capture', {
        slot: 'capture',
        'catalog-id': 'high-signal',
        'product-name': 'High Signal',
        kind: 'newsletter',
        layout: 'compact',
        integrated: '',
        source: 'footer',
        'privacy-url': 'https://highsignal.app/privacy',
      })}
      <FooterContent />
    </>
  );
}

function FooterContent() {
  const year = new Date().getFullYear();
  return (
    <footer
      slot="navigation"
      data-fleet-footer-navigation
      className="border-t border-[var(--color-line)]"
    >
      <div className="pt-4 pb-0">
        <p className="hs-footer-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          Every signal cites ≥ 2 sources. Hit-rate tracked from day one.
          <span className="mx-3 opacity-30">—</span>
          <a
            href="/track-record"
            data-app-health-event="track_record.opened"
            className="hover:text-[var(--color-fg)]"
          >
            See the ledger →
          </a>
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-[var(--color-muted)]">
          One free, public Daily Brief across technology, startups, and finance. Read the change,
          inspect its proof, then check the outcome.
        </p>
      </div>
      <div className="py-4">
        <nav
          aria-label="Footer navigation"
          className="hs-footer-navigation grid grid-cols-2 gap-8 sm:grid-cols-3"
        >
          <FooterColumn title="Read" links={READ} />
          <FooterColumn title="Verify" links={VERIFY} />
          <FooterColumn title="Project" links={PROJECT} />
        </nav>
      </div>
      <FooterUtilityLinks year={year} />
    </footer>
  );
}

function FooterUtilityLinks({ year }: { year: number }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] pt-4 hs-footer-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
      <span>© {year} High Signal</span>
      <nav
        aria-label="Project links"
        className="hs-footer-navigation flex flex-wrap items-center gap-x-5 gap-y-2"
      >
        <a
          href={APP_HEALTH_LIVE_URL}
          referrerPolicy="no-referrer"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center hover:text-[var(--color-fg)]"
        >
          Live analytics
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
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
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
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <div className="hs-footer-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
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
