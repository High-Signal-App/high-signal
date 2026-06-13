import Link from "next/link";
import type { Route } from "next";

import { SITE_URL } from "@/lib/site";

interface FooterLink {
  href: string;
  label: string;
}

const PRODUCT: FooterLink[] = [
  { href: "/", label: "Brief" },
  { href: "/signals", label: "Signals" },
  { href: "/track-record", label: "Track record" },
  { href: "/watchlist/entities", label: "Watched entities" },
];

const LENSES: FooterLink[] = [
  { href: "/markets", label: "Markets" },
  { href: "/mentions", label: "Mentions" },
  { href: "/agent-eval", label: "Agent Eval" },
  { href: "/domains", label: "Domains" },
  { href: "/communities", label: "Communities" },
  { href: "/lab", label: "Lab" },
];

const OPERATOR: FooterLink[] = [
  { href: "/review", label: "Review queue" },
  { href: "/settings/delivery", label: "Delivery preferences" },
  { href: "/explore", label: "Explore all features" },
  { href: "/api-docs", label: "API docs" },
];

const LEGAL: FooterLink[] = [
  { href: "/about", label: "About" },
  { href: "/methodology", label: "Methodology" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-[var(--color-line)]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <FooterColumn title="Product" links={PRODUCT} />
          <FooterColumn title="Lenses" links={LENSES} />
          <FooterColumn title="Operator" links={OPERATOR} />
          <FooterColumn title="Legal" links={LEGAL} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] pt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <span>© {year} High Signal</span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="https://sarthakagrawal.dev" className="hover:text-[var(--color-fg)]">
              Sarthak
            </a>
            <a href="https://sassmaker.com" className="hover:text-[var(--color-fg)]">
              Foundry
            </a>
            <a href={`${SITE_URL}/signals/rss`} className="hover:text-[var(--color-fg)]">
              Signals RSS
            </a>
            <a href={`${SITE_URL}/digest/rss`} className="hover:text-[var(--color-fg)]">
              Digest RSS
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
      <ul className="mt-3 space-y-1.5 text-xs">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href as Route}
              className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
