import { HeroHeader, PageShell, ProductAreaGrid, RouteList } from "@/components/system/HighSignalUI";

export default function HomePage() {
  return (
    <PageShell>
      <HeroHeader eyebrow="v0 / pre-launch / signal intelligence" title="High Signal">
        Extract actionable signals from noisy public and semi-public information streams. Mentions,
        communities, and markets share one evidence-first signal layer.
      </HeroHeader>

      <ProductAreaGrid
        items={[
          {
            href: "/mentions",
            title: "Mention Intelligence",
            kicker: "company",
            body: "Brand, competitor, AI visibility, citation, and share-of-voice signals.",
          },
          {
            href: "/communities",
            title: "Community Intelligence",
            kicker: "subreddit",
            body: "Community pain, demand, narrative, and product-opportunity signals.",
          },
          {
            href: "/markets",
            title: "Market Intelligence",
            kicker: "entity graph",
            body: "Evidence-backed company and sector signals with confidence and hit-rate tracking.",
          },
        ]}
      />

      <RouteList
        items={[
          { href: "/ideas", title: "idea flow", sub: "product thesis check" },
          { href: "/signals", title: "signal feed", sub: "unified stream" },
          { href: "/watchlist", title: "unified watchlist", sub: "action digest" },
          { href: "/dashboard", title: "signal dashboard", sub: "premium workspace" },
          { href: "/discover", title: "community discover", sub: "source-linked digests" },
          { href: "/review", title: "review queue", sub: "human approval" },
          { href: "/backtest-workbench", title: "backtest workbench", sub: "action quality" },
          { href: "/track-record", title: "track record", sub: "market signals" },
          { href: "/digest", title: "weekly digest", sub: "rss + email-ready" },
        ]}
      />

      <footer className="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        evidence-first / source-linked / action-oriented
      </footer>
    </PageShell>
  );
}
