import { describe, expect, it } from 'vitest';
import {
  composeNewsStories,
  hasBriefNewsTopic,
  hasUsableRetainedText,
  reportingWindow,
  selectNewsRecords,
  type NewsRecord,
} from '@high-signal/shared';

const window = reportingWindow('2026-09-11T12:00:00.000Z', new Date('2026-09-12T12:00:00.000Z'));
const title = 'Acorn launches enterprise analytics software';
const body =
  'Acorn announced its enterprise analytics software launch. The company confirmed availability and product specifications for business customers in its public announcement.';

function record(overrides: Partial<NewsRecord> = {}): NewsRecord {
  return {
    id: 'acorn-launch',
    source: 'news',
    sourceUrl: 'https://reuters.com/technology/acorn-launch',
    title,
    content: body,
    retainedText: body,
    primaryEntityId: 'acorn',
    publishedAt: '2026-09-12T08:00:00.000Z',
    ingestedAt: '2026-09-12T09:00:00.000Z',
    ...overrides,
  };
}

describe('composition-local retained body reuse', () => {
  it('reads an immutable article body once while retaining its reporting and citations', () => {
    let reads = 0;
    const article = Object.freeze({
      ...record(),
      get retainedText() {
        reads++;
        return body;
      },
    });
    const ownKeys = Reflect.ownKeys(article);

    const news = composeNewsStories([article], window);

    expect(news).toHaveLength(1);
    expect(news[0]?.title).toBe(title);
    expect(news[0]?.summary).toContain('Acorn announced');
    expect(news[0]?.source_references).toEqual([
      expect.objectContaining({ url: article.sourceUrl }),
    ]);
    expect(reads).toBe(1);
    expect(Reflect.ownKeys(article)).toEqual(ownKeys);
  });

  it('remembers an absent body without manufacturing reporting', () => {
    let reads = 0;
    const article = Object.freeze({
      ...record({ content: null }),
      get retainedText() {
        reads++;
        return null;
      },
    });

    expect(composeNewsStories([article], window)).toEqual([]);
    expect(reads).toBe(1);
  });

  it('keeps excluded sources lazy even when their unused body would throw', () => {
    const article = record({ source: 'market:polymarket' });
    Object.defineProperty(article, 'retainedText', {
      get() {
        throw new Error('Excluded body must not be read');
      },
    });

    expect(composeNewsStories([article], window)).toEqual([]);
  });

  it.each(['us-gov-api:noaa-weather', 'us-gov-api:cftc-cot'])(
    'preserves event-local content precedence for %s',
    (source) => {
      const article = record({ source });
      Object.defineProperty(article, 'retainedText', {
        get() {
          throw new Error('Unrelated shared document must not be read');
        },
      });

      const news = composeNewsStories([article], window);

      expect(news).toHaveLength(1);
      expect(news[0]?.summary).toContain('Acorn announced');
    }
  );

  it('rechecks replacement text on a later composition instead of retaining an earlier result', () => {
    const article = record();
    expect(composeNewsStories([article], window)).toHaveLength(1);

    article.retainedText = 'Verify you are human. Access denied.';

    expect(composeNewsStories([article], window)).toEqual([]);
  });

  it('preserves malformed-body errors and retries a failed read on a later invocation', () => {
    let reads = 0;
    const article = record();
    Object.defineProperty(article, 'retainedText', {
      get() {
        reads++;
        return 7;
      },
    });

    expect(() => composeNewsStories([article], window)).toThrow(TypeError);
    expect(() => composeNewsStories([article], window)).toThrow(TypeError);
    expect(reads).toBe(2);
  });

  it('keeps string bodies as text and missing bodies absent', () => {
    const stringBody = record({ retainedText: JSON.stringify({ article: body }) });
    const missingBody = record({ retainedText: undefined, content: undefined });

    expect(hasUsableRetainedText(stringBody)).toBe(true);
    expect(composeNewsStories([stringBody], window)).toHaveLength(1);
    expect(composeNewsStories([missingBody], window)).toEqual([]);
  });

  it('preserves exported filter callbacks and original selected record identities', () => {
    const article = Object.freeze(record());
    const excluded = Object.freeze(record({ id: 'excluded', source: 'market:polymarket' }));
    const noBody = Object.freeze(record({ id: 'empty', retainedText: null, content: null }));
    const records = [excluded, noBody, article];

    expect(records.filter(hasBriefNewsTopic)).toEqual([noBody, article]);
    expect(records.filter(hasUsableRetainedText)).toEqual([excluded, article]);
    const selected = selectNewsRecords(records, window);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(article);
  });

  it('preserves old/fresh evidence selection and the changed-reporting summary', () => {
    let reads = 0;
    const older = record({
      id: 'old',
      sourceUrl: 'https://reuters.com/technology/acorn-prior',
      publishedAt: '2026-09-11T08:00:00.000Z',
      ingestedAt: '2026-09-11T09:00:00.000Z',
    });
    const fresh = record();
    for (const article of [older, fresh]) {
      Object.defineProperty(article, 'retainedText', {
        get() {
          reads++;
          return body;
        },
      });
      Object.freeze(article);
    }

    const news = composeNewsStories([older, fresh], window);

    expect(news).toHaveLength(1);
    expect(news[0]?.what_changed).toContain('Acorn announced');
    expect(news[0]?.source_references).toHaveLength(2);
    expect(reads).toBe(2);
  });

  it('keeps reporting and trust gates intact after the body memo reaches its text budget', () => {
    let lateReads = 0;
    const articles = Array.from({ length: 60 }, (_, index) => {
      const company = `Acorn${index}`;
      return Object.freeze(
        record({
          id: `long-${index}`,
          title: `${company} launches enterprise analytics software`,
          primaryEntityId: company.toLowerCase(),
          sourceUrl: `https://reuters.com/technology/acorn-${index}`,
          retainedText: `${company} announced its enterprise analytics software launch. ${body.repeat(200)}`,
        })
      );
    });
    const excluded = record({ id: 'blocked-after-budget', title: 'Blocked launches software' });
    excluded.retainedText = 'Access denied. Verify you are human.';
    const late = record({
      id: 'late',
      title: 'Latecomer launches enterprise analytics software',
      primaryEntityId: 'latecomer',
      sourceUrl: 'https://reuters.com/technology/latecomer',
    });
    Object.defineProperty(late, 'retainedText', {
      get() {
        lateReads++;
        return `Latecomer announced its enterprise analytics software launch. ${body.repeat(200)}`;
      },
    });

    const news = composeNewsStories([...articles, excluded, late], window);

    expect(news).toHaveLength(61);
    expect(news.some((story) => story.title === excluded.title)).toBe(false);
    expect(news.find((story) => story.title === late.title)?.source_references).toEqual([
      expect.objectContaining({ url: late.sourceUrl }),
    ]);
    expect(lateReads).toBeGreaterThan(1);
  });
});
