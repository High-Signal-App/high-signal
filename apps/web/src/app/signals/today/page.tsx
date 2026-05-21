import { api, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { SignalCard } from "@/components/molecules/SignalCard";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";
import {
  buildDailyBroadInsights,
  buildDailySourceCoverage,
  DAILY_INTELLIGENCE_LAYER,
  readSourceRefreshes,
} from "@/lib/daily-intelligence";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Today — High Signal",
  description:
    "Signals published in the last 24 hours, sorted by confidence. The morning-coffee surface for analysts who only have time for the freshest reads.",
};

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const CATEGORY_LABELS: Record<SignalContentCategory, string> = {
  "ai-infra": "AI infra",
  "market-pulse": "market pulse",
  "product-opportunity": "product opportunities",
  "customer-complaint": "customer complaints",
  "startup-move": "startup moves",
  "regional-issue": "regional issues",
  "agent-evaluation": "agent evaluation",
  "policy-regulatory": "policy / regulatory",
  "company-event": "company events",
};
function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

function signalCategory(signal: SignalRow): SignalContentCategory {
  return (
    signal.contentCategory ??
    assessSignalQuality({
      signalType: signal.signalType,
      confidence: signal.confidence,
      evidenceUrls: signal.evidenceUrls,
      bodyMd: signal.bodyMd,
    }).contentCategory
  );
}

