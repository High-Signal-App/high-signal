import Link from "next/link";

import { SITE_URL } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/40 mt-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>© {year} High Signal</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/track-record" className="hover:text-foreground transition-colors">
            Track record
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms
          </Link>
          <a href="https://sarthakagrawal.dev" className="hover:text-foreground transition-colors">
            Sarthak
          </a>
          <a href="https://sassmaker.com" className="hover:text-foreground transition-colors">
            Foundry
          </a>
          <a href={`${SITE_URL}/digest/rss`} className="hover:text-foreground transition-colors">
            RSS
          </a>
        </nav>
      </div>
    </footer>
  );
}
