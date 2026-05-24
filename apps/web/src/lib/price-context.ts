import priceContext from "../data/price-context.json";
import type { Direction } from "./api";

export type PricedInStatus = "fresh" | "partly-priced" | "priced-in" | "unknown";

export interface PriceContextRow {
  entityId: string;
  ticker: string;
  name: string;
  source: "yahoo";
  sourceUrl: string;
  asOf: string;
  currentPrice: number;
  move1d: number | null;
  move7d: number | null;
  move30d: number | null;
  move45d: number | null;
  move90d: number | null;
  historyDays: number;
}

export interface PricedInContext {
  status: PricedInStatus;
  label: string;
  reason: string;
  price: PriceContextRow | null;
}

const rows = (priceContext.rows as PriceContextRow[]).filter((row) => row.entityId && row.ticker);
const byEntity = new Map(rows.map((row) => [row.entityId, row]));

function formatPct(value: number | null) {
  if (value === null) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

function strongestMove(row: PriceContextRow, direction: Direction) {
  if (direction === "down") {
    const moves = [row.move30d, row.move45d, row.move90d].filter((value): value is number => value !== null);
    return moves.length ? Math.min(...moves) : null;
  }
  const moves = [row.move30d, row.move45d, row.move90d].filter((value): value is number => value !== null);
  return moves.length ? Math.max(...moves) : null;
}

export function pricedInTone(status: PricedInStatus) {
  if (status === "priced-in") return "border-amber-400/50 text-amber-300";
  if (status === "partly-priced") return "border-zinc-600 text-zinc-300";
  if (status === "fresh") return "border-[var(--color-accent)] text-[var(--color-accent)]";
  return "border-zinc-800 text-zinc-600";
}

export function pricedInContext(entityId: string, direction: Direction): PricedInContext {
  const row = byEntity.get(entityId);
  if (!row) {
    return {
      status: "unknown",
      label: "price unknown",
      reason: "No Yahoo price snapshot is bundled for this entity yet.",
      price: null,
    };
  }

  const move = strongestMove(row, direction);
  if (move === null) {
    return {
      status: "unknown",
      label: "price unknown",
      reason: `${row.ticker} has a Yahoo snapshot but not enough daily history for a priced-in check.`,
      price: row,
    };
  }

  if (direction === "down") {
    if (move <= -30) {
      return {
        status: "priced-in",
        label: "priced in",
        reason: `${row.ticker} is already down ${formatPct(move)} over the recent 30-90 day window.`,
        price: row,
      };
    }
    if (move <= -12) {
      return {
        status: "partly-priced",
        label: "partly priced",
        reason: `${row.ticker} has already moved down ${formatPct(move)} over the recent 30-90 day window.`,
        price: row,
      };
    }
  }

  if (direction === "up") {
    if (move >= 80) {
      return {
        status: "priced-in",
        label: "priced in",
        reason: `${row.ticker} is already up ${formatPct(move)} over the recent 30-90 day window.`,
        price: row,
      };
    }
    if (move >= 25) {
      return {
        status: "partly-priced",
        label: "partly priced",
        reason: `${row.ticker} has already moved up ${formatPct(move)} over the recent 30-90 day window.`,
        price: row,
      };
    }
  }

  return {
    status: "fresh",
    label: "not priced in",
    reason: `${row.ticker} has not made a large direction-matching 30-90 day move yet.`,
    price: row,
  };
}