function signalQuality(signal: SignalRow) {
  return assessSignalQuality({
    signalType: signal.signalType,
    confidence: signal.confidence,
    evidenceUrls: signal.evidenceUrls,
    bodyMd: signal.bodyMd,
  });
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export default async function SignalsTodayPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; category?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedDate = safeDate(params.date);
  const selectedCategory = (params.category || "") as SignalContentCategory | "";
  let all: SignalRow[] = [];
  try {
    const r = await api.signals({ date: selectedDate, limit: 200 });
    all = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* offline */
  }
  const refreshes = await readSourceRefreshes();
  const allBroadInsights = buildDailyBroadInsights(refreshes, selectedDate);

  const today = all
    .filter((s) => !selectedCategory || signalCategory(s) === selectedCategory)
    .sort((a, b) => {
      const c = (CONFIDENCE_RANK[a.confidence] ?? 9) - (CONFIDENCE_RANK[b.confidence] ?? 9);
      if (c !== 0) return c;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  const broadInsights = allBroadInsights.filter(
    (item) => !selectedCategory || item.contentCategory === selectedCategory,
  );
  const totalItems = today.length + broadInsights.length;
  const allItemsCount = all.length + allBroadInsights.length;
  const categories = countBy([
    ...all.map((signal) => signalCategory(signal)),
    ...allBroadInsights.map((item) => item.contentCategory),
  ]);
  const quality = today.map(signalQuality);
  const sourceClasses = countBy([
    ...quality.flatMap((item) => item.sourceClasses),
    ...broadInsights.map((item) => item.sourceType),
  ]);
  const usable =
    quality.filter((item) => item.publishable).length +
    broadInsights.filter((item) => item.qualityScore >= 45).length;
  const strong =
    quality.filter((item) => item.band === "strong").length +
    broadInsights.filter((item) => item.qualityScore >= 70).length;
  const evidenceCount =
    today.reduce((sum, signal) => sum + signal.evidenceUrls.length, 0) +
    broadInsights.reduce((sum, item) => sum + item.sourceCount, 0);
  const coverage = buildDailySourceCoverage(refreshes);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <a
        href="/signals"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← all signals
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Daily</h1>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {selectedDate} · {totalItems} item{totalItems === 1 ? "" : "s"} · signals{" "}
          {today.length} · reads {broadInsights.length}
        </p>
      </header>

      <form className="mt-6 grid gap-3 border-y border-zinc-800 py-4 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          date
          <input
            className="border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedDate}
            name="date"
            type="date"
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          kind
          <select
            className="border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[var(--color-accent)]"
            defaultValue={selectedCategory}
            name="category"
          >
            <option value="">all</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="border border-zinc-800 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-zinc-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] sm:self-end"
          type="submit"
        >
          load
        </button>
      </form>

      <section className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-5">
        {[
          ["usable", `${usable}/${totalItems}`],
          ["strong", strong.toString()],
          ["evidence", evidenceCount.toString()],
          ["sources", sourceClasses.map(([k, n]) => `${k} ${n}`).join(" / ") || "none"],
        ].map(([label, value]) => (
          <div key={label} className="bg-black p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {label}
            </div>
            <div className="mt-3 break-words font-mono text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </section>

      <section className="mt-6 border-y border-zinc-800 py-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          source coverage
        </div>
        <div className="mt-4 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
          {[
            ["configured", coverage.configuredSources.toString()],
            ["accepted", coverage.acceptedSnapshots.toString()],
            ["underlying items", coverage.underlyingItems.toString()],
            ["latest refresh", coverage.latestRefreshDate ?? "none"],
          ].map(([label, value]) => (
            <div key={label} className="bg-black p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {label}
              </div>
              <div className="mt-3 break-words font-mono text-sm text-zinc-200">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 text-xs leading-6 text-zinc-500 sm:grid-cols-2">
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">configured</div>
            <div className="mt-1 font-mono">
              {coverage.configuredByType.map(({ k, n }) => `${k} ${n}`).join(" / ")}
            </div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-[0.18em] text-zinc-600">accepted latest</div>
            <div className="mt-1 font-mono">
              {coverage.acceptedByType.map(({ k, n }) => `${k} ${n}`).join(" / ") || "none"}
            </div>
          </div>
        </div>
        <div className="mt-5 border-t border-zinc-900 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            intelligence layer
          </div>
          <div className="mt-2 font-mono text-[11px] leading-6 text-zinc-500">
            {DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.method} · no LLM · HF batch
            escalation off by default
          </div>
        </div>
      </section>

      {categories.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a
            className={`border px-2.5 py-1 ${!selectedCategory ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
            href={`/signals/today?date=${selectedDate}`}
          >
            all {allItemsCount}
          </a>
          {categories.map(([category, count]) => (
            <a
              className={`border px-2.5 py-1 ${selectedCategory === category ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
              href={`/signals/today?date=${selectedDate}&category=${category}`}
              key={category}
            >
              {(CATEGORY_LABELS[category as SignalContentCategory] ?? category).toLowerCase()} {count}
            </a>
          ))}
        </nav>
      ) : null}

      {broadInsights.length > 0 ? (
        <section className="mt-8 border-y border-zinc-800 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              broad public / startup / smb reads
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              {broadInsights.length} accepted
            </div>
          </div>
          <div className="mt-4 divide-y divide-zinc-800">
            {broadInsights.slice(0, 12).map((item) => (
              <a
                className="block py-4 hover:text-[var(--color-accent)]"
                href={item.href}
                key={item.id}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  <span>{item.sourceLabel}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{item.contentCategory.replaceAll("-", " ")}</span>
                  <span className="text-zinc-700">·</span>
                  <span>intent {item.intent.replaceAll("-", " ")}</span>
                  <span className="text-zinc-700">·</span>
                  <span>sentiment {item.sentiment}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{item.confidence}</span>
                  <span className="text-zinc-700">·</span>
                  <span>quality {item.qualityScore}</span>
                </div>
                <div className="mt-2 text-lg font-medium leading-snug text-zinc-100">{item.title}</div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{item.summary}</p>
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                  sources {item.sourceCount} / repeats {item.repeatedSignalCount}
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {totalItems === 0 ? (
        <p className="mt-10 text-sm text-zinc-500">
          Nothing for this date/filter. Check the weekly{" "}
          <a href="/digest" className="text-[var(--color-accent)] hover:underline">
            digest
          </a>{" "}
          instead.
        </p>
      ) : today.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {today.map((s) => (
            <SignalCard key={s.slug} s={s} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
