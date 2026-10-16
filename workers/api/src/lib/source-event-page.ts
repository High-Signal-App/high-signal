import type { KeysetCursor } from './cursor';

const MAX_PAGE_SOURCES = 90;

export interface SourceEventPageRow {
  id: string;
  title: string | null;
  content: string | null;
  url: string;
  source: string;
  entity: string | null;
  publishedAt: number | Date;
}

/** Compare index + key lookups with the estimated time-order walk to this offset. */
export function sourcePageWorthResolving(
  sourceCount: number | null,
  familyRows: number,
  allRows: number | null,
  pageSize: number
) {
  return (
    sourceCount !== null &&
    sourceCount > 1 &&
    sourceCount <= MAX_PAGE_SOURCES &&
    allRows !== null &&
    allRows >= familyRows &&
    familyRows > 0 &&
    Number.isSafeInteger(pageSize) &&
    pageSize > 0 &&
    familyRows * 2 <= (allRows / familyRows) * pageSize
  );
}

/** Sort source-scoped keys, then load payloads for only the selected page. */
export function sourceKeyPagePlan(
  sources: readonly string[] | null,
  input: {
    limit: number;
    offset: number;
    range: { start: Date; end: Date } | null;
    cursor: KeysetCursor | null;
  }
) {
  const { limit, offset, range, cursor } = input;
  if (
    !sources ||
    sources.length < 2 ||
    sources.length > MAX_PAGE_SOURCES ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return null;
  // Reuse bounds across the predicate; at most 6 + 90 parameters fit D1's cap.
  const params: Array<string | number | null> = [
    limit + 1,
    offset,
    range ? Math.floor(range.start.getTime() / 1000) : null,
    range ? Math.floor(range.end.getTime() / 1000) : null,
    cursor?.publishedAt ?? null,
    cursor?.id ?? null,
    ...sources,
  ];
  const predicates = [
    `source IN (${sources.map((_, index) => `?${index + 7}`).join(',')})`,
    ...(range ? ['published_at >= ?3 AND published_at < ?4'] : []),
    ...(cursor ? ['(published_at < ?5 OR (published_at = ?5 AND id < ?6))'] : []),
  ];
  return {
    params,
    query: `WITH page AS (
    SELECT id, published_at FROM events WHERE ${predicates.join(' AND ')}
    ORDER BY published_at DESC, id DESC LIMIT ?1 OFFSET ?2
  )
  SELECT events.id, events.title, events.content, events.source_url AS url,
    events.source, events.primary_entity_id AS entity, page.published_at AS publishedAt
  FROM page JOIN events ON events.id = page.id
  ORDER BY page.published_at DESC, page.id DESC`,
  };
}
