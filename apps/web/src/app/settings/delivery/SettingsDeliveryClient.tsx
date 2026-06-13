"use client";

import { useEffect, useState } from "react";

interface Pref {
  userId: string;
  channel: string;
  enabled: boolean;
  email: string | null;
  region: string;
  timezone: string;
  localWindowStart: string;
  connectedBrandId: string | null;
  updatedAt: string;
}

interface LogRow {
  id: string;
  channel: string;
  briefDate: string;
  status: "queued" | "sent" | "failed" | "skipped";
  reason: string | null;
  attempt: number;
  sentAt: string | null;
  createdAt: string;
}

const REGIONS = ["global", "na", "eu", "south-asia", "east-asia", "sea", "latam", "mena", "africa", "oceania"];

export default function SettingsDeliveryClient() {
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ enabled: boolean; region: string; timezone: string; localWindowStart: string }>({
    enabled: true,
    region: "global",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
    localWindowStart: "07:00",
  });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const p = await fetch("/api/delivery/preferences", { credentials: "include" });
      if (p.ok) {
        const j = (await p.json()) as { preferences: Pref[] };
        const email = j.preferences.find((x) => x.channel === "email");
        if (email) {
          setDraft({
            enabled: email.enabled,
            region: email.region,
            timezone: email.timezone,
            localWindowStart: email.localWindowStart,
          });
        }
      }
      const l = await fetch("/api/delivery/log", { credentials: "include" });
      if (l.ok) {
        const j = (await l.json()) as { log: LogRow[] };
        setLog(j.log);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/delivery/preferences", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "email", ...draft }),
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
    try {
      const r = await fetch("/api/delivery/test", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) setErr(`test ${r.status}`);
      else alert("test queued — check your inbox");
    } finally {
      setBusy(false);
    }
  }

  const recentFailed = log.find((l) => l.status === "failed");

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
      {recentFailed && (
        <div className="mt-4 border border-amber-500/40 bg-amber-500/[0.03] p-3 font-mono text-[11px] text-amber-300">
          last delivery failed ({recentFailed.briefDate}): {recentFailed.reason ?? "unknown"}
        </div>
      )}

      <section className="mt-8 border border-zinc-800 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">email channel</div>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">region</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">timezone</span>
            <input
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              className="border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">window start (HH:MM local)</span>
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
            disabled={busy}
            onClick={save}
            className="border border-[var(--color-accent)] px-3 py-1 text-[var(--color-accent)] hover:bg-white/[0.04] disabled:opacity-30"
          >
            save
          </button>
          <button
            disabled={busy}
            onClick={test}
            className="border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
          >
            send test now
          </button>
        </div>
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
            <li key={l.id} className="flex items-center justify-between gap-4 border-b border-zinc-900 py-2">
              <span className="text-zinc-500">
                {l.briefDate} · {l.channel}
              </span>
              <span
                className={
                  l.status === "sent"
                    ? "text-emerald-400"
                    : l.status === "failed"
                      ? "text-rose-400"
                      : l.status === "skipped"
                        ? "text-zinc-500"
                        : "text-zinc-300"
                }
              >
                {l.status}
                {l.reason ? <span className="ml-2 text-zinc-600">{l.reason}</span> : null}
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
