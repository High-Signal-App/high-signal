import { HeroHeader, PageShell, RouteList, StatGrid } from "@/components/system/HighSignalUI";

export default function HomePage() {
  return (
    <PageShell>
      <HeroHeader eyebrow="daily product-decision brief" title="High Signal">
        Start here when you want to know what changed, whether the market already priced it in, and
        what product move is actually worth making next.
      </HeroHeader>

      <section className="mt-10 border-y border-[var(--color-line)] py-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          what to expect
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            {
              step: "1",
              title: "Read what changed",
              body: "Daily market, community, and product signals are grouped into a short feed instead of scattered research tabs.",
            },
            {
              step: "2",
              title: "Check if it is late",
              body: "Public-company signals include a priced-in check, so true news does not get mistaken for a fresh opportunity.",
            },
            {
              step: "3",
              title: "Decide what to do",
              body: "The personal brief turns the useful signals into build, change, watch, or ignore decisions for the product fleet.",
            },
          ].map((item) => (
            <div key={item.step}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                {item.step}
              </div>
              <h2 className="mt-3 text-xl font-medium tracking-tight">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <StatGrid
        items={[
          {
            label: "first click",
            value: "Daily read",
            sub: "scan today's source-linked signals",
          },
          {
            label: "market guardrail",
            value: "priced in?",
            sub: "current Yahoo price context on public tickers",
          },
          {
            label: "final output",
            value: "next move",
            sub: "what to build, change, watch, or ignore",
          },
        ]}
      />

      <RouteList
        items={[
          { href: "/signals/today", title: "Start here", sub: "today's readable signal feed" },
          { href: "/personal", title: "Planning brief", sub: "one recommended next product move" },
          { href: "/signals", title: "All signals", sub: "archive with priced-in checks and filters" },
          { href: "/markets", title: "Market context", sub: "broad prices and sector movement" },
          { href: "/opportunities", title: "What to build", sub: "product ideas backed by evidence" },
          { href: "/ideas", title: "Idea checker", sub: "test a product thesis against evidence" },
          { href: "/dashboard", title: "Workspace", sub: "mentions, communities, and markets together" },
        ]}
      />

      <footer className="mt-16 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        read the change / check the price / decide the product move
      </footer>
    </PageShell>
  );
}
