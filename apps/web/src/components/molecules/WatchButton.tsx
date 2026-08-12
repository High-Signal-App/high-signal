'use client';

import { useState } from 'react';

export function WatchButton({ entityId }: { entityId: string }) {
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
        if (r.status === 401) setErr('Sign in before adding this entity.');
        else setErr('Could not add this entity. Try again.');
      } else {
        setDone(true);
      }
    } catch {
      setErr('Could not reach the watchlist service. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span aria-live="polite">
        <a
          autoFocus
          href="/watchlist/entities"
          className="inline-flex min-h-11 items-center border border-emerald-500/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/[0.05]"
        >
          watching ↗
        </a>
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={watch}
        className="min-h-11 border border-zinc-700 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
      >
        {busy ? 'watching…' : 'watch'}
      </button>
      {err && (
        <span className="max-w-56 text-right font-mono text-[10px] text-rose-400" role="alert">
          {err}{' '}
          {err.startsWith('Sign in') && (
            <a className="underline" href="/sign-in">
              Sign in
            </a>
          )}
        </span>
      )}
    </div>
  );
}
