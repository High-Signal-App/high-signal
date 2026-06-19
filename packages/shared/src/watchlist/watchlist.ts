export type WatchlistSurface = "mentions" | "communities" | "markets";
export type WatchlistPriority = "critical" | "high" | "medium" | "low";
export type WatchlistStatus = "new" | "watching" | "actionable" | "done";

export interface WatchlistItem {
  id: string;
  surface: WatchlistSurface;
  title: string;
  summary: string;
  href: string;
  priority: WatchlistPriority;
  status: WatchlistStatus;
  sourceLabel: string;
  action: string;
  evidenceCount: number;
  observedAt: string;
}

export interface WatchlistCollection {
  id: string;
  title: string;
  surface: WatchlistSurface;
  description: string;
  items: WatchlistItem[];
}

export interface ActionDigestItem {
  id: string;
  title: string;
  action: string;
  priority: WatchlistPriority;
  href: string;
  surface: WatchlistSurface;
  reason: string;
}

export interface WatchlistDigest {
  totalItems: number;
  actionableItems: number;
  criticalItems: number;
  staleItems: number;
  topActions: ActionDigestItem[];
  collections: WatchlistCollection[];
}

const priorityWeight: Record<WatchlistPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function daysSince(value: string, now: Date) {
  const observedAt = new Date(value);
  if (Number.isNaN(observedAt.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((now.getTime() - observedAt.getTime()) / 86_400_000);
}

function statusWeight(status: WatchlistStatus) {
  if (status === "actionable") return 3;
  if (status === "new") return 2;
  if (status === "watching") return 1;
  return 0;
}

function actionReason(item: WatchlistItem, now: Date) {
  const age = daysSince(item.observedAt, now);
  const ageLabel = Number.isFinite(age) ? `${age}d old` : "undated";
  return `${item.sourceLabel} / ${item.evidenceCount} source${item.evidenceCount === 1 ? "" : "s"} / ${ageLabel}`;
}

export function buildWatchlistDigest(
  collections: WatchlistCollection[],
  options: { now?: Date; staleAfterDays?: number; maxActions?: number } = {},
): WatchlistDigest {
  const now = options.now ?? new Date();
  const staleAfterDays = options.staleAfterDays ?? 14;
  const maxActions = options.maxActions ?? 6;
  const items = collections.flatMap((collection) => collection.items);
  const activeItems = items.filter((item) => item.status !== "done");
  const staleItems = activeItems.filter((item) => daysSince(item.observedAt, now) > staleAfterDays);
  const topActions = activeItems
    .filter((item) => item.status === "actionable" || item.priority === "critical" || item.priority === "high")
    .sort((a, b) => {
      const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDelta !== 0) return priorityDelta;
      const statusDelta = statusWeight(b.status) - statusWeight(a.status);
      if (statusDelta !== 0) return statusDelta;
      return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
    })
    .slice(0, maxActions)
    .map((item) => ({
      id: item.id,
      title: item.title,
      action: item.action,
      priority: item.priority,
      href: item.href,
      surface: item.surface,
      reason: actionReason(item, now),
    }));

  return {
    totalItems: activeItems.length,
    actionableItems: activeItems.filter((item) => item.status === "actionable").length,
    criticalItems: activeItems.filter((item) => item.priority === "critical").length,
    staleItems: staleItems.length,
    topActions,
    collections: collections.map((collection) => ({
      ...collection,
      items: [...collection.items].sort((a, b) => {
        const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
      }),
    })),
  };
}
