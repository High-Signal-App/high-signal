import { describe, expect, it } from 'vitest';
import { briefNewsPageHref, paginateBriefNews, type BriefNewsItem } from '@high-signal/shared';

const news: BriefNewsItem[] = Array.from({ length: 45 }, (_, index) => ({
  id: `story-${index}`,
  title: `Retained news story ${index}`,
  summary: 'A source-backed report with retained details.',
  event_at: '2026-10-23T10:00:00Z',
  what_changed: '',
  evidence_status: 'reported',
  source_references: [{ url: `https://example.com/story-${index}` }],
}));

describe('Daily Brief news pages', () => {
  it('keeps every ranked story accessible without duplication between pages', () => {
    const pages = ['1', '2', '3'].map((requestedPage) =>
      paginateBriefNews({ news, requestedPage })
    );
    expect(pages.map(({ items }) => items.length)).toEqual([20, 20, 5]);
    expect(pages.flatMap(({ items }) => items)).toEqual(news);
    expect(pages.map(({ from, to }) => [from, to])).toEqual([
      [1, 20],
      [21, 40],
      [41, 45],
    ]);
    expect(pages.every(({ total, pageCount }) => total === 45 && pageCount === 3)).toBe(true);
  });

  it('does not pad quiet or empty editions', () => {
    const quiet = paginateBriefNews({ news: news.slice(0, 3) });
    expect(quiet.items).toEqual(news.slice(0, 3));
    expect(quiet.pageCount).toBe(1);
    expect(paginateBriefNews({ news: [] })).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
    });
  });

  it('bounds invalid, duplicate, and out-of-range query values', () => {
    for (const requestedPage of ['0', '-1', '1.5', '1e2', 'invalid', ['2'], '9'.repeat(40)]) {
      expect(paginateBriefNews({ news, requestedPage }).page).toBe(1);
    }
    expect(paginateBriefNews({ news, requestedPage: '999' }).page).toBe(3);
  });

  it('preserves edition and region when moving between pages', () => {
    expect(briefNewsPageHref({ page: 2, region: 'europe', day: 'yesterday' })).toBe(
      '/?region=europe&day=yesterday&news_page=2#news'
    );
    expect(briefNewsPageHref({ page: 1, region: 'global', day: 'today' })).toBe('/#news');
    expect(briefNewsPageHref({ page: 2, region: 'global', day: 'today' })).toBe(
      '/?news_page=2#news'
    );
  });
});
