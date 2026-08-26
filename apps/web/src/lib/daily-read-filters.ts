import type { DailyBroadInsight } from '@/lib/daily-intelligence';
import type { LightweightDomain, LightweightSignalLayer } from '@high-signal/shared';

export type DailyReadFilters = {
  category?: string;
  layer?: LightweightSignalLayer | '';
  domain?: LightweightDomain | '';
  requirement?: boolean;
};

export function dailyReadMatches(item: DailyBroadInsight, filters: DailyReadFilters) {
  if (filters.category && item.contentCategory !== filters.category) return false;
  if (filters.layer && item.annotation.signalLayer !== filters.layer) return false;
  if (filters.domain && !item.annotation.domains.includes(filters.domain)) return false;
  if (filters.requirement && !item.annotation.productRequirement) return false;
  return true;
}
