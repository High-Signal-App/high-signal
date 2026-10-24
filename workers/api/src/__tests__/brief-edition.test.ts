import { describe, expect, it } from 'vitest';
import {
  selectBriefEdition,
  buildReaderEdition,
  briefNewsPageHref,
  type BriefNewsItem,
  type BriefSnapshot,
} from '@high-signal/shared';

function story(id: string, change: Partial<BriefNewsItem> = {}): BriefNewsItem {
  const title = change.title ?? `${id} launches a production database`;
  return {
    id,
    title,
    summary: `${title}. The company provided the details and timeline in its announcement.`,
    event_at: '2026-10-24T06:00:00Z',
    what_changed: '',
    evidence_status: 'reported',
    source_references: [{ url: `https://${id}.example/announcement`, recordId: id }],
    ...change,
  };
}
function edition(news: BriefNewsItem[]): BriefSnapshot {
  return {
    generatedAt: '2026-10-24T10:00:00Z',
    editionDate: '2026-10-24',
    region: 'global',
    stocks: [],
    ideas: [],
    trends: [],
    news,
  };
}

describe('finite front edition', () => {
  it('builds the same machine-readable selection without copying invalid full-collection citations', () => {
    const primary = story('primary', {
      title: 'Acme launches Alpha Beta cloud model',
      summary: 'Acme’s Alpha Beta cloud model is available to enterprise customers this week.',
      source_references: [
        { url: 'https://primary.example/acme-alpha-beta-model', recordId: 'primary' },
      ],
    });
    const related = story('related', {
      title: 'Acme launches Alpha Beta model for cloud customers',
      summary:
        'Acme’s Alpha Beta model is rolling out to cloud customers with published technical details.',
      source_references: [
        { url: 'https://reporter.example/acme-alpha-beta-model', recordId: 'related' },
      ],
    });
    const bad = story('bad', {
      title: 'DifferentCo launches Alpha Beta model',
      source_references: primary.source_references,
    });
    const brief = edition([primary, related, bad]);
    const view = buildReaderEdition(brief);
    expect(view.news).toHaveLength(1);
    expect(view.news[0]?.story.source_references).toEqual(primary.source_references);
    expect(view.news[0]?.related[0]?.source_references).toEqual(related.source_references);
    expect(view.totalNews).toBe(2);
    expect(view.signals).toEqual([]);
    expect(view.totalSignals).toBe(0);
    expect(brief.news).toHaveLength(3);
  });
  it('prioritizes consequential changes over input order, old copy, tutorials and attention', () => {
    const brief = edition([
      story('tutorial', { title: 'How to build approval workflows' }),
      story('promotion', { title: 'The Kindle edition just hit #1 New Release' }),
      story('old', { title: 'OldCo confirms a data breach', event_at: '2026-10-17T06:00:00Z' }),
      story('attention', {
        title: 'ForumCo reports a security incident',
        evidence_status: 'unverified',
      }),
      story('politics', { title: 'President directs Alaska election lawsuit' }),
      story('launch'),
      story('incident', { title: 'Railway reports a security incident' }),
    ]);
    const before = JSON.stringify(brief);
    expect(selectBriefEdition(brief).items.map(({ story }) => story.id)).toEqual([
      'incident',
      'launch',
    ]);
    expect(selectBriefEdition(brief).total).toBe(7);
    expect(JSON.stringify(brief)).toBe(before);
  });

  it('caps the front at eight and one publisher at two without padding', () => {
    const names = [
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
      'Foxtrot',
      'Golf',
      'Hotel',
      'India',
      'Juliet',
      'Kilo',
      'Lima',
    ];
    const publisher = names.map((name, i) =>
      story(`publisher-${i}`, {
        title: `${name} launches a production database`,
        source_references: [{ url: `https://one.example/story-${i}` }],
      })
    );
    const others = names
      .slice(0, 10)
      .map((name, i) =>
        story(`other-${i}`, { title: `Other${name} launches a production database` })
      );
    const result = selectBriefEdition(edition([...publisher, ...others]));
    expect(result.items).toHaveLength(8);
    expect(
      result.items.filter(({ story }) => story.id.startsWith('publisher')).length
    ).toBeLessThanOrEqual(2);
    expect(selectBriefEdition(edition(publisher)).items).toHaveLength(2);
    expect(selectBriefEdition(edition([story('only')])).items).toHaveLength(1);
    expect(selectBriefEdition(edition([])).items).toEqual([]);
  });

  it('groups event coverage with separate attribution and no invented combined claim', () => {
    const accounts = [
      story('primary', {
        title: 'Acme launches Alpha Beta cloud model',
        evidence_status: 'official',
      }),
      story('reporter', { title: 'Acme launches Alpha Beta model for cloud customers' }),
      story('different-event', { title: 'Acme acquires a chip designer' }),
      story('different-company', { title: 'OtherCo launches Alpha Beta cloud model' }),
    ];
    const result = selectBriefEdition(edition(accounts));
    expect(result.items).toHaveLength(3);
    const grouped = result.items.find(({ story }) => story.id === 'primary')!;
    expect(grouped.story).toBe(accounts[0]);
    expect(grouped.related).toEqual([accounts[1]]);
    expect(grouped.story.source_references).toHaveLength(1);
    expect(grouped.story.evidence_status).toBe('official');
  });

  it('keeps complete-link bridge protection and does not mix separate days of an event', () => {
    const titles = [
      'Acme launches Alpha Beta cloud model',
      'Acme launches Alpha Beta Gamma cloud model',
      'Acme launches Gamma Delta cloud model',
    ];
    const result = selectBriefEdition(
      edition(titles.map((title, i) => story(`bridge-${i}`, { title })))
    );
    expect(result.items).toHaveLength(2);
    expect(result.items.map(({ related }) => related.length).sort()).toEqual([0, 1]);
    const days = edition([
      story('day-one', { title: titles[0], event_at: '2026-10-22T06:00:00Z' }),
      story('day-two', { title: titles[0] }),
    ]);
    expect(selectBriefEdition(days).items).toHaveLength(2);
  });

  it('groups differently phrased coverage without changing source evidence labels', () => {
    const first = story('offline', {
      title: 'OpenAI Cuts Live Internet Access From Frontier Model Training After Security Breach',
    });
    const second = story('training', {
      title: 'OpenAI now trains its frontier AI models with no internet access',
    });
    const result = selectBriefEdition(edition([first, second]));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.related).toEqual([second]);
    expect(result.items[0]?.story.source_references).toHaveLength(1);
  });

  it('does not select invalid or future dates and remains deterministic on historical editions', () => {
    const input = edition([
      story('current'),
      story('future', { event_at: '2026-10-25T06:00:00Z' }),
      story('invalid', { event_at: 'invalid' }),
    ]);
    expect(selectBriefEdition(input).items.map(({ story }) => story.id)).toEqual(['current']);
    expect(selectBriefEdition(input)).toEqual(selectBriefEdition(input));
  });

  it('does not let a funding batch occupy the front edition', () => {
    const funds = Array.from({ length: 12 }, (_, i) =>
      story(`fund-${i}`, { title: `Company${i} raises $20 million Series A` })
    );
    expect(selectBriefEdition(edition(funds)).items).toHaveLength(2);
  });

  it('keeps all-stories page one distinct from the front and preserves day and region', () => {
    expect(briefNewsPageHref({ page: 1, day: 'yesterday', region: 'south-asia', all: true })).toBe(
      '/?region=south-asia&day=yesterday&news_page=1#news'
    );
    expect(briefNewsPageHref({ page: 1, day: 'yesterday', region: 'south-asia' })).toBe(
      '/?region=south-asia&day=yesterday#news'
    );
  });

  it('rejects the observed weather, routine government and unrelated excerpt failures', () => {
    const bad = [
      story('intel-memo', {
        title: 'Scoop: U.S. intel memo warns of advanced Iranian plots to kill officials abroad',
      }),
      story('weather', {
        title:
          'Small Craft Advisory: Coastal waters east of Ipswich Bay and the Stellwagen Bank National Marine Sanctuary',
        summary:
          'Severe Thunderstorm Warning — Buena Vista, IA; Clay, IA. The warning will expire.',
      }),
      story('bill', { title: 'Congress: To amend the Internal Revenue Code for agricultural use' }),
      story('digest', {
        title: 'Infosys AI revenue jumps 29%; Apple’s foldable iPhone fully pre-booked in week 1',
        summary:
          'Dear Reader, Cybercriminals turned a software disclosure into an opportunity. Cloudflare detected attempts to exploit vulnerabilities in PHP.',
      }),
      story('navigation', {
        title: 'IBM CEO says open weight models are now irresistibly good and cheap on-prem',
        summary:
          'AI - Nvidia woos wary Europeans with more open weights models. New embedding and reranking models promise smarter agentic RAG workflows.',
      }),
    ];
    const supported = story('minimax', {
      title: 'MiniMax releases open weights for M3.1 Flash model',
      summary:
        'MiniMax released the weights for its M3.1 Flash model for developers to download and deploy.',
    });
    const brief = edition([...bad, supported]);
    expect(selectBriefEdition(brief).items.map(({ story }) => story.id)).toEqual(['minimax']);
    expect(brief.news).toHaveLength(6);
  });

  it('groups the same named biosecurity investment with matching currency amount', () => {
    const news = [
      story('bbc', { title: 'UK to invest £100m in world first AI Biosecurity Lab' }),
      story('bloomberg', {
        title: 'UK Vows £100 Million for Biosecurity Lab With OpenAI, Anthropic',
      }),
      story('other-lab', {
        title: 'UK Vows £200 Million for Biosecurity Lab With OpenAI, Anthropic',
      }),
      story('different-unit', {
        title: 'UK Vows £100 Billion for Biosecurity Lab With OpenAI, Anthropic',
      }),
      story('intel-chip', { title: 'Intel releases a new chip architecture' }),
    ];
    const result = selectBriefEdition(edition(news));
    expect(result.items).toHaveLength(4);
    expect(
      result.items.find(({ story }) => story.id === 'bbc')?.related.map(({ id }) => id)
    ).toEqual(['bloomberg']);
    expect(result.items.some(({ story }) => story.id === 'intel-chip')).toBe(true);
  });
});
