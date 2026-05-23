import { HeroHeader, PageShell, ProductAreaGrid, RouteList } from "@/components/system/HighSignalUI";

export default function HomePage() {
  return (
    <PageShell>
      <HeroHeader eyebrow="v0 / open lab / signal intelligence" title="High Signal">
        Evidence-first signal intelligence across markets, communities, mentions, agent evaluation,
        and personal product decisions. The product is open while the sharpest surfaces mature.
      </HeroHeader>

      <ProductAreaGrid
        items={[
          {
            href: "/markets",
            title: "Market Intelligence",
            kicker: "market",
            body: "High-level national and international stock, sector, and company signals.",
          },
          {
            href: "/communities",
            title: "Community Intelligence",
            kicker: "public demand",
            body: "Repeated complaints, app requirements, founder pain, and regional issues.",
          },
          {
            href: "/mentions",
            title: "Mention Intelligence",
            kicker: "brand",
            body: "Company, competitor, AI visibility, citation, and share-of-voice checks.",
          },
          {
            href: "/agent-eval",
            title: "Agent Evaluation",
            kicker: "recommendable",
            body: "Audit whether a brand is legible, credible, and worth recommending to agents.",
          },
        ]}
      />

      <RouteList
        items={[
          { href: "/signals/today", title: "daily", sub: "freshest 24h signal view" },
          { href: "/signals", title: "all signals", sub: "filter by content, entity, confidence" },
          { href: "/digest", title: "weekly digest", sub: "rss + email-ready" },
          { href: "/personal", title: "personal command brief", sub: "what to build/change/watch" },
          { href: "/teardowns", title: "manual teardowns", sub: "approved task outputs" },
          { href: "/opportunities", title: "what to build", sub: "world-change product radar" },
          { href: "/ideas", title: "idea flow", sub: "product thesis check" },
          { href: "/dashboard", title: "workspace", sub: "combined product intelligence" },
          { href: "/watchlist", title: "watchlist", sub: "open action queue" },
        ]}
      />

      <footer className="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        evidence-first / source-linked / action-oriented
      </footer>
    </PageShell>
  );
}
