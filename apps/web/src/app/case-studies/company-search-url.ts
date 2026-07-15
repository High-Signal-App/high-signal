export function companySearchHref(query: string, page = 1): string {
  const params = new URLSearchParams({ q: query.trim() });
  if (page > 1) params.set('page', String(page));
  return `/case-studies/search?${params.toString()}`;
}

export function parseCompanySearchPage(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue || !/^\d+$/.test(rawValue)) return 1;
  const page = Number(rawValue);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
