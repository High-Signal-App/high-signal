"use client";

import { useEffect, useMemo, useState } from "react";
import type { SignalRow, ClaimRecordJson, ClaimEvidenceLinkJson, ClaimRollupJson } from "@/lib/api";
import { DirectionPill } from "@/components/atoms/DirectionPill";
import { ConfidenceBadge } from "@/components/atoms/ConfidenceBadge";
import { MarkdownView } from "@/components/system/MarkdownView";

const API_BASE =
  process.env["NEXT_PUBLIC_API_BASE"] ?? "https://high-signal-api.sarthakagrawal927.workers.dev";

type Status = "draft" | "published" | "corrected";

type ClaimWithEvidence = ClaimRecordJson & {
  evidence: ClaimEvidenceLinkJson[];
  rollup: ClaimRollupJson;
};

type ClaimEvidenceRole = ClaimEvidenceLinkJson["role"];

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
      const r = await fetch(`${API_BASE}/signals?status=${status}&limit=200`);
      const j = (await r.json()) as { signals: SignalRow[] };
      setSignals(j.signals);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function adminFetch(url: string, init: RequestInit): Promise<Response | null> {
    setErr(null);
    const r = await fetch(url, { ...init, credentials: "include" });
    if (r.status === 401 || r.status === 403) {
      setErr("not authorized — sign in with a Clerk account that is allowed to review signals");
      return null;
    }
    if (!r.ok) {
      setErr(`${init.method ?? "GET"} ${r.status}`);
      return null;
    }
    return r;
  }

  async function patch(slug: string, body: Record<string, unknown>) {
    setBusy(slug);
    try {
      const r = await adminFetch(`/api/admin/signals/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r) await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function destroy(slug: string) {
    if (!window.confirm(`delete ${slug}? this is permanent`)) return;
    setBusy(slug);
    try {
      const r = await adminFetch(`/api/admin/signals/${slug}`, { method: "DELETE" });
      if (r) await refresh();
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
            onErr={setErr}
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
  onErr,
  onPublish,
  onDraft,
  onCorrected,
  onDelete,
}: {
  s: SignalRow;
  busy: boolean;
  onErr: (e: string | null) => void;
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

      <ProvenancePanel slug={s.slug} onErr={onErr} />

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

function ProvenancePanel({ slug, onErr }: { slug: string; onErr: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [claims, setClaims] = useState<ClaimWithEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [newAssertion, setNewAssertion] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/claims/by-signal/${slug}`);
      const j = (await r.json()) as { claims: ClaimWithEvidence[] };
      setClaims(j.claims);
    } catch (e) {
      onErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function adminPost(url: string, body: unknown): Promise<Response | null> {
    onErr(null);
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      onErr(await formatErr(url, r));
      return null;
    }
    return r;
  }

  async function adminDelete(url: string): Promise<Response | null> {
    onErr(null);
    const r = await fetch(url, { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      onErr(await formatErr(url, r));
      return null;
    }
    return r;
  }

  async function formatErr(url: string, r: Response): Promise<string> {
    try {
      const payload = (await r.clone().json()) as { error?: string; reason?: string };
      const parts = [payload.error, payload.reason].filter(Boolean).join(" — ");
      if (parts) return `${url} ${r.status}: ${parts}`;
    } catch {
      // body wasn't JSON; fall through to bare status
    }
    return `${url} ${r.status}`;
  }

  async function createClaim() {
    if (!newAssertion.trim()) return;
    setBusy(true);
    const r = await adminPost("/api/admin/claims", {
      surface: "signal",
      signalSlug: slug,
      assertion: newAssertion.trim(),
    });
    setBusy(false);
    if (r) {
      setNewAssertion("");
      await load();
    }
  }

  async function addEvidence(claimId: string, url: string, role: ClaimEvidenceRole) {
    if (!url.trim()) return;
    setBusy(true);
    const r = await adminPost(`/api/admin/claims/${claimId}/evidence`, {
      url: url.trim(),
      role,
    });
    setBusy(false);
    if (r) await load();
  }

  async function removeEvidence(claimId: string, linkId: string) {
    setBusy(true);
    const r = await adminDelete(`/api/admin/claims/${claimId}/evidence/${linkId}`);
    setBusy(false);
    if (r) await load();
  }

  async function setStatus(claimId: string, status: ClaimRecordJson["reviewStatus"], reason?: string) {
    setBusy(true);
    const r = await adminPost(`/api/admin/claims/${claimId}/status`, { status, reason });
    setBusy(false);
    if (r) await load();
  }

  async function fileCorrection(claimId: string) {
    const assertion = window.prompt("corrected assertion:");
    if (!assertion?.trim()) return;
    const reason = window.prompt("why is this a correction? (optional)") ?? undefined;
    setBusy(true);
    const r = await adminPost(`/api/admin/claims/${claimId}/corrections`, {
      assertion: assertion.trim(),
      reason,
    });
    setBusy(false);
    if (r) await load();
  }

  return (
    <details className="mt-3 border border-zinc-900 p-3" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:text-zinc-200">
        claim provenance {claims.length > 0 && <span className="nums text-zinc-500">({claims.length})</span>}
      </summary>
      {loading && <div className="mt-3 font-mono text-[10px] text-zinc-500">loading…</div>}

      {open && (
        <div className="mt-3 space-y-3">
          {claims.length === 0 && !loading && (
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              no claims yet — every assertion in this signal should map to one row
            </div>
          )}

          {claims.map((claim) => (
            <ClaimEditor
              key={claim.id}
              claim={claim}
              busy={busy}
              onAddEvidence={(url, role) => addEvidence(claim.id, url, role)}
              onRemoveEvidence={(linkId) => removeEvidence(claim.id, linkId)}
              onSetStatus={(status, reason) => setStatus(claim.id, status, reason)}
              onFileCorrection={() => fileCorrection(claim.id)}
            />
          ))}

          <div className="border-t border-zinc-900 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newAssertion}
                onChange={(e) => setNewAssertion(e.target.value)}
                placeholder="new atomic claim — one assertion per row"
                className="flex-1 border border-zinc-800 bg-transparent px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
              <button
                disabled={busy || !newAssertion.trim()}
                onClick={createClaim}
                className="border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
              >
                add claim
              </button>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}

function ClaimEditor({
  claim,
  busy,
  onAddEvidence,
  onRemoveEvidence,
  onSetStatus,
  onFileCorrection,
}: {
  claim: ClaimWithEvidence;
  busy: boolean;
  onAddEvidence: (url: string, role: ClaimEvidenceRole) => void;
  onRemoveEvidence: (linkId: string) => void;
  onSetStatus: (status: ClaimRecordJson["reviewStatus"], reason?: string) => void;
  onFileCorrection: () => void;
}) {
  const [url, setUrl] = useState("");
  const [role, setRole] = useState<ClaimEvidenceRole>("primary");
  const frozen = claim.reviewStatus === "published" || claim.reviewStatus === "corrected";
  const contradiction = claim.rollup.contradiction > 0;

  return (
    <div className="border border-zinc-900 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          claim · v{claim.version} ·{" "}
          <span className={claim.reviewStatus === "published" ? "text-emerald-400" : "text-zinc-300"}>
            {claim.reviewStatus}
          </span>
        </div>
        <div className="font-mono text-[10px] text-zinc-500">
          P{claim.rollup.primary} · C{claim.rollup.corroboration} · X{claim.rollup.contradiction} · ctx
          {claim.rollup.context}
        </div>
      </div>
      <div className="mt-2 text-sm text-zinc-200">{claim.assertion}</div>

      {contradiction && (
        <div className="mt-2 border border-amber-500/40 bg-amber-500/[0.05] p-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
          contradiction recorded — resolve before publish
        </div>
      )}

      {claim.evidence.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-[10px]">
          {claim.evidence.map((link) => (
            <li key={link.id} className="flex items-center gap-2">
              <span
                className={`border px-1.5 py-0.5 uppercase tracking-[0.18em] ${roleTone(link.role)}`}
              >
                {link.role}
              </span>
              <a
                href={link.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-zinc-300 hover:underline"
              >
                {link.evidenceUrl}
              </a>
              {!frozen && (
                <button
                  onClick={() => onRemoveEvidence(link.id)}
                  disabled={busy}
                  className="border border-zinc-800 px-1.5 py-0.5 text-zinc-500 hover:bg-white/[0.02] disabled:opacity-30"
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!frozen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="evidence url"
            className="flex-1 border border-zinc-800 bg-transparent px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ClaimEvidenceRole)}
            className="border border-zinc-800 bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300"
          >
            <option value="primary">primary</option>
            <option value="corroboration">corroboration</option>
            <option value="contradiction">contradiction</option>
            <option value="context">context</option>
          </select>
          <button
            disabled={busy || !url.trim()}
            onClick={() => {
              onAddEvidence(url, role);
              setUrl("");
            }}
            className="border border-zinc-700 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
          >
            add evidence
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        {claim.reviewStatus !== "published" && claim.reviewStatus !== "corrected" && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("publish reason (e.g. ≥2 primary, expert-judge):") ?? undefined;
                onSetStatus("published", reason);
              }}
              className="border border-emerald-500/40 px-3 py-1 text-emerald-300 hover:bg-emerald-500/[0.05] disabled:opacity-30"
            >
              publish claim
            </button>
            <button
              disabled={busy}
              onClick={() => onSetStatus("held")}
              className="border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
            >
              hold
            </button>
            <button
              disabled={busy}
              onClick={() => onSetStatus("killed")}
              className="border border-rose-500/40 px-3 py-1 text-rose-300 hover:bg-rose-500/[0.05] disabled:opacity-30"
            >
              kill
            </button>
          </>
        )}
        {claim.reviewStatus === "published" && (
          <button
            disabled={busy}
            onClick={onFileCorrection}
            className="border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-white/[0.02] disabled:opacity-30"
          >
            file correction
          </button>
        )}
      </div>
    </div>
  );
}

function roleTone(role: ClaimEvidenceRole): string {
  if (role === "primary") return "border-emerald-500/40 text-emerald-300";
  if (role === "corroboration") return "border-cyan-500/40 text-cyan-300";
  if (role === "contradiction") return "border-amber-500/40 text-amber-300";
  return "border-zinc-700 text-zinc-400";
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
