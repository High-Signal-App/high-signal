"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Phase = "idle" | "loading" | "copied" | "error";

interface Props {
  token: string;
}

/**
 * Inline "Promote to gazetteer" button for /unmapped candidates.
 * On click: fetches Wikidata-enriched data for the ticker, then copies
 * a fully-shaped ai_infra_entities.csv row to the clipboard. Paste into
 * the seed CSV, commit, next ingest run picks it up.
 */
export function PromoteButton({ token }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState<string | null>(null);

  async function onClick() {
    setPhase("loading");
    try {
      const data = await api.enrichTicker(token);
      // Best-effort clipboard write — falls back to alert() if not permitted.
      try {
        await navigator.clipboard.writeText(data.csvRow);
      } catch {
        window.prompt("Copy this row into ai_infra_entities.csv:", data.csvRow);
      }
      setName(data.enrichment.name);
      setPhase("copied");
      // Auto-revert after a few seconds so the button is reusable.
      window.setTimeout(() => setPhase("idle"), 2500);
    } catch {
      setPhase("error");
      window.setTimeout(() => setPhase("idle"), 2500);
    }
  }

  const label =
    phase === "loading"
      ? "enriching…"
      : phase === "copied"
        ? `copied${name ? ` (${name})` : ""}`
        : phase === "error"
          ? "failed"
          : "→ copy CSV row";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={phase === "loading"}
      className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
        phase === "copied"
          ? "border-emerald-700 text-emerald-300"
          : phase === "error"
            ? "border-red-700 text-red-300"
            : "border-zinc-700 text-zinc-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      } disabled:opacity-50`}
      title="Fetch Wikidata enrichment and copy an ai_infra_entities.csv row"
    >
      {label}
    </button>
  );
}
