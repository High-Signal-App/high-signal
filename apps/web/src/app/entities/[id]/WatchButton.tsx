'use client';

import { useState } from 'react';

export default function WatchButton({ entityId }: { entityId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function watch() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/watchlists/default/entities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId }),
      });
      if (!r.ok) {
        if (r.status === 401) setErr('sign in to watch');
        else setErr(`watch ${r.status}`);
      } else {
        setDone(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <a
        href="/watchlist/entities"
        className="border border-emerald-500/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/[0.05]"
      >
        watching ↗
      </a>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={busy}
        onClick={watch}
        className="border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
      >
        watch
      </button>
      {err && <span className="font-mono text-[10px] text-rose-400">{err}</span>}
    </div>
  );
}
