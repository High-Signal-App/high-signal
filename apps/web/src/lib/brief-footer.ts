import type { BriefSnapshot } from '@high-signal/shared';

/** Presentation only: consume the already-qualified edition, never fetch or qualify here. */
export function briefFooterMode(brief: BriefSnapshot): 'full' | 'compact' {
  const unavailable = Object.values(brief.categoryStates ?? {}).some(
    (state) => state.status === 'unavailable'
  );
  const count =
    brief.stocks.length + brief.ideas.length + brief.trends.length + (brief.news?.length ?? 0);
  return brief.publishStatus === 'published' && count > 0 && !unavailable ? 'full' : 'compact';
}
