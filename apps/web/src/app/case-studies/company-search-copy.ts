export function companySearchCopy(companyCount: number, lastUpdatedAt: string) {
  const updatedAt = lastUpdatedAt.slice(0, 19).replace('T', ' ');
  return {
    label: `search ${companyCount.toLocaleString()} companies`,
    freshness: `manually refreshed snapshot · last updated ${updatedAt} utc`,
  };
}
