import { api, type Direction, type Confidence, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { SignalCard } from "@/components/molecules/SignalCard";
import { FilterBar, type Facets } from "@/components/molecules/FilterBar";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals — High Signal" };

interface SP {
  type?: string;
  direction?: Direction;
  confidence?: Confidence;
  entity?: string;
  category?: SignalContentCategory;
}

const FILTER_KEYS = new Set(["category", "type", "direction", "confidence", "entity"]);

const signalTabs = [
  { href: "/signals/today", label: "daily" },
  { href: "/signals", label: "all" },
  { href: "/digest", label: "weekly" },
  { href: "/markets", label: "markets" },
  { href: "/communities", label: "communities" },
  { href: "/mentions", label: "mentions" },
  { href: "/agent-eval", label: "agent eval" },
  { href: "/personal", label: "personal" },
];

function countBy<T extends string>(values: T[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

function facetsFromSignals(signals: SignalRow[]): Facets {
  return {
    types: countBy(signals.map((signal) => signal.signalType)),
    categories: countBy(
      signals.map(
        (signal) =>
          signal.contentCategory ??
          assessSignalQuality({
            signalType: signal.signalType,
            confidence: signal.confidence,
            evidenceUrls: signal.evidenceUrls,
            bodyMd: signal.bodyMd,
          }).contentCategory,
      ),
    ),
    directions: countBy(signals.map((signal) => signal.direction)),
    confidences: countBy(signals.map((signal) => signal.confidence)),
    topEntities: countBy(signals.map((signal) => signal.primaryEntityId)).slice(0, 20),
  };
}

// Public per agents.md: signals are a "public web page" output channel.
export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  let signals: SignalRow[] = [];
  let facets: Facets = { types: [], categories: [], directions: [], confidences: [], topEntities: [] };
  try {
    const [s, f] = await Promise.all([api.signals(sp), api.facets()]);
    signals = s.signals.filter((signal) => !isBackfillSignal(signal));
    facets = signals.length ? facetsFromSignals(signals) : f;
  } catch {
    /* api offline / empty */
  }

  const activeFilters = Object.entries(sp).filter(([key, v]) => FILTER_KEYS.has(key) && Boolean(v));

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Header />
      <SignalTabs />
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

function SignalTabs() {
  return (
    <nav className="mt-5 flex flex-wrap gap-2 border-y border-zinc-800 py-3 font-mono text-[10px] uppercase tracking-[0.18em]">
      {signalTabs.map((item) => (
        <a
          className="border border-zinc-800 px-2.5 py-1 text-zinc-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </a>
      ))}
    </nav>
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
        Every published signal cites at least two sources and predicts direction with a confidence
        band. Use Daily for the freshest slice, or filter this feed by content type, entity,
        direction, and confidence. Subscribe via{" "}
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
