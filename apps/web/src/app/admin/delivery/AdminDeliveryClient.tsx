'use client';

import { useEffect, useState } from 'react';

interface Summary {
  days: number;
  totals: Record<string, number>;
  byReason: Record<string, number>;
  perDay: Array<{ status: string; reason: string | null; n: number; brief_date: string }>;
}

export default function AdminDeliveryClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    void load(days);
  }, [days]);

  async function load(d: number) {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/delivery/summary?days=${d}`, { credentials: 'include' });
      if (!r.ok) {
        setErr(`load ${r.status}`);
        return;
      }
      const j = (await r.json()) as Summary;
      setSummary(j);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Delivery — admin</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Per-day delivery counts and top failure reasons.
        </p>
      </header>

      <div className="mt-6 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`border px-3 py-1 ${
              days === d
                ? 'border-[var(--color-accent)] bg-white/[0.04] text-white'
                : 'border-zinc-800 text-zinc-400 hover:bg-white/[0.02]'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {err && (
        <div className="mt-4 border border-rose-500/40 bg-rose-500/[0.03] p-3 font-mono text-[11px] text-rose-300">
          {err}
        </div>
      )}

      {summary && (
        <>
          <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(['sent', 'skipped', 'failed', 'queued'] as const).map((s) => (
              <div key={s} className="border border-zinc-800 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {s}
                </div>
                <div className="mt-2 nums text-2xl text-zinc-100">{summary.totals[s] ?? 0}</div>
              </div>
            ))}
          </section>

          <section className="mt-10 border-t border-zinc-800 pt-6">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              top reasons
            </h2>
            <ul className="mt-4 space-y-1 font-mono text-[10px]">
              {Object.entries(summary.byReason)
                .sort(([, a], [, b]) => b - a)
                .map(([reason, n]) => (
                  <li
                    key={reason}
                    className="flex items-center justify-between border-b border-zinc-900 py-2"
                  >
                    <span className="text-zinc-300">{reason}</span>
                    <span className="nums text-zinc-500">{n}</span>
                  </li>
                ))}
              {Object.keys(summary.byReason).length === 0 && (
                <li className="text-zinc-500">no reasons recorded</li>
              )}
            </ul>
          </section>

          <section className="mt-10 border-t border-zinc-800 pt-6">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              per-day breakdown
            </h2>
            <table className="mt-4 w-full text-xs">
              <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-800 py-2 text-left">date</th>
                  <th className="border-b border-zinc-800 py-2 text-left">status</th>
                  <th className="border-b border-zinc-800 py-2 text-left">reason</th>
                  <th className="border-b border-zinc-800 py-2 text-right">n</th>
                </tr>
              </thead>
              <tbody>
                {summary.perDay.map((r, i) => (
                  <tr key={i}>
                    <td className="border-b border-zinc-900 py-2 text-zinc-300">{r.brief_date}</td>
                    <td className="border-b border-zinc-900 py-2 text-zinc-300">{r.status}</td>
                    <td className="border-b border-zinc-900 py-2 text-zinc-500">
                      {r.reason ?? '—'}
                    </td>
                    <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                      {r.n}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
