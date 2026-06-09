"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

const PRIMARY: NavLink[] = [
  { href: "/", label: "brief", match: (p) => p === "/" || p.startsWith("/brief") },
  { href: "/track-record", label: "track record", match: (p) => p.startsWith("/track-record") },
];

const LENSES: NavLink[] = [
  { href: "/markets", label: "markets", match: (p) => p.startsWith("/markets") || p.startsWith("/signals") || p.startsWith("/entities") || p.startsWith("/sectors") || p.startsWith("/watchlist") },
  { href: "/mentions", label: "mentions", match: (p) => p.startsWith("/mentions") },
  { href: "/agent-eval", label: "agent eval", match: (p) => p.startsWith("/agent-eval") },
];

const OPS: NavLink[] = [
  { href: "/review", label: "review", match: (p) => p.startsWith("/review") },
];

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3 sm:px-6">
        <Link
          href={"/" as Route}
          className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-fg)] hover:text-[var(--color-accent)]"
        >
          <span className="size-1.5 mr-2 inline-block rounded-full bg-[var(--color-accent)] align-middle" />
          high signal
        </Link>
        <ul className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em]">
          {PRIMARY.map((link) => {
            const active = link.match(pathname);
            return (
              <li key={link.href}>
                <Link
                  href={link.href as Route}
                  className={
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
          <li
            className="hidden text-[var(--color-muted)] sm:inline"
            aria-hidden
          >
            lenses:
          </li>
          {LENSES.map((link) => {
            const active = link.match(pathname);
            return (
              <li key={link.href}>
                <Link
                  href={link.href as Route}
                  className={
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
          {OPS.map((link) => {
            const active = link.match(pathname);
            return (
              <li key={link.href} className="ml-auto hidden min-[1380px]:list-item">
                <Link
                  href={link.href as Route}
                  className={
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
