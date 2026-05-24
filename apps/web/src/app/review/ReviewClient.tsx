"use client";

import { useEffect, useMemo, useState } from "react";
import type { SignalRow } from "@/lib/api";
import { DirectionPill } from "@/components/atoms/DirectionPill";
import { ConfidenceBadge } from "@/components/atoms/ConfidenceBadge";
import { MarkdownView } from "@/components/system/MarkdownView";

const API_BASE =
  process.env["NEXT_PUBLIC_API_BASE"] ?? "https://high-signal-api.sarthakagrawal927.workers.dev";

type Status = "draft" | "published" | "corrected";

export default function ReviewPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [status, setStatus] = useState<Status>("draft");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [status]);

  async function refresh() {
    setErr(null);
    try {
      // Public read; bearer not required for status query
      const r = await fetch(`${API_BASE}/signals?status=${status}&limit=200`);
      const j = (await r.json()) as { signals: SignalRow[] };
      setSignals(j.signals);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function adminFetch(url: string, init: RequestInit): Promise<boolean> {
    setErr(null);
    const r = await fetch(url, { ...init, credentials: "include" });
    if (r.status === 401 || r.status === 403) {
      setErr("not authorized — sign in with a Clerk account that is allowed to review signals");
      return false;
    }
    if (!r.ok) {
      setErr(`${init.method ?? "GET"} ${r.status}`);
      return false;
    }
    return true;
  }

  async function patch(slug: string, body: Record<string, unknown>) {
    setBusy(slug);
    try {
      const ok = await adminFetch(`/api/admin/signals/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (ok) await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function destroy(slug: string) {
    if (!window.confirm(`delete ${slug}? this is permanent`)) return;
    setBusy(slug);
    try {
      const ok = await adminFetch(`/api/admin/signals/${slug}`, { method: "DELETE" });
      if (ok) await refresh();
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { draft: 0, published: 0, corrected: 0 };
    return { ...c, [status]: signals.length };
  }, [signals.length, status]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>

      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Review queue</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Behind Clerk. Browser requests stay same-origin, and the server injects privileged worker
          credentials only after the signed-in user passes the admin allow-list.
        </p>
      </header>

      <div className="mt-6 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        {(["draft", "published", "corrected"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`border px-3 py-1 ${
              status === s
                ? "border-[var(--color-accent)] bg-white/[0.04] text-white"
                : "border-zinc-800 text-zinc-400 hover:bg-white/[0.02]"
            }`}
          >
            {s} <span className="nums text-zinc-500">{status === s ? counts[s] : ""}</span>
          </button>
        ))}
        <button
          onClick={() => refresh()}
          className="ml-auto border border-zinc-800 px-3 py-1 text-zinc-400 hover:bg-white/[0.02]"
        >
          refresh
        </button>
      </div>

      {err && (
        <div className="mt-4 border border-rose-500/40 bg-rose-500/[0.03] p-3 font-mono text-[11px] text-rose-300">
          {err}
        </div>
      )}

      <div className="mt-6 border-t border-zinc-800">
        {signals.length === 0 && (
          <div className="border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no {status} signals
          </div>
        )}
        {signals.map((s) => (
          <ReviewRow
            key={s.id}
            s={s}
            busy={busy === s.slug}
            onPublish={() => patch(s.slug, { reviewStatus: "published" })}
            onDraft={() => patch(s.slug, { reviewStatus: "draft" })}
            onCorrected={() => patch(s.slug, { reviewStatus: "corrected" })}
            onDelete={() => destroy(s.slug)}
          />
        ))}
      </div>
    </main>
  );
}

function ReviewRow({
  s,
  busy,
  onPublish,
  onDraft,
  onCorrected,
  onDelete,
}: {
  s: SignalRow;
  busy: boolean;
  onPublish: () => void;
  onDraft: () => void;
  onCorrected: () => void;
  onDelete: () => void;
}) {
  const headline = (s.bodyMd ?? "").split("\n")[0].replace(/^#\s*/, "") || s.slug;
  return (
    <div className="border-b border-zinc-800 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <span>{new Date(s.publishedAt).toISOString().slice(0, 10)}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[var(--color-accent)]">{s.primaryEntityId}</span>
          <span className="text-zinc-700">·</span>
          <span>{s.signalType.replaceAll("_", " ")}</span>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBadge confidence={s.confidence} />
          <DirectionPill direction={s.direction} />
        </div>
      </div>
      <h3 className="mt-2 text-lg font-medium tracking-tight">
        <a href={`/signals/${s.slug}`} className="hover:text-white">
          {headline}
        </a>
      </h3>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300">
          body + evidence
        </summary>
        <div className="mt-3 max-h-72 overflow-auto border border-zinc-900 bg-zinc-950/50 p-4">
          <MarkdownView markdown={s.bodyMd} />
        </div>
        {s.evidenceUrls.length > 0 && (
          <ul className="mt-2 space-y-1 font-mono text-[10px]">
            {s.evidenceUrls.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
        {s.spilloverEntityIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
            <span className="uppercase tracking-[0.18em] text-zinc-500">spillover</span>
            {s.spilloverEntityIds.map((eid) => (
              <span key={eid} className="border border-zinc-800 px-1.5 py-0.5 text-zinc-400">
                {eid}
              </span>
            ))}
          </div>
        )}
      </details>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        <ActionButton disabled={busy || s.reviewStatus === "published"} tone="accent" onClick={onPublish}>
          publish
        </ActionButton>
        <ActionButton disabled={busy || s.reviewStatus === "draft"} tone="muted" onClick={onDraft}>
          → draft
        </ActionButton>
        <ActionButton disabled={busy || s.reviewStatus === "corrected"} tone="muted" onClick={onCorrected}>
          → corrected
        </ActionButton>
        <ActionButton disabled={busy} tone="danger" onClick={onDelete}>
          delete
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "accent" | "muted" | "danger";
}) {
  const cls =
    tone === "accent"
      ? "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-white/[0.04]"
      : tone === "danger"
        ? "border-rose-500/40 text-rose-400 hover:bg-rose-500/[0.05]"
        : "border-zinc-700 text-zinc-300 hover:bg-white/[0.02]";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border px-3 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${cls}`}
    >
      {children}
    </button>
  );
}
