import { api, type SignalRow } from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';
import { SignalCard } from '@/components/molecules/SignalCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly digest — High Signal' };

// Public per agents.md: weekly digest is a public output channel.
export default async function DigestPage() {
  let signals: SignalRow[] = [];
  let since = '';
  try {
    const r = await api.digestWeekly();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
    since = r.since;
  } catch {
    /* offline */
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Weekly digest</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          All signals published in the last 7 days. RSS:{' '}
          <a className="text-[var(--color-accent)]" href="/digest/rss">
            /digest/rss
          </a>
          .
        </p>
        {since && (
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            since {since.slice(0, 10)}
          </div>
        )}
      </header>

      {signals.length === 0 ? (
        <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          no signals this week
        </div>
      ) : (
        <div className="mt-8 border-t border-zinc-800">
          {signals.map((s) => (
            <SignalCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </main>
  );
}
