import { api, type Direction, type Confidence, type SignalRow } from "@/lib/api";
import { SignalCard } from "@/components/molecules/SignalCard";
import { FilterBar, type Facets } from "@/components/molecules/FilterBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals — High Signal" };

interface SP {
  type?: string;
  direction?: Direction;
  confidence?: Confidence;
  entity?: string;
}

// Public per agents.md: signals are a "public web page" output channel.
export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  let signals: SignalRow[] = [];
  let facets: Facets = { types: [], directions: [], confidences: [], topEntities: [] };
  try {
    const [s, f] = await Promise.all([api.signals(sp), api.facets()]);
    signals = s.signals;
    facets = f;
  } catch {
    /* api offline / empty */
  }

  const activeFilters = Object.entries(sp).filter(([, v]) => Boolean(v));

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Header />
      <FilterBar facets={facets} />
      <ActiveSummary count={signals.length} active={activeFilters} />
      {signals.length === 0 ? (
        <Empty filtered={activeFilters.length > 0} />
      ) : (
        <div className="mt-2 border-t border-zinc-800">
          {signals.map((s) => (
            <SignalCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </main>
  );
}

function Header() {
  return (
    <header className="border-b border-zinc-800 pb-6">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Signals</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        Every published signal cites at least two sources, predicts direction with a confidence
        band, and is auto-scored on the public hit-rate ledger. Subscribe via{" "}
        <a
          className="text-[var(--color-accent)] hover:underline"
          href="/signals/rss"
          aria-label="RSS feed for all signals"
        >
          /signals/rss
        </a>
        .
      </p>
    </header>
  );
}

function ActiveSummary({
  count,
  active,
}: {
  count: number;
  active: [string, unknown][];
}) {
  return (
    <div className="mt-4 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
      <span>
        <span className="nums text-zinc-300">{count}</span> result{count === 1 ? "" : "s"}
      </span>
      {active.length > 0 && (
        <span>
          {active.map(([k, v]) => `${k}=${String(v)}`).join("  ·  ")}
        </span>
      )}
    </div>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
      {filtered ? "no signals match these filters" : "no signals published yet — first cards drop after phase 1"}
    </div>
  );
}
