// Plan 0010 — pure impact-chain composer helpers.
// The worker assembles raw rows from D1; these helpers do the per-watchlist
// scoring, suppression filtering, and observed-vs-inferred labelling so the
// composer and unit tests share the same definitions.

// `source` was intentionally dropped (2026-06-12 review): schema.signals has no
// source column today, and toSignal in the worker hardcodes source=null, so the
// rule was a silent no-op. Reintroduce once a signal-level source field exists.
export type SuppressionKind =
  | "signal_type"
  | "edge_type"
  | "second_order_from";

export interface SuppressionRule {
  kind: SuppressionKind;
  value: string;
}

export type RelationshipEdgeType =
  | "supplier"
  | "customer"
  | "peer"
  | "subsidiary"
  | "partner"
  | "competitor";

export interface RelationshipEdge {
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipEdgeType;
  weight: number;
  verified: boolean;
}

export interface SignalForWatch {
  id: string;
  slug: string;
  signalType: string;
  primaryEntityId: string;
  confidence: "low" | "medium" | "high";
  publishedAt: string;
}

export interface WatchItem {
  signalId: string;
  signalSlug: string;
  signalType: string;
  watchedEntityId: string;
  subjectEntityId: string;
  deltaKind: "direct" | "second_order";
  relationshipPath: Array<{
    fromEntityId: string;
    toEntityId: string;
    type: RelationshipEdgeType;
  }>;
  observed: boolean;
  priority: number;
  confidence: "low" | "medium" | "high";
  publishedAt: string;
  why: string;
}

const CONFIDENCE_WEIGHT: Record<SignalForWatch["confidence"], number> = {
  low: 0.4,
  medium: 0.7,
  high: 1.0,
};

const EDGE_WEIGHT: Record<RelationshipEdgeType, number> = {
  supplier: 0.9,
  customer: 0.9,
  peer: 0.6,
  subsidiary: 1.0,
  partner: 0.7,
  competitor: 0.7,
};

export function isSuppressed(
  item: {
    signalType: string;
    relationshipPath: WatchItem["relationshipPath"];
    deltaKind: "direct" | "second_order";
    watchedEntityId: string;
  },
  rules: SuppressionRule[],
): boolean {
  for (const r of rules) {
    if (r.kind === "signal_type" && r.value === item.signalType) return true;
    if (r.kind === "edge_type" && item.relationshipPath.some((p) => p.type === r.value)) return true;
    if (
      r.kind === "second_order_from" &&
      item.deltaKind === "second_order" &&
      r.value === item.watchedEntityId
    ) {
      return true;
    }
  }
  return false;
}

export interface ComposeArgs {
  watchedEntityIds: string[];
  directSignals: SignalForWatch[]; // primary_entity_id ∈ watched
  edges: RelationshipEdge[]; // from_entity_id ∈ watched
  secondOrderSignals: SignalForWatch[]; // primary_entity_id ∈ edges.to
  suppressions: SuppressionRule[];
  alreadySurfacedSignalIds: Set<string>;
  nowMs: number;
}

// Compose the watching section. Returns the list of fresh items in priority
// order; alreadySurfacedSignalIds keeps the user from re-seeing items they've
// already had surfaced.
export function composeImpactChain(args: ComposeArgs): WatchItem[] {
  const watchedSet = new Set(args.watchedEntityIds);
  const edgeIndex = new Map<string, RelationshipEdge[]>();
  for (const e of args.edges) {
    const list = edgeIndex.get(e.toEntityId) ?? [];
    list.push(e);
    edgeIndex.set(e.toEntityId, list);
  }
  const items: WatchItem[] = [];

  for (const s of args.directSignals) {
    if (args.alreadySurfacedSignalIds.has(s.id)) continue;
    if (!watchedSet.has(s.primaryEntityId)) continue;
    const recency = recencyWeight(s.publishedAt, args.nowMs);
    const priority = CONFIDENCE_WEIGHT[s.confidence] * recency;
    const item: WatchItem = {
      signalId: s.id,
      signalSlug: s.slug,
      signalType: s.signalType,
      watchedEntityId: s.primaryEntityId,
      subjectEntityId: s.primaryEntityId,
      deltaKind: "direct",
      relationshipPath: [],
      observed: true,
      priority,
      confidence: s.confidence,
      publishedAt: s.publishedAt,
      why: `direct: ${s.primaryEntityId} is on your watchlist`,
    };
    if (isSuppressed(item, args.suppressions)) continue;
    items.push(item);
  }

  for (const s of args.secondOrderSignals) {
    if (args.alreadySurfacedSignalIds.has(s.id)) continue;
    const subject = s.primaryEntityId;
    const incoming = edgeIndex.get(subject) ?? [];
    if (incoming.length === 0) continue;
    // Best-edge selection: highest weight × edge_type weight.
    let best: RelationshipEdge | null = null;
    let bestScore = -Infinity;
    for (const e of incoming) {
      if (!watchedSet.has(e.fromEntityId)) continue;
      const score = (e.weight || 1) * EDGE_WEIGHT[e.type];
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) continue;
    const recency = recencyWeight(s.publishedAt, args.nowMs);
    const observed = best.verified;
    const observedFactor = observed ? 1.0 : 0.5;
    const priority = CONFIDENCE_WEIGHT[s.confidence] * recency * bestScore * observedFactor;
    const item: WatchItem = {
      signalId: s.id,
      signalSlug: s.slug,
      signalType: s.signalType,
      watchedEntityId: best.fromEntityId,
      subjectEntityId: subject,
      deltaKind: "second_order",
      relationshipPath: [
        {
          fromEntityId: best.fromEntityId,
          toEntityId: best.toEntityId,
          type: best.type,
        },
      ],
      observed,
      priority,
      confidence: s.confidence,
      publishedAt: s.publishedAt,
      why: `${best.fromEntityId} is ${observed ? "observed" : "inferred"} ${best.type} of ${subject}`,
    };
    if (isSuppressed(item, args.suppressions)) continue;
    items.push(item);
  }

  items.sort((a, b) => b.priority - a.priority);
  return items;
}

function recencyWeight(publishedAt: string, nowMs: number): number {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0.2;
  const ageDays = Math.max(0, (nowMs - t) / (24 * 3600 * 1000));
  if (ageDays <= 1) return 1.0;
  if (ageDays <= 7) return 0.7;
  if (ageDays <= 30) return 0.4;
  return 0.2;
}
