import { BackLink, MetricGrid, PageShell, SectionHeader } from "@/components/system/HighSignalUI";
import { buildMarketWatchSnapshot, formatMarketPct, marketDirectionTone } from "@/lib/market-watch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market History - High Signal" };

function formatTimestamp(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

export default async function MarketsHistoryPage() {
  const snapshot = buildMarketWatchSnapshot();
  const history = snapshot.history.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dates = Array.from(new Set(history.map((record) => record.createdAt.slice(0, 10))));
  const quoteCount = history.reduce(
    (sum, record) => sum + record.groups.reduce((groupSum, group) => groupSum + group.quotes.length, 0),
    0,
  );

  return (
    <PageShell>
      <BackLink href="/markets">back to markets</BackLink>
      <SectionHeader eyebrow="market archive" title="Market History">
        Date-browsable snapshots derived from the canonical equities feed for the high-level national and international stock watchlist.
      </SectionHeader>

      <MetricGrid
        items={[
          { label: "dates", value: dates.length.toString() },
          { label: "refreshes", value: history.length.toString() },
          { label: "quotes", value: quoteCount.toString() },
          { label: "latest", value: snapshot.latestRefreshAt?.slice(0, 10) ?? "none" },
        ]}
      />

      <section className="mt-10 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {history.map((record) => (
          <article className="py-6" key={record.createdAt}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {formatTimestamp(record.createdAt)} UTC / {record.source}
                </div>
                <h2 className="mt-2 text-xl font-medium tracking-tight">
                  {record.createdAt.slice(0, 10)} market snapshot
                </h2>
              </div>
              <a
                className="border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                href={`/markets?date=${record.createdAt.slice(0, 10)}`}
              >
                open date
              </a>
            </div>
            <div className="mt-5 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-3">
              {record.groups.map((group) => (
                <div className="bg-[var(--color-bg)] p-4" key={group.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      {group.region}
                    </div>
                    <div className={`font-mono text-[10px] uppercase tracking-[0.18em] ${marketDirectionTone(group.direction)}`}>
                      {group.direction} / {formatMarketPct(group.averageChangePct)}
                    </div>
                  </div>
                  <div className="mt-3 text-sm font-medium leading-5">{group.title}</div>
                  <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    {group.quotes
                      .slice()
                      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
                      .slice(0, 3)
                      .map((quote) => `${quote.symbol} ${formatMarketPct(quote.changePct)}`)
                      .join(" / ")}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
