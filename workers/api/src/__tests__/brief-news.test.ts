import { afterEach, describe, expect, it } from 'vitest';
import {
  clusterNewsRecords,
  composeNewsStories,
  hasBriefNewsTopic,
  hasUsableRetainedText,
  reportingWindow,
  reportingWindowForEdition,
  selectNewsRecords,
  type NewsRecord,
} from '@high-signal/shared';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { db } from '../db';
import { buildNews } from '../routes/brief/query';

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

  it('stops historical repair reads at the IST edition boundary', () => {
    const historical = reportingWindowForEdition(
      null,
      '2026-09-11',
      new Date('2026-09-13T12:00:00.000Z')
    );
    expect(historical.start.toISOString()).toBe('2026-09-10T18:30:00.000Z');
    expect(historical.end.toISOString()).toBe('2026-09-11T18:30:00.000Z');
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

  it('treats the reporting-window end as exclusive', () => {
    const boundary = record({
      id: 'next-edition',
      title: 'Acme launches a new service at midnight',
      sourceUrl: 'https://acme.example/midnight',
      ingestedAt: WINDOW.end,
    });
    expect(selectNewsRecords([boundary], WINDOW)).toEqual([]);
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
        title: 'OpenAI IPO remains on hold',
        content:
          'Search fieldHome page Seeking Alpha - Power to InvestorsAbout PremiumCreate free accountSearch for Symbols and analysts before the article begins.',
        retainedText:
          'Search fieldHome page Seeking Alpha - Power to InvestorsAbout PremiumCreate free accountSearch for Symbols and analysts before the article begins.',
      })
    ).toBe(false);
    expect(
      hasUsableRetainedText({
        title: 'Exclusive investigation',
        content: 'Please log in to continue reading this article.',
        retainedText: 'Please log in to continue reading this article.',
      })
    ).toBe(false);
    expect(
      hasUsableRetainedText({
        title: 'AI server exports slow in August',
        content:
          'Keep me signed in. Some subscribers prefer to save their User ID and password on this computer.',
        retainedText:
          'Keep me signed in. Some subscribers prefer to save their User ID and password on this computer.',
      })
    ).toBe(false);
  });

  it('rejects routine IR crawl snapshots while retaining real issuer announcements', () => {
    const boilerplate = record({
      id: 'ir-snapshot',
      title: 'NVDA IR snapshot',
      source: 'ir',
      sourceUrl: 'https://nvidia.com',
      retainedText:
        'Products Solutions Industries Investors Careers. This is a routine retained landing-page crawl with no announced change.',
    });
    const announcement = record({
      id: 'ir-announcement',
      title: 'Nvidia launches Blackwell Ultra for hyperscalers',
      source: 'ir',
      sourceUrl: 'https://nvidianews.nvidia.com/news/blackwell-ultra',
    });
    expect(selectNewsRecords([boilerplate, announcement], WINDOW).map((item) => item.id)).toEqual([
      'ir-announcement',
    ]);
  });

  it('rejects routine court crawls and stock-pick listicles from the daily edition', () => {
    const courtOpinion = record({
      id: 'routine-court-opinion',
      title: 'Court opinion: BINGHAM LIVESTOCK v. PACCAR',
      source: 'courtlistener',
      sourceUrl: 'https://www.courtlistener.com/opinion/12345/example/',
      retainedText:
        'The court considered a routine vehicle warranty dispute and affirmed the lower court judgment after reviewing the purchase agreement.',
    });
    const stockPicks = record({
      id: 'stock-picks',
      title: 'Top stocks to Buy under ₹200: Five ideas with target, stop-loss',
      sourceUrl: 'https://example.com/top-stocks-to-buy',
      retainedText:
        'The article recommends five shares to retail investors with entry prices, price targets, and stop-loss levels for the next session.',
    });
    const materialLegalNews = record({
      id: 'material-legal-news',
      title: 'Regulator blocks major chip merger after antitrust review',
      source: 'news',
      sourceUrl: 'https://example.com/chip-merger-blocked',
      retainedText:
        'The regulator blocked the semiconductor acquisition after finding that the deal would reduce competition in accelerator hardware.',
    });
    const priceTarget = record({
      id: 'price-target',
      title: 'Titan stock outlook: Buy for 20% upside; check share price target',
      sourceUrl: 'https://example.com/titan-price-target',
    });
    const marketPrediction = record({
      id: 'market-prediction',
      title: 'Sensex, Nifty prediction for Tuesday: Should investors buy the dip?',
      sourceUrl: 'https://example.com/market-prediction',
    });

    expect(
      selectNewsRecords(
        [courtOpinion, stockPicks, priceTarget, marketPrediction, materialLegalNews],
        WINDOW
      ).map((item) => item.id)
    ).toEqual(['material-legal-news']);
  });

  it('keeps the reader edition inside technology, startups, and finance', () => {
    expect(
      hasBriefNewsTopic(
        record({
          id: 'sports',
          title: 'Rybakina wins the US Open final',
          sourceUrl: 'https://example.com/tennis-final',
          retainedText:
            'Rybakina won the tennis final in straight sets. The match concluded after a two-hour contest in New York.',
        })
      )
    ).toBe(false);
    expect(
      hasBriefNewsTopic(
        record({
          id: 'finance',
          title: 'Oracle cancels a planned stock sale',
          sourceUrl: 'https://example.com/oracle-stock',
        })
      )
    ).toBe(true);
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

  it('merges differently worded reporting about the same named event', () => {
    const broad = record({
      id: 'openai-broad',
      title: 'OpenAI rules out IPO this year as Altman warns AI is moving too fast',
      sourceUrl: 'https://cnbc.example/openai-ipo',
    });
    const focused = record({
      id: 'openai-focused',
      title: 'Sam Altman says OpenAI IPO not happening in 2026',
      sourceUrl: 'https://finance.example/openai-ipo',
    });
    expect(clusterNewsRecords([broad, focused])).toHaveLength(1);
  });

  it('does not merge unrelated companies that share generic breach language', () => {
    const revolut = record({
      id: 'revolut-breach',
      title: 'Revolut confirms customer data breach through fake government requests',
      sourceUrl: 'https://techcrunch.example/revolut-breach',
    });
    const trezor = record({
      id: 'trezor-breach',
      title: 'Trezor confirms customer data breach through compromised email provider',
      sourceUrl: 'https://techcrunch.example/trezor-breach',
    });
    expect(clusterNewsRecords([revolut, trezor])).toHaveLength(2);
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

  it('strips publisher prompts, newsletter preambles, and repeated titles from summaries', () => {
    const title = "Buffett's confidence in troubled decade-old acquisition finally pays off";
    const [story] = composeNewsStories(
      [
        record({
          id: 'clean-summary',
          title,
          sourceUrl: 'https://example.com/berkshire-acquisition',
          retainedText: `(This is the Warren Buffett Watch newsletter, news and analysis on Berkshire Hathaway. You can sign up here.) ${title}. Six years after the write-down, the acquisition returned to growth as aerospace demand recovered.`,
        }),
      ],
      WINDOW
    );
    expect(story.summary).toBe(
      'Six years after the write-down, the acquisition returned to growth as aerospace demand recovered.'
    );

    const [listenPrompt] = composeNewsStories(
      [
        record({
          id: 'listen-prompt',
          title: 'NSE publishes IPO price band',
          sourceUrl: 'https://example.com/nse-ipo',
          retainedText:
            'Listen to this article in summarized format NSE will raise capital through an offer for sale after publishing the final IPO price band.',
        }),
      ],
      WINDOW
    );
    expect(listenPrompt.summary.startsWith('Listen to this article')).toBe(false);
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

describe('buildNews', () => {
  let d1: TestD1 | null = null;

  afterEach(() => {
    d1?.close();
    d1 = null;
  });

  it('keeps reported news inside the limit after a larger, newer attention ingest', async () => {
    d1 = createSqliteD1();
    applyMigrations(d1);
    const now = new Date('2026-09-12T12:00:00.000Z');
    const recent = Math.floor(now.getTime() / 1000) - 60;
    const attention = Array.from({ length: 801 }, (_, index) => [
      `mts-${index}`,
      'mts',
      `https://attention.example/${index}`,
      recent,
      `Community launches tool ${index}`,
      `Community launches tool ${index}. This retained attention excerpt records discussion volume and timing without presenting it as verified reporting.`,
      `mts-hash-${index}`,
      recent,
    ]);
    const reported = [
      'reported-1',
      'news:reuters',
      'https://reuters.com/acme-capacity',
      recent - 3_600,
      'Acme launches verified capacity expansion',
      'Acme launched a verified capacity expansion. The retained report identifies the facility, announced timetable, and operating consequence.',
      'reported-hash-1',
      recent - 3_600,
    ];

    const allRows = [reported, ...attention];
    for (let offset = 0; offset < allRows.length; offset += 300) {
      const rows = allRows.slice(offset, offset + 300);
      const values = rows
        .map(
          ([id, source, url, publishedAt, title, content, rawHash, ingestedAt]) =>
            `('${id}','${source}','${url}',${publishedAt},'${title}','${content}',NULL,'${rawHash}',${ingestedAt})`
        )
        .join(',');
      d1.exec(
        `INSERT INTO events (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at) VALUES ${values}`
      );
    }

    const stories = await buildNews(db(d1.binding), 'global', '2026-09-12', now);
    expect(
      stories.some((story) => story.title === 'Acme launches verified capacity expansion')
    ).toBe(true);
  });

  it('keeps original-publisher verification inside the limit after a bulk news refresh', async () => {
    d1 = createSqliteD1();
    applyMigrations(d1);
    const now = new Date('2026-09-12T12:00:00.000Z');
    const recent = Math.floor(now.getTime() / 1000) - 60;
    const bulkNews = Array.from({ length: 801 }, (_, index) => [
      `bulk-${index}`,
      'news:bulk-feed',
      `https://bulk-news.example/${index}`,
      recent,
      `Company ${index} launches cloud product`,
      `Company ${index} launched a cloud product. The retained report records the release date, customer scope, and operational details.`,
      `bulk-hash-${index}`,
      recent,
    ]);
    const verifiedPublisher = [
      'verified-publisher',
      'news:mts-verification:example.com',
      'https://publisher.example/openai-api',
      recent - 3_600,
      'OpenAI launches verified enterprise API',
      'OpenAI launched a verified enterprise API. The original publisher page records the release date, customer scope, and operational details.',
      'verified-publisher-hash',
      recent - 3_600,
    ];

    const allRows = [...bulkNews, verifiedPublisher];
    for (let offset = 0; offset < allRows.length; offset += 300) {
      const rows = allRows.slice(offset, offset + 300);
      const values = rows
        .map(
          ([id, source, url, publishedAt, title, content, rawHash, ingestedAt]) =>
            `('${id}','${source}','${url}',${publishedAt},'${title}','${content}',NULL,'${rawHash}',${ingestedAt})`
        )
        .join(',');
      d1.exec(
        `INSERT INTO events (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at) VALUES ${values}`
      );
    }

    const stories = await buildNews(db(d1.binding), 'global', '2026-09-12', now);
    expect(stories.some((story) => story.title === 'OpenAI launches verified enterprise API')).toBe(
      true
    );
  });
});
