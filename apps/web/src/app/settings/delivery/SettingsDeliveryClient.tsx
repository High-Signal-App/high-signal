'use client';

import { useCallback, useEffect, useState } from 'react';

interface Pref {
  userId: string;
  channel: string;
  enabled: boolean;
  email: string | null;
  region: string;
  timezone: string;
  localWindowStart: string;
  connectedBrandId: string | null;
  rssToken: string | null;
  updatedAt: string;
}

interface LogRow {
  id: string;
  channel: string;
  briefDate: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  reason: string | null;
  attempt: number;
  sentAt: string | null;
  createdAt: string;
}

const REGIONS = [
  'global',
  'na',
  'eu',
  'south-asia',
  'east-asia',
  'sea',
  'latam',
  'mena',
  'africa',
  'oceania',
];

export default function SettingsDeliveryClient() {
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rss, setRss] = useState<{ enabled: boolean; token: string | null }>({
    enabled: false,
    token: null,
  });
  const [draft, setDraft] = useState<{
    enabled: boolean;
    region: string;
    timezone: string;
    localWindowStart: string;
  }>({
    enabled: true,
    region: 'global',
    timezone:
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    localWindowStart: '07:00',
  });

  const load = useCallback(async () => {
    try {
      const p = await fetch('/api/delivery/preferences', { credentials: 'include' });
      if (p.ok) {
        const j = (await p.json()) as { preferences: Pref[] };
        const email = j.preferences.find((x) => x.channel === 'email');
        const rssPreference = j.preferences.find((x) => x.channel === 'rss');
        if (email) {
          setDraft({
            enabled: email.enabled,
            region: email.region,
            timezone: email.timezone,
            localWindowStart: email.localWindowStart,
          });
        }
        setRss({
          enabled: rssPreference?.enabled ?? false,
          token: rssPreference?.rssToken ?? null,
        });
      }
      const l = await fetch('/api/delivery/log', { credentials: 'include' });
      if (l.ok) {
        const j = (await l.json()) as { log: LogRow[] };
        setLog(j.log);
      }
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await fetch('/api/delivery/preferences', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email', ...draft }),
      });
      if (!r.ok) setErr(`save ${r.status}`);
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await fetch('/api/delivery/test', {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) setErr(`test ${r.status}`);
      else alert('test queued — check your inbox');
    } finally {
      setBusy(false);
    }
  }

  async function setPrivateFeeds(enabled: boolean) {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const response = await fetch('/api/delivery/preferences', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'rss',
          enabled,
          region: draft.region,
          timezone: draft.timezone,
          localWindowStart: draft.localWindowStart,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        rssToken?: string;
      };
      if (!response.ok) {
        setErr(`private feeds ${response.status}: ${body.error ?? 'request failed'}`);
      } else {
        if (body.rssToken) setRss({ enabled, token: body.rssToken });
        setNotice(enabled ? 'private feeds enabled' : 'private feeds disabled');
        await load();
      }
    } catch (error) {
      setErr(`private feeds: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function retry(row: LogRow) {
    setRetryingId(row.id);
    setErr(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/delivery/retry/${encodeURIComponent(row.id)}`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        attempt?: number;
      };
      if (!response.ok) {
        setErr(`retry ${response.status}: ${body.error ?? body.reason ?? 'send failed'}`);
      } else {
        setNotice(`delivery sent on attempt ${body.attempt ?? row.attempt + 1}`);
      }
    } catch (error) {
      setErr(`retry: ${String(error)}`);
    } finally {
      await load();
      setRetryingId(null);
    }
  }

  const recentFailed = log.find((l) => l.status === 'failed');

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Delivery</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          The daily brief delivered to your inbox at your chosen local window. Toggle off anytime.
        </p>
      </header>

      {err && (
        <div className="mt-4 border border-rose-500/40 bg-rose-500/[0.03] p-3 font-mono text-[11px] text-rose-300">
          {err}
        </div>
      )}
      {notice && (
        <div className="mt-4 border border-emerald-500/40 bg-emerald-500/[0.03] p-3 font-mono text-[11px] text-emerald-300">
          {notice}
        </div>
      )}
      {recentFailed && (
        <div className="mt-4 border border-amber-500/40 bg-amber-500/[0.03] p-3 font-mono text-[11px] text-amber-300">
          last delivery failed ({recentFailed.briefDate}): {recentFailed.reason ?? 'unknown'}
        </div>
      )}

      <section className="mt-8 border border-zinc-800 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          email channel
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="size-4"
            />
            <span className="text-sm text-zinc-200">enabled</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              region
            </span>
            <select
              value={draft.region}
              onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              className="border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              timezone
            </span>
            <input
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              className="border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              window start (HH:MM local)
            </span>
            <input
              value={draft.localWindowStart}
              onChange={(e) => setDraft({ ...draft, localWindowStart: e.target.value })}
              placeholder="07:00"
              className="border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200"
            />
          </label>
        </div>
        <div className="mt-5 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="border border-[var(--color-accent)] px-3 py-1 text-[var(--color-accent)] hover:bg-white/[0.04] disabled:opacity-30"
          >
            save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={test}
            className="border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
          >
            send test now
          </button>
        </div>
      </section>

      <section className="mt-6 border border-zinc-800 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          private feeds
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          Your daily brief as RSS or Atom. The token in each URL is private; treat it like a
          password.
        </p>
        {rss.enabled && rss.token ? (
          <div className="mt-4 space-y-2 font-mono text-[10px]">
            <a
              href={`/digest/rss?token=${encodeURIComponent(rss.token)}`}
              className="block break-all text-[var(--color-accent)] hover:underline"
            >
              /digest/rss?token={rss.token}
            </a>
            <a
              href={`/digest/atom?token=${encodeURIComponent(rss.token)}`}
              className="block break-all text-[var(--color-accent)] hover:underline"
            >
              /digest/atom?token={rss.token}
            </a>
            <a href="/api/delivery/digest" className="block text-zinc-400 hover:text-zinc-200">
              compact JSON (signed-in session)
            </a>
          </div>
        ) : (
          <p className="mt-4 font-mono text-[10px] text-zinc-600">
            {rss.token ? 'disabled — existing token preserved' : 'no private feed token yet'}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void setPrivateFeeds(!rss.enabled)}
          className="mt-4 border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
        >
          {rss.enabled ? 'disable private feeds' : 'enable private feeds'}
        </button>
      </section>

      <section className="mt-10 border-t border-zinc-800 pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          last 30 days
        </h2>
        {log.length === 0 && (
          <div className="mt-4 border border-dashed border-zinc-800 p-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no delivery rows yet
          </div>
        )}
        <ul className="mt-4 space-y-1 font-mono text-[10px]">
          {log.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-4 border-b border-zinc-900 py-2"
            >
              <span className="text-zinc-500">
                {l.briefDate} · {l.channel}
              </span>
              <span className="flex items-center gap-3">
                <span
                  className={
                    l.status === 'sent'
                      ? 'text-emerald-400'
                      : l.status === 'failed'
                        ? 'text-rose-400'
                        : l.status === 'skipped'
                          ? 'text-zinc-500'
                          : 'text-zinc-300'
                  }
                >
                  {l.status}
                  {l.reason ? <span className="ml-2 text-zinc-600">{l.reason}</span> : null}
                </span>
                {l.status === 'failed' && l.channel === 'email' ? (
                  <button
                    type="button"
                    disabled={retryingId !== null}
                    onClick={() => void retry(l)}
                    className="border border-rose-500/40 px-2 py-0.5 uppercase tracking-[0.16em] text-rose-300 hover:bg-rose-500/[0.05] disabled:opacity-30"
                  >
                    {retryingId === l.id ? 'retrying…' : 'retry'}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        prefs and the log live on D1. Channel choice is reversible.
      </p>
    </main>
  );
}
