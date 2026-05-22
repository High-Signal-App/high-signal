import type { DailyBroadInsight } from "@/lib/daily-intelligence";
import type { LightweightDomain, LightweightSignalLayer } from "@high-signal/shared";

export const READ_SIGNAL_LAYERS: Array<{ value: LightweightSignalLayer; label: string }> = [
  { value: "app-complaint", label: "app complaints" },
  { value: "world-change", label: "world changes" },
  { value: "market-watch", label: "market watch" },
  { value: "general", label: "general" },
];

export const READ_DOMAINS: Array<{ value: LightweightDomain; label: string }> = [
  { value: "agent-evaluation", label: "agent evaluation" },
  { value: "consumer", label: "consumer" },
  { value: "developer", label: "developer" },
  { value: "market", label: "market" },
  { value: "operations", label: "operations" },
  { value: "regional", label: "regional" },
  { value: "small-business", label: "small business" },
  { value: "startup", label: "startup" },
];

export type DailyReadFilters = {
  category?: string;
  layer?: LightweightSignalLayer | "";
  domain?: LightweightDomain | "";
  requirement?: boolean;
};

export function safeReadLayer(value?: string | null): LightweightSignalLayer | "" {
  return READ_SIGNAL_LAYERS.some((item) => item.value === value) ? (value as LightweightSignalLayer) : "";
}

export function safeReadDomain(value?: string | null): LightweightDomain | "" {
  return READ_DOMAINS.some((item) => item.value === value) ? (value as LightweightDomain) : "";
}

export function hasReadOnlyFilter(filters: DailyReadFilters) {
  return Boolean(filters.layer || filters.domain || filters.requirement);
}

export function dailyReadMatches(item: DailyBroadInsight, filters: DailyReadFilters) {
  if (filters.category && item.contentCategory !== filters.category) return false;
  if (filters.layer && item.annotation.signalLayer !== filters.layer) return false;
  if (filters.domain && !item.annotation.domains.includes(filters.domain)) return false;
  if (filters.requirement && !item.annotation.productRequirement) return false;
  return true;
}

export function dailyReadQuery(input: {
  date?: string | null;
  sourceDate?: string | null;
  category?: string | null;
  readCategory?: string | null;
  from?: string | null;
  to?: string | null;
  days?: number | string | null;
  layer?: string | null;
  domain?: string | null;
  requirement?: boolean | string | null;
  includeTasks?: boolean | string | null;
}) {
  const params = new URLSearchParams();
  if (input.date) params.set("date", input.date);
  if (input.sourceDate) params.set("sourceDate", input.sourceDate);
  if (input.category) params.set("category", input.category);
  if (input.readCategory) params.set("readCategory", input.readCategory);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.days) params.set("days", String(input.days));
  if (input.layer) params.set("layer", input.layer);
  if (input.domain) params.set("domain", input.domain);
  if (input.requirement === true || input.requirement === "yes") params.set("requirement", "yes");
  if (input.includeTasks === true || input.includeTasks === "yes") params.set("includeTasks", "yes");
  return params.toString();
}
