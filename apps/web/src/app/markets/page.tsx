import {
  BackLink,
  MetricGrid,
  PageShell,
  Panel,
  RouteList,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import { buildMarketWatchSnapshot, formatMarketPct, marketDirectionTone, marketRefreshDates } from "@/lib/market-watch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market Intelligence - High Signal" };

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function latestQuoteDate(group: ReturnType<typeof buildMarketWatchSnapshot>["groups"][number]) {
  return group.quotes
    .map((quote) => `${quote.date} ${quote.time}`)
    .sort()
    .at(-1) ?? "no quote";
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedDate = safeDate(params.date);
  const snapshot = buildMarketWatchSnapshot(new Date(), selectedDate);
  const dates = marketRefreshDates();
  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="market signal layer" title="Market Intelligence">
        High-level national and international stock context for product timing. This is market
        awareness and product-context routing, not investment advice or deep single-stock research.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: "Freshness",
            value: snapshot.freshnessStatus,
            sub: snapshot.latestRefreshAt
              ? `latest refresh ${snapshot.latestRefreshAt.slice(0, 16).replace("T", " ")} UTC`
              : "no market refresh bundled",
          },
          {
            label: "Coverage",
            value: `${snapshot.nationalGroupCount}/${snapshot.internationalGroupCount}`,
            sub: "national / international groups",
          },
          {
            label: "Quotes",
            value: snapshot.quoteCount.toString(),
            sub: `${snapshot.source.toUpperCase()} high-level watchlist feed`,
          },
          {
            label: "Selected",
            value: snapshot.selectedRefreshDate ?? "none",
            sub: snapshot.selectedRefreshAt
              ? `snapshot ${snapshot.selectedRefreshAt.slice(0, 16).replace("T", " ")} UTC`
              : "no selected snapshot",
          },
        ]}
      />

      <form className="mt-8 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          date
          <input
            className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedDate ?? snapshot.selectedRefreshDate ?? ""}
            name="date"
            type="date"
          />
        </label>
        <button
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
          type="submit"
        >
          load
        </button>
        <a
          className="border border-[var(--color-line)] px-4 py-2 text-center font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
          href="/markets/history"
        >
          history
        </a>
      </form>

      {snapshot.sourceDateShifted ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
          No market snapshot exists for {snapshot.requestedDate}; showing the latest prior snapshot from{" "}
          {snapshot.selectedRefreshDate}.
        </p>
      ) : null}

      <section className="mt-10 grid gap-8 md:grid-cols-3">
        <Panel eyebrow="source" title="Stooq snapshots">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            The daily automation refreshes a compact watchlist from Stooq and bundles the latest
            records into the web app. JSON export is available at{" "}
            <a className="text-[var(--color-accent)] hover:underline" href={`/markets.json${snapshot.selectedRefreshDate ? `?date=${snapshot.selectedRefreshDate}` : ""}`}>
              /markets.json
            </a>
            .
          </p>
        </Panel>
        <Panel eyebrow="constraint" title="No deep dive yet">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            The page tracks broad direction, movers, and product implication. It deliberately avoids
            valuation models, analyst-style calls, and trade recommendations.
          </p>
        </Panel>
        <Panel eyebrow="routing" title="Product context">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Market changes feed the personal brief only when they shift positioning, buyer urgency,
            infrastructure budget mood, or the evidence needed for a product bet.
          </p>
        </Panel>
      </section>

      <MetricGrid
        items={[
          { label: "groups", value: snapshot.groupCount.toString() },
          { label: "history", value: `${dates.length}d / ${snapshot.history.length} refreshes` },
          {
            label: "direction",
            value: snapshot.directionCounts.map(({ k, n }) => `${k} ${n}`).join(" / ") || "none",
          },
          {
            label: "age",
            value: snapshot.freshnessHours === null ? "n/a" : `${snapshot.freshnessHours}h`,
          },
        ]}
      />

      <section className="mt-10 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {snapshot.groups.map((group) => (
          <article className="py-8" id={group.id} key={group.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {group.region} / {latestQuoteDate(group)}
                </div>
                <h2 className="mt-2 text-2xl font-medium tracking-tight">{group.title}</h2>
              </div>
              <div className={`font-mono text-xs uppercase tracking-[0.18em] ${marketDirectionTone(group.direction)}`}>
                {group.direction} / {formatMarketPct(group.averageChangePct)}
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">{group.thesis}</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-fg)]">
              {group.productImplication}
            </p>
            <div className="mt-6 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2">
              {group.quotes
                .slice()
                .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
                .map((quote) => (
                  <div className="bg-[var(--color-bg)] p-4" key={quote.symbol}>
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                          {quote.symbol}
                        </div>
                        <div className="mt-2 text-base font-medium">{quote.name}</div>
                      </div>
                      <div className={`font-mono text-sm ${quote.changePct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {formatMarketPct(quote.changePct)}
                      </div>
                    </div>
                    <div className="mt-3 text-xs leading-5 text-[var(--color-muted)]">{quote.role}</div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                      <span>close {quote.close}</span>
                      <span>open {quote.open}</span>
                      <span>volume {formatNumber(quote.volume)}</span>
                      <span>{quote.date}</span>
                    </div>
                  </div>
                ))}
            </div>
          </article>
        ))}
      </section>

      {snapshot.groups.length === 0 ? (
        <p className="mt-10 text-sm text-[var(--color-muted)]">
          No bundled market refresh exists yet. Run `pnpm personal:brief refresh-markets` and
          `pnpm market:snapshot`.
        </p>
      ) : null}

      <RouteList
        items={[
          { href: "/personal", title: "personal brief", sub: "market context converted into product decisions" },
          { href: "/markets/history", title: "market history", sub: "date archive for stock context snapshots" },
          { href: "/daily", title: "daily", sub: "source reads and requirement queue" },
          { href: "/signals", title: "signals", sub: "published market and company signals" },
          { href: "/entities", title: "entities", sub: "company and sector graph" },
        ]}
      />
    </PageShell>
  );
}
