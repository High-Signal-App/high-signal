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
    label: 'brief',
    match: (path) => path === '/' || path.startsWith('/brief'),
  },
  {
    href: '/signals',
    label: 'signals',
    match: (path) => path.startsWith('/signals'),
  },
  {
    href: '/data',
    label: 'sources',
    match: (path) => path === '/data' || path.startsWith('/data/'),
  },
  {
    href: '/track-record',
    label: 'track record',
    match: (path) => path.startsWith('/track-record') || path.startsWith('/backtest-workbench'),
  },
];

const linkBase =
  'inline-flex min-h-11 items-center whitespace-nowrap border-b px-1.5 font-mono text-[9px] uppercase tracking-[0.04em] transition-colors duration-150 sm:px-2 sm:text-[11px] sm:tracking-[0.08em]';

export function PrimaryNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="fixed inset-x-0 top-0 z-50 h-14 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-1.5 sm:gap-5 sm:px-6">
        <Link
          href={'/' as Route}
          prefetch={false}
          className="inline-flex min-h-11 shrink-0 items-center font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg)] transition-colors duration-150 hover:text-[var(--color-accent)] sm:text-[11px] sm:tracking-[0.12em]"
        >
          <span className="mr-2 inline-block size-1 rounded-full bg-[var(--color-accent)] align-middle" />
          <span className="sm:hidden">HS</span>
          <span className="hidden sm:inline">high signal</span>
        </Link>

        <ul className="flex flex-1 items-center justify-between gap-x-0 sm:justify-start sm:gap-x-1">
          {PRIMARY_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  prefetch={false}
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
