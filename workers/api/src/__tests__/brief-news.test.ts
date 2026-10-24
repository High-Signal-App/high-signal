import { afterEach, describe, expect, it } from 'vitest';
import {
  clusterNewsRecords,
  briefDiscussionUrl,
  composeNewsStories,
  hasBriefNewsTopic,
  hasUsableRetainedText,
  reportingWindow,
  reportingWindowForEdition,
  sanitizeBriefNewsItems,
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

describe('news discussion context', () => {
  it.each([
    [
      'https://news.ycombinator.com/item?id=123&ref=front#comments',
      'https://news.ycombinator.com/item?id=123',
    ],
    ['https://twitter.com/acme/status/456?s=20', 'https://x.com/acme/status/456'],
    ['https://x.com/acme/status/456/', 'https://x.com/acme/status/456'],
    ['javascript:alert(1)', null],
    ['https://x.com.evil.example/acme/status/456', null],
    ['https://user:password@x.com/acme/status/456', null],
    ['https://x.com/acme', null],
    ['https://news.ycombinator.com/item?id=bad', null],
    ['http://news.ycombinator.com/item?id=123', null],
    ['https://x.com:8443/acme/status/456', null],
  ])('accepts only public discussion permalinks: %s', (input, expected) => {
    expect(briefDiscussionUrl(input)).toBe(expected);
  });

  it('keeps one publisher citation when the same article also has HN discovery context', () => {
    const original = record({
      id: 'publisher-original',
      title: 'Acme launches a new enterprise API',
      sourceUrl: 'https://reuters.com/acme-api',
    });
    const discovered = record({
      ...original,
      id: 'hn-discovered',
      source: 'news:hackernews-original:reuters.com',
      discussionUrl: 'https://news.ycombinator.com/item?id=123',
    });
    const baseline = composeNewsStories([original], WINDOW);
    const withDiscussion = composeNewsStories([original, discovered], WINDOW);
    expect(withDiscussion).toHaveLength(1);
    expect(withDiscussion[0]?.evidence_status).toBe(baseline[0]?.evidence_status);
    expect(withDiscussion[0]?.source_references).toEqual([
      expect.objectContaining({
        url: original.sourceUrl,
        discussionUrl: 'https://news.ycombinator.com/item?id=123',
      }),
    ]);
    expect(withDiscussion[0]?.summary).toBe(baseline[0]?.summary);
  });

  it('ignores malformed discussion metadata without discarding the original reporting', () => {
    const stories = composeNewsStories(
      [
        record({
          id: 'unsafe-context',
          title: 'Acme launches a new enterprise API',
          sourceUrl: 'https://reuters.com/acme-api',
          discussionUrl: 'javascript:alert(1)',
        }),
      ],
      WINDOW
    );
    expect(stories).toHaveLength(1);
    expect(stories[0]?.source_references[0]).not.toHaveProperty('discussionUrl');
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
          id: 'prediction-market',
          title: 'Will Microsoft acquire OpenAI before 2028?',
          source: 'market:manifold',
          sourceUrl: 'https://manifold.markets/example/openai-acquisition',
          primaryEntityId: 'OPENAI',
        })
      )
    ).toBe(false);
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
  it('keeps the observed Recursive/Birla and AuxoAI/CureBay/Legora events separate', () => {
    const titles = [
      'Recursive launches Flint, a laptop coding model it says was largely built by AI',
      'Birla AI Labs launches Yug-1, a time-series foundation model built in India',
      'Forward deployed AI startup AuxoAI raises $20.7 Mn in Series A round led by NTTVC',
      'Rural healthcare startup CureBay raises Rs 100 Cr in pre-Series C led by IvyCap',
      'Legal AI startup Legora raises $550M Series E at $8.8B valuation',
    ];
    const records = titles.map((title, i) =>
      record({ id: `observed-${i}`, title, sourceUrl: `https://publisher.example/story-${i}` })
    );
    expect(clusterNewsRecords(records).map((group) => group.map((item) => item.id))).toEqual(
      records.map((item) => [item.id])
    );
    const stories = composeNewsStories(records, WINDOW);
    expect(stories).toHaveLength(5);
    for (const story of stories) {
      const original = records.find((item) => item.title === story.title)!;
      expect(story.source_references.map((item) => item.recordId)).toEqual([original.id]);
    }
  });

  it('does not treat a shared funding investor as the story subject', () => {
    const titles = [
      'AI startup Acme raises $20 million in Series A round led by Northstar',
      'AI startup Beta raises $20 million in Series A round led by Northstar',
    ];
    expect(
      clusterNewsRecords(
        titles.map((title, i) =>
          record({ id: `funding-${i}`, title, sourceUrl: `https://publisher.example/funding-${i}` })
        )
      )
    ).toHaveLength(2);
  });

  it('does not merge a new claim through a bridge that only matches one cluster member', () => {
    const titles = [
      'Acme launches Alpha Beta cloud model',
      'Acme launches Alpha Beta Gamma cloud model',
      'Acme launches Gamma Delta cloud model',
    ];
    const groups = clusterNewsRecords(
      titles.map((title, i) =>
        record({ id: `bridge-${i}`, title, sourceUrl: `https://publisher.example/bridge-${i}` })
      )
    );
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['bridge-0', 'bridge-1'],
      ['bridge-2'],
    ]);
  });

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
  it('decodes retained HTML entities before publishing plain-text summaries', () => {
    const title = 'Trump describes a new technology agreement';
    const [story] = composeNewsStories(
      [
        record({
          id: 'entity-escaped-story',
          title,
          sourceUrl: 'https://cnbc.com/example/technology-agreement',
          retainedText:
            `${title}. Trump called the agreement &ldquo;morally binding&rdquo;` +
            ' &mdash; but said talks continue&hellip; More detail is due soon.',
        }),
      ],
      WINDOW
    );

    expect(story?.summary).toContain('“morally binding” — but said talks continue…');
    expect(story?.summary).not.toMatch(/&(?:ldquo|rdquo|mdash|hellip);/);
  });

  it('keeps the retained summary when only unusable new evidence refreshes a cluster', () => {
    const title = 'Acme acquires a chip supplier for cloud expansion';
    const [story] = composeNewsStories(
      [
        record({
          id: 'older-usable',
          title,
          sourceUrl: 'https://reuters.com/acme-chip-deal',
          ingestedAt: '2026-09-10T09:00:00.000Z',
        }),
        record({
          id: 'fresh-headline-only',
          title,
          sourceUrl: 'https://example.com/acme-chip-update',
          ingestedAt: '2026-09-12T09:00:00.000Z',
          content: title,
          retainedText: title,
        }),
      ],
      WINDOW
    );

    expect(story.title).toBe(title);
    expect(story.what_changed).toBe('');
  });

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

  it('keeps every qualified story beyond eight without padding a quiet edition', () => {
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
        primaryEntityId: `entity-${index}`,
        retainedText: `${title}. A retained excerpt records the counterparties, timing, and operational consequence without adding market direction.`,
      })
    );
    const stories = composeNewsStories(extras, WINDOW);
    expect(stories).toHaveLength(extras.length);
    expect(new Set(stories.map((story) => story.title))).toEqual(
      new Set(extras.map((item) => item.title))
    );
  });

  it('excludes routine earnings calendars while retaining actual results and guidance', () => {
    const titles = [
      'Rockwell Automation to Report Fourth Quarter and Full Year Fiscal 2026 Results',
      'ACM Research to Release Third Quarter 2026 Financial Results on November 5',
      'Acme announces earnings conference call date',
      'Centrus to Webcast Conference Call on November 5 at 8:30 a.m. ET',
      'Indigo Q2 results 2026 date &amp; time: Interglobe Aviation Quarterly earnings preview, announcement schedule | Details here',
      'Acme quarterly results date and time: what investors should know',
      'Beta earnings preview: board meeting next week',
      'Acme reports quarterly earnings and raises guidance',
      'Beta releases third quarter financial results',
    ];
    const stories = composeNewsStories(
      titles.map((title, index) =>
        record({
          id: `earnings-${index}`,
          title,
          source: 'ir',
          primaryEntityId: `issuer-${index}`,
          sourceUrl: `https://issuer${index}.example/results`,
        })
      ),
      WINDOW
    );
    expect(stories.map((story) => story.title).sort()).toEqual(titles.slice(7).sort());
  });

  it('decodes retained headline character references for reading without mutating records', () => {
    const original = record({
      id: 'encoded-headline',
      title: 'Acme ships research &amp; development platform',
      sourceUrl: 'https://reuters.com/acme-research-development-platform',
    });
    const stories = composeNewsStories([original], WINDOW);
    expect(stories[0]?.title).toBe('Acme ships research & development platform');
    expect(sanitizeBriefNewsItems(stories)).toHaveLength(1);
    expect(original.title).toBe('Acme ships research &amp; development platform');
  });

  it('does not impose a geographic quota on qualified stories', () => {
    const stories = composeNewsStories(
      [
        'Alpha acquires chip startup in Bengaluru',
        'Beta reports quarterly earnings beat in India',
        'Gamma confirms customer data breach in India',
        'Delta files IPO prospectus in India',
      ].map((title, index) =>
        record({
          id: `india-${index}`,
          title,
          sourceUrl: `https://reuters.com/india-${index}`,
        })
      ),
      WINDOW
    );

    expect(stories).toHaveLength(4);
  });

  it('ranks independently observed trends above equally fresh single-source news', () => {
    const trendingTitle = 'Acme launches a new inference chip for cloud providers';
    const stories = composeNewsStories(
      [
        record({
          id: 'single-official',
          title: 'Beta launches an enterprise API for cloud customers',
          source: 'ir',
          sourceUrl: 'https://beta.example/news/enterprise-api',
        }),
        record({
          id: 'trend-reuters',
          title: trendingTitle,
          sourceUrl: 'https://reuters.com/acme-chip',
        }),
        record({
          id: 'trend-bbc',
          title: trendingTitle,
          sourceUrl: 'https://bbc.com/news/acme-chip',
        }),
        record({
          id: 'trend-techcrunch',
          title: trendingTitle,
          sourceUrl: 'https://techcrunch.com/acme-chip',
        }),
      ],
      WINDOW
    );

    expect(stories[0]?.title).toBe(trendingTitle);
    expect(stories[0]?.source_references).toHaveLength(3);
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

  it('withholds community attention without retained publisher reporting', () => {
    const stories = composeNewsStories(
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
    expect(stories).toEqual([]);
  });
});

describe('attention cannot substitute for publisher reporting', () => {
  const title =
    "A look at OpenAI's Project Daybreak, which lets vetted partners use its top hacking models to find and fix vulnerabilities and helped uncover PHP2Shell RCE bugs (Thomas Brewster/Forbes)";
  const url =
    'https://www.forbes.com/sites/thomasbrewster/2026/10/23/inside-openais-plan-to-protect-the-internet-before-hackers-break-it/';
  const metadata = record({
    id: 'techmeme-forbes-metadata',
    title,
    source: 'techmeme',
    sourceUrl: url,
    retainedText: `Techmeme permalink: https://www.techmeme.com/261024/p2a261024p2 Thomas Brewster / Forbes : ${title} — This voice experience is generated by AI. Learn more. — Using the latest GPT model, cyber researchers …`,
  });

  it('withholds the actual Techmeme-only shape despite its Forbes article URL', () => {
    expect(composeNewsStories([metadata], WINDOW)).toEqual([]);
    const mislabeled = { ...metadata, source: 'news' };
    expect(hasUsableRetainedText(mislabeled)).toBe(false);
    expect(composeNewsStories([mislabeled], WINDOW)).toEqual([]);
  });

  it('uses only publisher copy and citations when longer metadata leads a mixed cluster', () => {
    const original = record({
      id: 'forbes-original',
      title,
      sourceUrl: url,
      retainedText:
        "OpenAI's Project Daybreak gives vetted partners access to its hacking models to identify vulnerabilities. Cyber researchers used the models to uncover PHP2Shell remote-code-execution bugs.",
    });
    expect(metadata.retainedText!.length).toBeGreaterThan(original.retainedText!.length);
    const baseline = composeNewsStories([original], WINDOW);
    const mixed = composeNewsStories(
      [{ ...metadata, publishedAt: '2026-09-10T08:00:00Z' }, original],
      WINDOW
    );
    expect(mixed).toEqual(baseline);
    expect(mixed[0]?.source_references).toEqual([
      { url, source: 'news', recordId: 'forbes-original' },
    ]);
    expect(mixed[0]?.summary).not.toContain('Techmeme permalink:');
    expect(mixed[0]?.summary).not.toContain('This voice experience');
  });

  it('retains attention as a ranking channel without creating another publisher origin', () => {
    const original = record({ id: 'daybreak-original', title, sourceUrl: url });
    const other = record({
      id: 'official-launch',
      source: 'ir',
      title: 'Acme launches a new cloud platform',
      sourceUrl: 'https://acme.com/cloud-platform',
    });
    expect(composeNewsStories([original, other], WINDOW)[0]?.title).toBe(other.title);
    expect(
      selectNewsRecords([metadata, original, other], WINDOW).map((item) => item.source)
    ).toContain('techmeme');
    const ranked = composeNewsStories([metadata, original, other], WINDOW);
    expect(ranked[0]?.title).toBe(title);
    expect(ranked[0]?.source_references).toHaveLength(1);
    expect(ranked[0]?.evidence_status).toBe(
      composeNewsStories([original], WINDOW)[0]?.evidence_status
    );
  });

  it('withholds cached aggregator attribution even when its citation points to Forbes', () => {
    const [publisher] = composeNewsStories(
      [record({ id: 'forbes-original', title, sourceUrl: url })],
      WINDOW
    );
    expect(
      sanitizeBriefNewsItems([{ ...publisher, source_references: [{ url, source: 'techmeme' }] }])
    ).toEqual([]);
    // An earlier mixed cluster could retain the publisher citation after choosing metadata copy.
    expect(sanitizeBriefNewsItems([{ ...publisher, summary: metadata.retainedText! }])).toEqual([]);
    expect(
      sanitizeBriefNewsItems([{ ...publisher, what_changed: metadata.retainedText! }])
    ).toEqual([]);
  });

  it('lets newly retained reporting replace prior attention at the same URL without using metadata as an update', () => {
    const olderMetadata = {
      ...metadata,
      ingestedAt: '2026-09-10T09:00:00Z',
      publishedAt: '2026-09-10T08:00:00Z',
    };
    const original = record({ id: 'fresh-publisher', title, sourceUrl: url });
    const baseline = composeNewsStories([original], WINDOW);
    expect(composeNewsStories([olderMetadata, original], WINDOW)).toEqual(baseline);
    const oldPublisher = { ...original, ingestedAt: '2026-09-10T09:00:00Z' };
    const freshAttention = { ...metadata, sourceUrl: 'https://techmeme.com/261024/p2' };
    expect(composeNewsStories([oldPublisher, freshAttention], WINDOW)).toEqual([]);
  });

  it('never selects fresh attention metadata for what_changed over a retained publisher update', () => {
    const launchTitle = 'OpenAI launches Project Daybreak security API';
    const older = record({
      id: 'prior-report',
      title: launchTitle,
      sourceUrl: 'https://reuters.com/openai-daybreak-launch',
      ingestedAt: '2026-09-10T09:00:00Z',
    });
    const update = record({
      id: 'publisher-update',
      title: launchTitle,
      sourceUrl: 'https://forbes.com/openai-daybreak-security-api',
      retainedText:
        'OpenAI expanded Project Daybreak security API access to additional vetted partners. The publisher records the new access scope and the security limitations that remain in force.',
      ingestedAt: '2026-09-12T09:00:00Z',
    });
    const attention = {
      ...metadata,
      title: launchTitle,
      sourceUrl: update.sourceUrl,
      ingestedAt: '2026-09-12T10:00:00Z',
    };
    const baseline = composeNewsStories([older, update], WINDOW);
    expect(baseline[0]?.what_changed).toContain('expanded Project Daybreak');
    expect(composeNewsStories([older, update, attention], WINDOW)).toEqual(baseline);
  });

  it('preserves an original publisher fetched through HN discovery', () => {
    const original = record({
      id: 'hn-original',
      source: 'news:hackernews-original:forbes.com',
      title,
      sourceUrl: url,
      discussionUrl: 'https://news.ycombinator.com/item?id=50217500',
    });
    const stories = composeNewsStories([original], WINDOW);
    expect(stories).toHaveLength(1);
    expect(stories[0]?.source_references[0]).toMatchObject({
      source: 'news',
      discussionUrl: original.discussionUrl,
    });
    expect(sanitizeBriefNewsItems(stories)).toHaveLength(1);
  });
});

describe('sanitizeBriefNewsItems', () => {
  it('withholds cached cross-story and navigation summaries from the full collection', () => {
    const stories = [
      {
        title: 'IBM CEO says open weight models are now good and cheap on-prem',
        summary:
          'AI - Nvidia woos Europeans with open weight models. - Jensen demonstrates robots. - Nvidia builds trailer parks.',
        url: 'https://publisher.test/ibm-ceo-open-weight-models',
      },
      {
        title: 'Infosys AI revenue jumps 29%; Apple foldable phone pre-orders rise',
        summary:
          'Dear Reader, Cybercriminals exploited a software disclosure. Cloudflare detected millions of attempts to exploit PHP vulnerabilities.',
        url: 'https://publisher.test/infosys-ai-revenue-jumps',
      },
      {
        title: 'CFTC CoT: ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC (2026-10-20)',
        summary:
          'CFTC CoT GULF 6 FUEL OIL CRACK for 2026-06-23. Non-commercial long: 1655, short: 2282, net: -627.',
        url: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
      },
      {
        title: 'Small Craft Advisory: Stellwagen Bank National Marine Sanctuary',
        summary:
          'Severe Thunderstorm Warning — Buena Vista, IA. The storm that prompted the warning has moved out of the area.',
        url: 'http://www.weather.gov',
      },
    ].map(({ title, summary, url }, index) => ({
      id: `contaminated-${index}`,
      title,
      summary,
      event_at: '2026-09-12T08:00:00Z',
      what_changed: '',
      source_references: [{ url, source: 'news' }],
      evidence_status: 'reported' as const,
    }));
    expect(sanitizeBriefNewsItems(stories)).toEqual([]);
    expect(
      sanitizeBriefNewsItems([
        {
          ...stories[0],
          summary:
            'The company is bringing smaller language models to customer hardware, with local deployment replacing hosted inference.',
        },
      ])
    ).toHaveLength(1);
  });

  it('repairs the observed cached model-launch and funding associations', () => {
    const recursive =
      'https://techcrunch.com/2026/10/21/recursive-launches-flint-a-laptop-coding-model-it-says-was-largely-built-by-ai/';
    const birla =
      'https://analyticsindiamag.com/ai-news/birla-ai-labs-launches-yug-1-a-time-series-foundation-model-built-in-india';
    const auxo =
      'https://entrackr.com/news/forward-deployed-ai-startup-auxoai-raises-207-mn-in-series-a-round-led-by-nttvc-12695466';
    const curebay =
      'https://entrackr.com/news/rural-healthcare-startup-curebay-raises-rs-100-cr-in-pre-series-c-led-by-ivycap-12705651';
    const legora =
      'https://techcrunch.com/2026/10/21/legal-ai-startup-legora-raises-550m-series-e-at-8-8b-valuation/';
    const stories = sanitizeBriefNewsItems([
      {
        id: 'recursive',
        title: 'Recursive launches Flint, a laptop coding model it says was largely built by AI',
        summary: 'Recursive released Flint, a coding model designed to run locally on a laptop.',
        event_at: '2026-10-21T12:00:00Z',
        what_changed: '',
        source_references: [birla, recursive].map((url) => ({ url, source: 'news' })),
        evidence_status: 'reported',
      },
      {
        id: 'auxo',
        title: 'Forward deployed AI startup AuxoAI raises $20.7 Mn in Series A round led by NTTVC',
        summary: 'AuxoAI raised20.7million dollars in a funding round led by NTTVC.',
        event_at: '2026-10-21T12:00:00Z',
        what_changed: '',
        source_references: [curebay, auxo, legora].map((url) => ({ url, source: 'news' })),
        evidence_status: 'reported',
      },
    ]);
    expect(stories.map((story) => story.source_references.map((citation) => citation.url))).toEqual(
      [[recursive], [auxo]]
    );
  });

  it('withholds a named cached event when none of its citations matches its subject', () => {
    expect(
      sanitizeBriefNewsItems([
        {
          id: 'wrong-subject-only',
          title: 'Acme raises Series A funding round led by Northstar',
          summary: 'The retained summary describes Acme raising a new funding round.',
          event_at: '2026-10-21T12:00:00Z',
          what_changed: '',
          source_references: [
            {
              url: 'https://publisher.example/beta-raises-series-a-funding-round-led-by-northstar',
              source: 'news',
            },
          ],
          evidence_status: 'reported',
        },
      ])
    ).toEqual([]);
  });

  it('decodes common named and numeric entities once and preserves plain ampersands', () => {
    const [story] = sanitizeBriefNewsItems([
      {
        id: 'entity-escaped-story',
        title: 'A retained technology story',
        summary:
          'The report says &ldquo;proceed&rdquo;&nbsp;— &lsquo;details&rsquo; follow. ' +
          'A &#8217; quote and &#x2014; dash; no-semicolon &#39 quote; ' +
          'literal &amp;ldquo; stays visible, ' +
          'as does &unknown;.',
        event_at: '2026-09-12T08:00:00.000Z',
        what_changed: '',
        source_references: [{ url: 'https://example.com/retained-story', source: 'news' }],
        evidence_status: 'reported',
      },
    ]);

    expect(story?.summary).toBe(
      'The report says “proceed” — ‘details’ follow. A ’ quote and — dash; ' +
        "no-semicolon ' quote; " +
        'literal &ldquo; stays visible, as does &unknown;.'
    );
  });

  it('replaces invalid numeric references and strips tags exposed by entity decoding', () => {
    const [story] = sanitizeBriefNewsItems([
      {
        id: 'encoded-markup-story',
        title: 'A retained technology story',
        summary:
          'The retained item contains &lt;script&gt;unsafe()&lt;/script&gt; text. ' +
          'Invalid &#0;, &#xD800;, and &#x110000; references are replaced.',
        event_at: '2026-09-12T08:00:00.000Z',
        what_changed: '',
        source_references: [{ url: 'https://example.com/retained-story', source: 'news' }],
        evidence_status: 'reported',
      },
    ]);

    expect(story?.summary).toBe(
      'The retained item contains unsafe() text. Invalid �, �, and � references are replaced.'
    );
    expect(story?.summary).not.toMatch(/<\/?script>/i);
  });

  it('removes cached prediction-market questions from reader news', () => {
    expect(
      sanitizeBriefNewsItems([
        {
          id: 'market-question',
          title: 'Will Microsoft acquire OpenAI before 2028?',
          summary:
            'A prediction-market question asks whether Microsoft will acquire OpenAI before 2028.',
          event_at: '2026-09-13T18:30:00.000Z',
          what_changed: '',
          source_references: [
            {
              url: 'https://manifold.markets/example/openai-acquisition',
              source: 'market',
            },
          ],
          evidence_status: 'unverified',
        },
      ])
    ).toEqual([]);
  });

  it('removes unrelated citations inherited by a cached story cluster', () => {
    const [story] = sanitizeBriefNewsItems([
      {
        id: 'revolut-breach',
        title: 'Revolut confirms customer data breach through fake government requests',
        summary:
          'Revolut confirmed that attackers obtained customer data by submitting fraudulent government requests.',
        event_at: '2026-09-12T08:00:00.000Z',
        what_changed:
          'Listen to this article in summarized format Revolut confirmed that attackers obtained customer data by submitting fraudulent government requests.',
        source_references: [
          {
            url: 'https://techcrunch.com/2026/09/12/revolut-confirms-customer-data-breach-through-fake-government-requests/',
            source: 'news',
          },
          {
            url: 'https://techcrunch.com/2026/09/11/scammers-target-crypto-owners-after-trezor-confirms-data-breach/',
            source: 'news',
          },
        ],
        evidence_status: 'reported',
      },
    ]);

    expect(story?.source_references).toEqual([
      {
        url: 'https://techcrunch.com/2026/09/12/revolut-confirms-customer-data-breach-through-fake-government-requests/',
        source: 'news',
      },
    ]);
    expect(story?.what_changed).toBe('');
  });
});

describe('retained excerpt identity regressions', () => {
  it('keeps historical agency entries separate and uses each event-local body', () => {
    const first = record({
      id: 'stellwagen',
      source: 'us-gov-api:noaa-weather',
      sourceUrl: 'http://www.weather.gov',
      title: 'Small Craft Advisory: Stellwagen Bank National Marine Sanctuary',
      content:
        'Small Craft Advisory — Stellwagen Bank National Marine Sanctuary. North winds and high seas will remain hazardous to small vessels until Saturday evening.',
      retainedText:
        'Severe Thunderstorm Warning — Buena Vista, IA. The storm that prompted the warning has moved out of the area.',
    });
    const second = record({
      ...first,
      id: 'buena-vista',
      title: 'Severe Thunderstorm Warning: Buena Vista, IA',
      content: first.retainedText,
    });
    expect(clusterNewsRecords([first, second])).toHaveLength(2);
    const stories = composeNewsStories([first, second], WINDOW);
    // The unrelated storm remains a distinct raw observation; the existing
    // technology/finance topic gate need not admit it into the publication.
    expect(stories).toHaveLength(1);
    expect(stories.find((story) => story.title === first.title)?.summary).toContain(
      'Stellwagen Bank'
    );
    expect(stories.find((story) => story.title === first.title)?.summary).not.toContain(
      'Buena Vista'
    );

    const contract = record({
      id: 'zcash',
      source: 'us-gov-api:cftc-cot',
      primaryEntityId: 'COINBASE',
      sourceUrl: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
      title: 'CFTC CoT: ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC (2026-10-20)',
      content:
        'CFTC CoT ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC for 2026-10-20. Non-commercial long: 8518, short: 7216, net: 1302.',
      retainedText:
        'CFTC CoT GULF 6 FUEL OIL CRACK for 2026-06-23. Non-commercial long: 1655, short: 2282, net: -627.',
    });
    const [story] = composeNewsStories([contract], WINDOW);
    expect(story.summary).toContain('ZCASH');
    expect(story.summary).toContain('1302');
    expect(story.summary).not.toContain('GULF');
  });

  it('preserves negation and qualifiers before a digest subject match', () => {
    const sentence =
      'It is false that Infosys reported a 29% increase in AI revenue; the company has not disclosed that figure.';
    const stories = composeNewsStories(
      [
        record({
          id: 'qualified-digest',
          title: 'Infosys AI revenue jumps 29%',
          sourceUrl: 'https://publisher.example/qualified-digest',
          retainedText:
            'Apple reported a new phone launch with sales starting next month. '.repeat(24) +
            sentence,
        }),
      ],
      WINDOW
    );
    expect(stories).toHaveLength(1);
    expect(stories[0].summary).toBe(sentence);
  });

  it('does not treat later editorial discussion of a paywall as a blocked article', () => {
    const stories = composeNewsStories(
      [
        record({
          id: 'late-paywall-mention',
          title: 'Acme launches a new cloud service',
          sourceUrl: 'https://publisher.example/cloud-service',
          retainedText:
            'Acme launched a new cloud service for enterprise customers on Monday. ' +
            'The company documented deployment options and operating costs for its customers. '.repeat(
              24
            ) +
            'The publisher separately discussed how its paywall supports independent reporting.',
        }),
      ],
      WINDOW
    );
    expect(stories).toHaveLength(1);
    expect(stories[0].summary).toContain('Acme launched a new cloud service');
  });

  it('selects a subject-led digest sentence beyond the intro and withholds navigation', () => {
    const digest = record({
      id: 'digest',
      title: 'Infosys AI revenue jumps 29%; Apple foldable phone pre-orders rise',
      sourceUrl: 'https://publisher.test/infosys-ai-revenue-jumps',
      retainedText:
        'Dear Reader, Cybercriminals exploited a software disclosure. ' +
        'Cloudflare detected attempts to exploit PHP vulnerabilities. '.repeat(30) +
        'In today’s newsletter: Infosys sees growth. Here is your trivia. ' +
        'Infosys reported steady growth in the quarter, with AI emerging as a key revenue driver amid macroeconomic uncertainty. ' +
        'In other news, Canva discussed creative tools.',
    });
    const navigation = record({
      id: 'navigation',
      primaryEntityId: 'IBM',
      title: 'IBM CEO says open weight models are good and cheap on-prem',
      sourceUrl: 'https://publisher.test/ibm-ceo-open-weight-models',
      retainedText:
        'AI - Nvidia woos Europeans with open weight models. - Jensen demonstrates robots. - Nvidia builds trailer parks. '.repeat(
          5
        ),
    });
    const stories = composeNewsStories([digest, navigation], WINDOW);
    expect(stories).toHaveLength(1);
    expect(stories[0].summary).toBe(
      'Infosys reported steady growth in the quarter, with AI emerging as a key revenue driver amid macroeconomic uncertainty.'
    );
    expect(stories[0].source_references[0].recordId).toBe('digest');
  });
});

describe('buildNews', () => {
  let d1: TestD1 | null = null;

  afterEach(() => {
    d1?.close();
    d1 = null;
  });

  it.each(['mts', 'techmeme'])(
    'keeps reported news inside the limit after a larger, newer %s ingest',
    async (attentionSource) => {
      d1 = createSqliteD1();
      applyMigrations(d1);
      const now = new Date('2026-09-12T12:00:00.000Z');
      const recent = Math.floor(now.getTime() / 1000) - 60;
      const attention = Array.from({ length: 801 }, (_, index) => [
        `mts-${index}`,
        attentionSource,
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
    }
  );

  it.each(['news:mts-verification:example.com', 'news:hackernews-original:example.com'])(
    'keeps %s inside the limit after a bulk news refresh',
    async (source) => {
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
        source,
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
      expect(
        stories.some((story) => story.title === 'OpenAI launches verified enterprise API')
      ).toBe(true);
    }
  );

  it('loads retained source text for ranked news candidates', async () => {
    d1 = createSqliteD1();
    applyMigrations(d1);
    const now = new Date('2026-09-12T12:00:00.000Z');
    const ingestedAt = Math.floor(now.getTime() / 1000) - 60;
    d1.exec(`
      INSERT INTO source_documents
        (id, source, canonical_url, fetched_at, published_at, raw_hash, raw_text, created_at, parsed_fields)
      VALUES
        ('doc-reuters', 'news:reuters', 'https://reuters.com/acme-austin', ${ingestedAt}, ${ingestedAt}, 'doc-hash', 'Acme opened a new semiconductor factory in Austin on Monday. The facility has capacity for 40,000 wafers each month and will start shipping to customers in December.', ${ingestedAt}, '{"discussionUrl":"https://news.ycombinator.com/item?id=123"}');
      INSERT INTO events
        (id, source, source_url, published_at, title, content, primary_entity_id, raw_hash, ingested_at, source_document_id)
      VALUES
        ('reuters-retained', 'news:reuters', 'https://reuters.com/acme-austin', ${ingestedAt}, 'Acme opens semiconductor factory in Austin', NULL, NULL, 'event-hash', ${ingestedAt}, 'doc-reuters');
    `);

    const database = db(d1.binding);
    const stories = await buildNews(database, 'global', '2026-09-12', now);
    const timings: Array<{ name: string; durationMs: number }> = [];
    const diagnosticStories = await buildNews(database, 'global', '2026-09-12', now, timings);

    expect(stories).toHaveLength(1);
    expect(stories[0]?.summary.toLowerCase()).toContain('austin');
    expect(stories[0]?.source_references[0]?.url).toBe('https://reuters.com/acme-austin');
    expect(stories[0]?.source_references[0]?.discussionUrl).toBe(
      'https://news.ycombinator.com/item?id=123'
    );
    d1.exec(
      "UPDATE source_documents SET parsed_fields = 'malformed legacy JSON' WHERE id = 'doc-reuters'"
    );
    const legacyStories = await buildNews(database, 'global', '2026-09-12', now);
    expect(legacyStories).toHaveLength(1);
    expect(legacyStories[0]?.source_references[0]).not.toHaveProperty('discussionUrl');
    expect(diagnosticStories).toEqual(stories);
    expect(timings.map(({ name }) => name)).toEqual(['news-window', 'news-query', 'news-compose']);
    expect(timings.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0)).toBe(
      true
    );
  });

  it('records the failed news query stage without swallowing its error', async () => {
    d1 = createSqliteD1();
    applyMigrations(d1);
    d1.exec('DROP TABLE events');
    const timings: Array<{ name: string; durationMs: number }> = [];

    await expect(
      buildNews(db(d1.binding), 'global', '2026-09-12', WINDOW_END, timings)
    ).rejects.toThrow();
    expect(timings.map(({ name }) => name)).toEqual(['news-window', 'news-query']);
    expect(timings.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0)).toBe(
      true
    );
  });
});
