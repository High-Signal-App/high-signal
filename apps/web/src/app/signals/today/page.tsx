import { api, type SignalRow } from "@/lib/api";
import { SignalCard } from "@/components/molecules/SignalCard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Today — High Signal",
  description:
    "Signals published in the last 24 hours, sorted by confidence. The morning-coffee surface for analysts who only have time for the freshest reads.",
};

function isWithinLast24h(publishedAt: SignalRow["publishedAt"]): boolean {
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) && Date.now() - t < 24 * 60 * 60 * 1000;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default async function SignalsTodayPage() {
  let all: SignalRow[] = [];
  try {
    const r = await api.signals({});
    all = r.signals;
  } catch {
    /* offline */
  }

  const today = all
    .filter((s) => isWithinLast24h(s.publishedAt))
    .sort((a, b) => {
      const c = (CONFIDENCE_RANK[a.confidence] ?? 9) - (CONFIDENCE_RANK[b.confidence] ?? 9);
      if (c !== 0) return c;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <a
        href="/signals"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← all signals
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Today</h1>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          last 24 hours · {today.length} signal{today.length === 1 ? "" : "s"}
        </p>
      </header>

      {today.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-500">
          Nothing in the last 24 hours. Check the weekly{" "}
          <a href="/digest" className="text-[var(--color-accent)] hover:underline">
            digest
          </a>{" "}
          instead.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {today.map((s) => (
            <SignalCard key={s.slug} s={s} />
          ))}
        </ul>
      )}
    </main>
  );
}
