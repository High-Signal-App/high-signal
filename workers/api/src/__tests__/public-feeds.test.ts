import { describe, expect, it, vi, afterEach } from 'vitest';
import { FixtureHTMLRewriter } from '../../test/html-rewriter-fixture';
import { knownPublicArchive } from '../lib/public-archives';
afterEach(() => vi.unstubAllGlobals());
import {
  discoverPublicFeed,
  isPublicFeedAddress,
  parseFeedDocument,
  publicFeedIdentity,
  publicFeedUrl,
} from '../lib/public-feeds';
import { RSS_FIXTURE, feedTransport } from '../../test/feed-fixtures';

describe('public feed discovery', () => {
  it('parses RSS, Atom and RSS 1.0 metadata without mirroring entry HTML', () => {
    expect(parseFeedDocument(RSS_FIXTURE, 'https://publisher.example.org/feed')).toMatchObject({
      title: 'Research & engineering',
      format: 'rss',
      articleCount: 1,
      lastPublishedAt: Date.parse('2026-10-23T12:00:00Z') / 1000,
    });
    expect(
      parseFeedDocument(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">An Atom feed</title>
      <entry><title>A post</title><updated>2026-10-23T12:00:00Z</updated><link href="/post"/></entry></feed>`,
        'https://publisher.example.org/atom'
      )
    ).toMatchObject({
      title: 'An Atom feed',
      format: 'atom',
      articleCount: 1,
    });
    expect(
      parseFeedDocument(
        `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RSS One</title></channel><item><title>A post</title></item></rdf:RDF>`,
        'https://publisher.example.org/rss'
      )
    ).toMatchObject({
      title: 'RSS One',
      format: 'rss',
      articleCount: 1,
    });
  });

  it('accepts a valid quiet feed, rejects malformed XML and blocks entity declarations', () => {
    expect(
      parseFeedDocument(
        '<rss><channel><title>Quiet</title></channel></rss>',
        'https://publisher.example.org/feed'
      )?.articleCount
    ).toBe(0);
    expect(
      parseFeedDocument('<rss><channel></rss>', 'https://publisher.example.org/feed')
    ).toBeNull();
    expect(() =>
      parseFeedDocument(
        '<!DOCTYPE rss [<!ENTITY boom "hello">]><rss><channel/></rss>',
        'https://publisher.example.org/feed'
      )
    ).toThrow('entity');
  });

  it('accepts bare public URLs and gives aliases the same identity', () => {
    expect(publicFeedUrl('writer.substack.com#latest').href).toBe('https://writer.substack.com/');
    expect(publicFeedIdentity('https://www.publisher.example.org/feed/?utm_source=mail')).toBe(
      publicFeedIdentity('https://publisher.example.org/feed')
    );
    expect(publicFeedIdentity('https://publisher.example.org/feed?topic=ai')).not.toBe(
      publicFeedIdentity('https://publisher.example.org/feed?topic=business')
    );
  });

  it.each([
    'file:///private/feed',
    'http://localhost/feed',
    'http://127.0.0.1/feed',
    'http://2130706433/feed',
    'http://[::1]/feed',
    'http://169.254.169.254/latest',
    'https://publisher.internal/feed',
    'https://user:password@publisher.example.org/feed',
    'https://publisher.example.org:8443/feed',
    'https://publisher.example.org/feed?utm_source=x&token=private',
  ])('rejects a non-public or credential-bearing URL: %s', (value) => {
    expect(() => publicFeedUrl(value)).toThrow();
  });

  it('checks resolved addresses and every redirect before requesting a target', async () => {
    const requested: string[] = [];
    const transport = async (url: string, init: RequestInit) => {
      requested.push(url);
      if (new URL(url).hostname === 'cloudflare-dns.com') return feedTransport()(url, init);
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
    };
    await expect(
      discoverPublicFeed('https://publisher.example.org/feed', transport)
    ).rejects.toThrow('public');
    expect(requested.some((url) => url.includes('127.0.0.1'))).toBe(false);
    const privateDns = async () => Response.json({ Answer: [{ type: 1, data: '10.0.0.1' }] });
    await expect(
      discoverPublicFeed('https://publisher.example.org/feed', privateDns)
    ).rejects.toThrow('public internet');
    for (const address of [
      '127.0.0.1',
      '10.2.3.4',
      '100.64.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
    ]) {
      expect(isPublicFeedAddress(address), address).toBe(false);
    }
  });

  it('resolves Substack publication URLs directly to their public feed', async () => {
    const requested: string[] = [];
    const transport = async (url: string, init: RequestInit) => {
      requested.push(url);
      return feedTransport()(url, init);
    };
    expect(
      await discoverPublicFeed('https://writer.substack.com/p/a-post', transport)
    ).toMatchObject({
      feedUrl: 'https://writer.substack.com/feed',
      format: 'rss',
      articleCount: 1,
    });
    expect(requested.filter((url) => !url.includes('cloudflare-dns.com'))).toEqual([
      'https://writer.substack.com/feed',
    ]);
  });

  it('bounds decompressed downloads rather than trusting Content-Length', async () => {
    const transport = async (url: string, init: RequestInit) => {
      if (url.includes('cloudflare-dns.com')) return feedTransport()(url, init);
      return new Response('x'.repeat(2 * 1024 * 1024 + 1));
    };
    await expect(
      discoverPublicFeed('https://publisher.example.org/feed', transport)
    ).rejects.toThrow('2 MB');
  });
});

describe('known public archive discovery', () => {
  it.each([
    [
      'https://www.deeplearning.ai/the-batch',
      '/the-batch/issue-400',
      'The Batch (DeepLearning.AI)',
    ],
    [
      'https://stratechery.com/category/articles/',
      '/2026/a-free-article/',
      'Stratechery Weekly Articles (free)',
    ],
    ['https://www.bayareatimes.com/', '/p/a-public-issue', 'Bay Area Times'],
    ['https://vcunfiltered.beehiiv.com/', '/p/a-public-issue', 'VC Unfiltered'],
    ['https://archive.internetisbeautiful.com/', '/p/a-public-issue', 'Internet Is Beautiful'],
    ['https://www.cerebras.ai/blog', '/blog/a-public-article', 'Cerebras Blog'],
  ])('validates only supported listing links: %s', async (url, path, title) => {
    vi.stubGlobal('HTMLRewriter', FixtureHTMLRewriter);
    const html = `<html><li class="category-articles"><a href="${path}">Article</a></li>
      <a href="https://unrelated.example.org/p/offsite">Offsite</a><a href="/account">Account</a></html>`;
    const result = await discoverPublicFeed(url, feedTransport(html));
    expect(result).toMatchObject({
      format: 'archive',
      title,
      articleCount: 1,
      lastPublishedAt: null,
    });
  });

  it('resolves a known retired feed alias, keeps the canonical listing identity, and excludes paid Stratechery sections', async () => {
    vi.stubGlobal('HTMLRewriter', FixtureHTMLRewriter);
    const html =
      '<a href="/2026/paid-update/">Paid</a><li class="category-articles"><a href="/2026/free-article/">Free</a></li>';
    const result = await discoverPublicFeed(
      'https://stratechery.com/category/articles/feed/',
      feedTransport(html)
    );
    expect(result).toMatchObject({
      format: 'archive',
      feedUrl: 'https://stratechery.com/category/articles/',
      articleCount: 1,
    });
    expect(knownPublicArchive('https://stratechery.com/')).toBeNull();
    expect(knownPublicArchive('https://unlisted.beehiiv.com/')).toBeNull();
    expect(knownPublicArchive('https://www.cerebras.ai/blog/private-area')).toBeNull();
    await expect(
      discoverPublicFeed('https://unlisted.beehiiv.com/', feedTransport(html))
    ).rejects.toThrow('No RSS or Atom');
  });

  it('does not replace a valid explicit RSS feed with an archive or accept an empty listing', async () => {
    vi.stubGlobal('HTMLRewriter', FixtureHTMLRewriter);
    expect(
      (await discoverPublicFeed('https://www.deeplearning.ai/the-batch/feed/', feedTransport()))
        .format
    ).toBe('rss');
    await expect(
      discoverPublicFeed(
        'https://www.deeplearning.ai/the-batch',
        feedTransport('<html>No articles</html>')
      )
    ).rejects.toThrow('no supported article links');
  });
});
