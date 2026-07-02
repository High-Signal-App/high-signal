'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

const PRIMARY_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'home',
    match: (path) => path === '/' || path.startsWith('/dashboard') || path.startsWith('/brief'),
  },
  {
    href: '/data',
    label: 'data',
    match: (path) =>
      path.startsWith('/data') ||
      path.startsWith('/daily/sources') ||
      path.startsWith('/entities') ||
      path.startsWith('/convergence') ||
      path.startsWith('/markets') ||
      path.startsWith('/equities') ||
      path.startsWith('/communities') ||
      path.startsWith('/unmapped'),
  },
  {
    href: '/signals',
    label: 'signals',
    match: (path) =>
      path.startsWith('/signals') ||
      path === '/daily' ||
      path.startsWith('/watchlist') ||
      path.startsWith('/opportunities') ||
      path.startsWith('/review'),
  },
  {
    href: '/daily/history',
    label: 'history',
    match: (path) =>
      path.startsWith('/daily/history') ||
      path.startsWith('/track-record') ||
      path.startsWith('/backtest-workbench'),
  },
  {
    href: '/agent-eval',
    label: 'evals',
    match: (path) =>
      path.startsWith('/agent-eval') || path.startsWith('/mentions') || path.startsWith('/domains'),
  },
];

const SECONDARY_ITEMS: NavItem[] = [
  {
    href: '/explore',
    label: 'explore',
    match: (path) => path.startsWith('/explore'),
  },
  {
    href: '/settings/delivery',
    label: 'settings',
    match: (path) => path.startsWith('/settings'),
  },
];

const linkBase =
  'whitespace-nowrap border-b px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150';

export function PrimaryNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-2.5 sm:px-6">
        <Link
          href={'/' as Route}
          className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg)] transition-colors duration-150 hover:text-[var(--color-accent)]"
        >
          <span className="mr-2 inline-block size-1 rounded-full bg-[var(--color-accent)] align-middle" />
          high signal
        </Link>

        <ul className="flex flex-1 items-center gap-x-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PRIMARY_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  className={`${linkBase} ${
                    active
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <ul className="hidden shrink-0 items-center gap-x-3 md:flex">
          {SECONDARY_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  className={`${linkBase} ${
                    active
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
