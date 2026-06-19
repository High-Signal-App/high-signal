"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

interface NavLeaf {
  href: string;
  label: string;
  hint?: string;
}

interface NavProduct {
  /** Primary destination for the product (its overview). */
  href: string;
  label: string;
  /** Sub-features revealed when the item is expanded. */
  items: NavLeaf[];
  /** Whether a given pathname belongs to this product. */
  match: (path: string) => boolean;
}

// Top-level products (the navbar). Grouped per the locked product direction in
// agents.md: Brief + Track Record are the core; the rest are the lenses that
// feed it. Each product expands to reveal its sub-features.
const PRODUCTS: NavProduct[] = [
  {
    href: "/",
    label: "brief",
    match: (p) => p === "/" || p.startsWith("/brief") || p.startsWith("/daily") || p.startsWith("/personal"),
    items: [
      { href: "/", label: "daily brief", hint: "today’s synthesized brief" },
      { href: "/daily", label: "daily sources", hint: "what fed the brief" },
      { href: "/personal", label: "personal", hint: "operator intelligence" },
    ],
  },
  {
    href: "/track-record",
    label: "track record",
    match: (p) => p.startsWith("/track-record"),
    items: [
      { href: "/track-record", label: "overview", hint: "public hit-rate ledger" },
      { href: "/track-record/labels", label: "labels", hint: "hit-rate by signal type" },
    ],
  },
  {
    href: "/markets",
    label: "markets",
    match: (p) =>
      p.startsWith("/markets") ||
      p.startsWith("/signals") ||
      p.startsWith("/entities") ||
      p.startsWith("/sectors") ||
      p.startsWith("/convergence") ||
      p.startsWith("/equities") ||
      p.startsWith("/watchlist") ||
      p.startsWith("/backtest-workbench"),
    items: [
      { href: "/markets", label: "markets", hint: "quotes + directional moves" },
      { href: "/signals", label: "signals", hint: "published signal feed" },
      { href: "/entities", label: "entities", hint: "companies + spillover map" },
      { href: "/sectors", label: "sectors", hint: "sector rollups" },
      { href: "/convergence", label: "convergence", hint: "multi-source agreement" },
      { href: "/equities", label: "equities", hint: "price context snapshots" },
      { href: "/watchlist/entities", label: "watchlist", hint: "tracked entities" },
      { href: "/backtest-workbench", label: "backtest", hint: "label hit-rate workbench" },
    ],
  },
  {
    href: "/communities",
    label: "communities",
    match: (p) =>
      p.startsWith("/communities") ||
      p.startsWith("/discover") ||
      p.startsWith("/ideas") ||
      p.startsWith("/opportunities") ||
      p.startsWith("/teardowns"),
    items: [
      { href: "/communities", label: "communities", hint: "tracked subreddits + digests" },
      { href: "/discover", label: "discover", hint: "public community feed" },
      { href: "/ideas", label: "ideas", hint: "business ideas to build" },
      { href: "/opportunities", label: "opportunities", hint: "demand-signal deep views" },
      { href: "/teardowns", label: "teardowns", hint: "product teardowns" },
    ],
  },
  {
    href: "/mentions",
    label: "mentions",
    match: (p) => p.startsWith("/mentions") || p.startsWith("/domains"),
    items: [
      { href: "/mentions", label: "brands", hint: "perception over your brand" },
      { href: "/domains", label: "domains", hint: "tracked domains" },
    ],
  },
  {
    href: "/agent-eval",
    label: "agent eval",
    match: (p) => p.startsWith("/agent-eval"),
    items: [
      { href: "/agent-eval", label: "audits", hint: "how assistants answer" },
      { href: "/agent-eval/seo", label: "seo audit", hint: "agent-readiness checks" },
    ],
  },
  {
    href: "/lab",
    label: "lab",
    match: (p) => p.startsWith("/lab") || p.startsWith("/review/lab-candidates"),
    items: [
      { href: "/lab", label: "feed", hint: "local-first ingestion index" },
      { href: "/review/lab-candidates", label: "candidates", hint: "lab → signal drafts" },
    ],
  },
];

// Utility surfaces — secondary to the products, pushed to the right.
const OPS: NavLeaf[] = [
  { href: "/review", label: "review" },
  { href: "/explore", label: "explore" },
  { href: "/settings/delivery", label: "settings" },
];

const linkBase =
  "font-mono text-[11px] uppercase tracking-[0.18em] transition-colors duration-150";

export function PrimaryNav() {
  const pathname = usePathname() ?? "/";
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const baseId = useId();

  const close = useCallback(() => setOpenId(null), []);

  // Close on outside click and on Escape — standard popover behavior.
  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, close]);

  // Collapse any open dropdown after navigation.
  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-x-4 gap-y-1 px-5 py-3 sm:px-6">
        <Link
          href={"/" as Route}
          className="shrink-0 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-fg)] transition-colors duration-150 hover:text-[var(--color-accent)]"
        >
          <span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--color-accent)] align-middle" />
          high signal
        </Link>

        <ul className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-1">
          {PRODUCTS.map((product) => {
            const active = product.match(pathname);
            const open = openId === product.label;
            const menuId = `${baseId}-${product.label.replace(/\s+/g, "-")}`;
            return (
              <li
                key={product.label}
                className="relative"
                onMouseEnter={() => setOpenId(product.label)}
                onMouseLeave={close}
              >
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-controls={menuId}
                  onClick={() => setOpenId(open ? null : product.label)}
                  className={`group flex items-center gap-1.5 rounded-sm px-2 py-1 ${linkBase} ${
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  }`}
                >
                  {product.label}
                  <svg
                    aria-hidden
                    viewBox="0 0 10 6"
                    className={`h-[5px] w-[8px] transition-transform duration-200 ${
                      open ? "rotate-180" : ""
                    } ${active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-accent)]"}`}
                  >
                    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <div
                  id={menuId}
                  role="menu"
                  aria-label={product.label}
                  data-open={open}
                  className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-[224px] origin-top overflow-hidden border border-[var(--color-line)] bg-[var(--color-bg)] transition-[opacity,transform] duration-150 ease-out data-[open=false]:pointer-events-none data-[open=false]:-translate-y-1 data-[open=false]:opacity-0 data-[open=true]:translate-y-0 data-[open=true]:opacity-100 motion-reduce:transition-none"
                >
                  <ul className="py-1">
                    {product.items.map((item) => {
                      const itemActive = pathname === item.href;
                      return (
                        <li key={item.href} role="none">
                          <Link
                            role="menuitem"
                            href={item.href as Route}
                            onClick={close}
                            className={`flex flex-col gap-0.5 px-3 py-2 transition-colors duration-150 ${
                              itemActive
                                ? "bg-[var(--color-line)]/40 text-[var(--color-accent)]"
                                : "text-[var(--color-fg)] hover:bg-[var(--color-line)]/30 hover:text-[var(--color-accent)]"
                            }`}
                          >
                            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                              {item.label}
                            </span>
                            {item.hint ? (
                              <span className="text-[11px] normal-case tracking-normal text-[var(--color-muted)]">
                                {item.hint}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>

        <ul className="hidden items-center gap-x-4 md:flex">
          {OPS.map((link) => {
            const active = pathname.startsWith(link.href.split("/").slice(0, 2).join("/"));
            return (
              <li key={link.href}>
                <Link
                  href={link.href as Route}
                  className={`${linkBase} ${
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  }`}
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
