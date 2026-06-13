"use client";

import { useEffect, useState } from "react";

interface WatchEntity {
  id: string;
  watchlistId: string;
  entityId: string;
  horizon: "day" | "week" | "month";
  addedAt: string;
  note: string | null;
}

interface Suppression {
  id: string;
  watchlistId: string;
  kind: "signal_type" | "edge_type" | "second_order_from";
  value: string;
  createdAt: string;
}

interface WatchItem {
  signalId: string;
  signalSlug: string;
  signalType: string;
  watchedEntityId: string;
  subjectEntityId: string;
  deltaKind: "direct" | "second_order";
  relationshipPath: Array<{ fromEntityId: string; toEntityId: string; type: string }>;
  observed: boolean;
  priority: number;
  confidence: "low" | "medium" | "high";
  publishedAt: string;
  why: string;
}

export default function EntityWatchlistClient() {
  const [entities, setEntities] = useState<WatchEntity[]>([]);
  const [impact, setImpact] = useState<WatchItem[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entityId, setEntityId] = useState("");
  const [supKind, setSupKind] = useState<Suppression["kind"]>("signal_type");
  const [supValue, setSupValue] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setErr(null);
    try {
      const [eR, sR, iR] = await Promise.all([
        fetch("/api/watchlists/default/entities", { credentials: "include" }),
        fetch("/api/watchlists/default/suppressions", { credentials: "include" }),
        fetch("/api/watchlists/default/impact", { credentials: "include" }),
      ]);
      if (eR.ok) {
        const j = (await eR.json()) as { entities: WatchEntity[] };
        setEntities(j.entities);
      }
      if (sR.ok) {
        const j = (await sR.json()) as { suppressions: Suppression[] };
        setSuppressions(j.suppressions);
      }
      if (iR.ok) {
        const j = (await iR.json()) as { items: WatchItem[] };
        setImpact(j.items);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function removeSuppression(ruleId: string) {
    setBusy(true);
    const r = await fetch(`/api/watchlists/default/suppressions/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setBusy(false);
    if (r.ok) {
      setSuppressions((prev) => prev.filter((s) => s.id !== ruleId));
      await load();
    } else setErr(`unsupress ${r.status}`);
  }

  async function addEntity() {
    if (!entityId.trim()) return;
    setBusy(true);
    const r = await fetch("/api/watchlists/default/entities", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId: entityId.trim() }),
    });
    setBusy(false);
    if (r.ok) {
      setEntities((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          watchlistId: "default",
          entityId: entityId.trim(),
          horizon: "week",
          addedAt: new Date().toISOString(),
          note: null,
        },
      ]);
      setEntityId("");
      await load();
    } else setErr(`add ${r.status}`);
  }

  async function removeEntity(id: string) {
    setBusy(true);
    const r = await fetch(`/api/watchlists/default/entities/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setBusy(false);
    if (r.ok) {
      setEntities((prev) => prev.filter((e) => e.entityId !== id));
      await load();
    } else setErr(`remove ${r.status}`);
  }

  async function addSuppression() {
    if (!supValue.trim()) return;
    setBusy(true);
    const r = await fetch("/api/watchlists/default/suppressions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: supKind, value: supValue.trim() }),
    });
    setBusy(false);
    if (r.ok) {
      setSupValue("");
      await load();
    } else setErr(`suppress ${r.status}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a
        href="/watchlist"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← watchlist
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Watched entities</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Add a company, ticker, repo, or sector. The brief surfaces direct movement plus second-order
          spillover one hop along the relationship graph. Suppression rules drop categories of noise.
        </p>
      </header>

      {err && (
        <div className="mt-4 border border-rose-500/40 bg-rose-500/[0.03] p-3 font-mono text-[11px] text-rose-300">
          {err}
        </div>
      )}

      <section className="mt-8 border border-zinc-800 p-5">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            watched entities
          </div>
          <div className="font-mono text-[10px] text-zinc-500">
            <span className="nums">{entities.length}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="entity id (e.g. NVDA, ASML, openai)"
            className="flex-1 border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            disabled={busy || !entityId.trim()}
            onClick={addEntity}
            className="border border-[var(--color-accent)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:bg-white/[0.04] disabled:opacity-30"
          >
            add
          </button>
        </div>
        {entities.length > 0 && (
          <ul className="mt-4 space-y-1 font-mono text-[11px]">
            {entities.map((e) => (
              <li key={e.id} className="flex items-center justify-between border-b border-zinc-900 py-2">
                <span className="text-zinc-200">{e.entityId}</span>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">{e.horizon}</span>
                  <button
                    onClick={() => removeEntity(e.entityId)}
                    disabled={busy}
                    className="border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:bg-white/[0.02]"
                  >
                    unwatch
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border border-zinc-800 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          suppression rules
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={supKind}
            onChange={(e) => setSupKind(e.target.value as Suppression["kind"])}
            className="border border-zinc-800 bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300"
          >
            <option value="signal_type">signal_type</option>
            <option value="edge_type">edge_type</option>
            <option value="second_order_from">second_order_from</option>
          </select>
          <input
            value={supValue}
            onChange={(e) => setSupValue(e.target.value)}
            placeholder="value to suppress"
            className="flex-1 border border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            disabled={busy || !supValue.trim()}
            onClick={addSuppression}
            className="border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
          >
            add rule
          </button>
        </div>
        {suppressions.length > 0 && (
          <ul className="mt-3 space-y-1 font-mono text-[11px]">
            {suppressions.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b border-zinc-900 py-2">
                <span className="text-zinc-300">
                  <span className="text-zinc-500">{s.kind}</span> = {s.value}
                </span>
                <button
                  onClick={() => removeSuppression(s.id)}
                  disabled={busy}
                  className="border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:bg-white/[0.02]"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 border-t border-zinc-800 pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          impact chain
        </h2>
        {impact.length === 0 && (
          <div className="mt-4 border border-dashed border-zinc-800 p-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no fresh items — add an entity above
          </div>
        )}
        <ul className="mt-4 space-y-3">
          {impact.map((item) => (
            <li key={item.signalId} className="border border-zinc-900 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <span>
                  {new Date(item.publishedAt).toISOString().slice(0, 10)} ·{" "}
                  <span
                    className={item.deltaKind === "direct" ? "text-[var(--color-accent)]" : "text-zinc-400"}
                  >
                    {item.deltaKind}
                  </span>{" "}
                  {item.deltaKind === "second_order" && (
                    <span className={item.observed ? "text-emerald-400" : "text-amber-400"}>
                      · {item.observed ? "observed" : "inferred"}
                    </span>
                  )}
                </span>
                <span className="text-zinc-500">
                  {item.confidence} · pri {item.priority.toFixed(2)}
                </span>
              </div>
              <a
                href={`/signals/${item.signalSlug}`}
                className="mt-2 block text-sm text-zinc-200 hover:underline"
              >
                {item.signalType.replaceAll("_", " ")} · {item.subjectEntityId}
              </a>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">{item.why}</p>
              <div className="mt-2 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                <button
                  onClick={() => removeEntity(item.watchedEntityId)}
                  className="border border-zinc-800 px-2 py-0.5 text-zinc-500 hover:bg-white/[0.02]"
                >
                  unwatch {item.watchedEntityId}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
