import { describe, expect, it } from 'vitest';
import {
  clusterNewsRecords,
  composeNewsStories,
  hasUsableRetainedText,
  reportingWindow,
  selectNewsRecords,
  type NewsRecord,
} from '@high-signal/shared';

const WINDOW_END = new Date('2026-09-12T12:00:00.000Z');
const WINDOW = reportingWindow(new Date('2026-09-11T12:00:00.000Z'), WINDOW_END);

function record(
  overrides: Partial<NewsRecord> & Pick<NewsRecord, 'id' | 'title' | 'sourceUrl'>
): NewsRecord {
  const title = overrides.title ?? '';
  const body =
    overrides.retainedText ??
    `${title}. The company confirmed the operational details in a retained excerpt covering timeline, counterparties, and next steps for readers.`;
  return {
    source: 'news',
    publishedAt: '2026-09-12T08:00:00.000Z',
    ingestedAt: '2026-09-12T09:00:00.000Z',
    content: body,
    retainedText: body,
    primaryEntityId: null,
    ...overrides,
    title,
  };
}

describe('reportingWindow', () => {
  it('uses the previous successful snapshot, else 24 hours', () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const prior = reportingWindow('2026-09-11T03:30:00.000Z', now);
    expect(prior.start.toISOString()).toBe('2026-09-11T03:30:00.000Z');
    expect(prior.previousSnapshotAt?.toISOString()).toBe('2026-09-11T03:30:00.000Z');
    const fallback = reportingWindow(null, now);
    expect(now.getTime() - fallback.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('selectNewsRecords', () => {
  it('drops older stories unless new in-window evidence arrives', () => {
    const older = record({
      id: 'old',
      title: 'Acme closes Mesa plant purchase',
      sourceUrl: 'https://reuters.com/acme-mesa',
      ingestedAt: '2026-09-10T10:00:00.000Z',
      publishedAt: '2026-09-10T09:00:00.000Z',
    });
    const repeat = record({
      id: 'repeat',
      title: 'Acme closes Mesa plant purchase',
      sourceUrl: 'https://reuters.com/acme-mesa?utm_source=rss',
      ingestedAt: '2026-09-12T09:00:00.000Z',
    });
    const update = record({
      id: 'update',
      title: 'Acme closes Mesa plant purchase',
      sourceUrl: 'https://sec.gov/archives/acme-8k',
      source: 'edgar_8k',
      ingestedAt: '2026-09-12T10:00:00.000Z',
    });
    expect(selectNewsRecords([older, repeat], WINDOW).map((item) => item.id)).toEqual([]);
    expect(
      selectNewsRecords([older, update], WINDOW)
        .map((item) => item.id)
        .sort()
    ).toEqual(['old', 'update']);
  });

  it('rejects headline-only and paywall text', () => {
    expect(
      hasUsableRetainedText({
        title: 'Big headline without a body',
        content: 'Big headline without a body',
        retainedText: 'Big headline without a body',
      })
    ).toBe(false);
    expect(
      hasUsableRetainedText({
        title: 'Exclusive investigation',
        content: 'Please log in to continue reading this article.',
        retainedText: 'Please log in to continue reading this article.',
      })
    ).toBe(false);
  });
});

describe('clusterNewsRecords', () => {
  it('merges duplicate coverage of the same announcement and keeps same-company events apart', () => {
    const wire = record({
      id: 'wire',
      title: 'OpenAI launches GPT-6 model for enterprise customers',
      sourceUrl: 'https://openai.com/index/gpt-6',
      source: 'ir',
    });
    const reprint = record({
      id: 'reprint',
      title: 'OpenAI launches GPT-6 model for enterprise',
      sourceUrl: 'https://techmeme.com/story/gpt6',
      source: 'techmeme',
      content: 'Link: https://openai.com/index/gpt-6',
      retainedText:
        'OpenAI launches GPT-6 model for enterprise customers. The product is available to API customers this week after a staged rollout.',
    });
    const earnings = record({
      id: 'earnings',
      title: 'OpenAI reports quarterly earnings beat on API demand',
      sourceUrl: 'https://reuters.com/openai-earnings',
      primaryEntityId: 'openai',
    });
    const deal = record({
      id: 'deal',
      title: 'OpenAI acquires chip designer for inference expansion',
      sourceUrl: 'https://bloomberg.com/openai-acquire',
      primaryEntityId: 'openai',
    });

    const [announcement] = clusterNewsRecords([wire, reprint]);
    expect(announcement.map((item) => item.id).sort()).toEqual(['reprint', 'wire']);

    const split = clusterNewsRecords([earnings, deal]);
    expect(split).toHaveLength(2);
  });
});

describe('composeNewsStories', () => {
  it('replays a day of retained records through the news composer', () => {
    const stories = composeNewsStories(
      [
        record({
          id: 'ann-1',
          title: 'Nvidia launches Blackwell Ultra for hyperscalers',
          sourceUrl: 'https://nvidianews.nvidia.com/news/blackwell-ultra',
          source: 'ir',
          retainedText:
            'Nvidia launched Blackwell Ultra accelerators for hyperscale buyers. The cards begin shipping to cloud providers in the current quarter under existing supply contracts.',
        }),
        record({
          id: 'ann-2',
          title: 'Nvidia launches Blackwell Ultra for hyperscalers',
          sourceUrl: 'https://reuters.com/nvidia-blackwell-ultra',
          retainedText:
            'Nvidia launched Blackwell Ultra accelerators for hyperscale buyers. Reuters confirmed the shipping window matches the issuer announcement.',
        }),
        record({
          id: 'earn',
          title: 'Nvidia reports quarterly earnings beat on data-center sales',
          sourceUrl: 'https://bloomberg.com/nvidia-earnings',
          primaryEntityId: 'nvidia',
          retainedText:
            'Nvidia reported a quarterly earnings beat driven by data-center sales. Management raised the next-quarter outlook while warning about export-license timing.',
        }),
        record({
          id: 'hn',
          title: 'Thread about Nvidia',
          sourceUrl: 'https://news.ycombinator.com/item?id=1',
          source: 'hackernews',
          retainedText: 'Thread about Nvidia',
        }),
        record({
          id: 'paywall',
          title: 'Secret Nvidia memo',
          sourceUrl: 'https://example.com/login',
          retainedText: 'Subscribe to read the rest of this article.',
        }),
      ],
      WINDOW
    );

    expect(stories.length).toBe(2);
    const launch = stories.find((story) => story.title.includes('Blackwell'));
    const earnings = stories.find((story) => story.title.includes('earnings'));
    expect(launch?.source_references).toHaveLength(2);
    expect(launch?.evidence_status).toBe('official');
    expect(earnings?.source_references).toHaveLength(1);
    expect(earnings?.evidence_status).toBe('reported');
    for (const story of stories) {
      expect(story.source_references.length).toBeGreaterThan(0);
      expect(story.summary.includes('Subscribe to read')).toBe(false);
    }
  });

  it('keeps single-source reported news and does not pad past available stories', () => {
    const one = composeNewsStories(
      [
        record({
          id: 'solo',
          title: 'Arm files 8-K describing a licensing amendment',
          sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/8k.htm',
          source: 'edgar_8k',
        }),
      ],
      WINDOW
    );
    expect(one).toHaveLength(1);
    expect(one[0].source_references).toHaveLength(1);
    expect(one[0].evidence_status).toBe('official');

    const extras = [
      'Canada approves a transmission line through Alberta',
      'TSMC recalls a packaging batch after contamination',
      'Arm files an 8-K describing a licensing amendment',
      'Spotify acquires a podcast studio in Berlin',
      'OpenAI launches GPT-6 for enterprise API customers',
      'Ford cuts F-150 production after a supplier fire',
      'Adobe settles a class action over training data',
      'Stripe ships worldwide billing in India rupees',
      'Intel wins a Pentagon foundry award for Ohio',
      'Shopify bans a set of unauthorized theme sellers',
      'Palantir sues a reseller over contract leakage',
      'Netflix closes a Korean studio expansion deal',
    ].map((title, index) =>
      record({
        id: `story-${index}`,
        title,
        sourceUrl: `https://reuters.com/story-${index}`,
        retainedText: `${title}. A retained excerpt records the counterparties, timing, and operational consequence without adding market direction.`,
      })
    );
    expect(composeNewsStories(extras, WINDOW)).toHaveLength(8);
  });

  it('labels community attention as unverified and never treats it as a fact', () => {
    const [story] = composeNewsStories(
      [
        record({
          id: 'lead',
          title: 'Users claim a major outage after the weekend patch',
          sourceUrl: 'https://www.reddit.com/r/sysadmin/comments/outage',
          source: 'reddit',
          retainedText:
            'Users claim a major outage after the weekend patch. Several commenters described failed logins lasting two hours, without an issuer statement.',
        }),
      ],
      WINDOW
    );
    expect(story.evidence_status).toBe('unverified');
  });
});
