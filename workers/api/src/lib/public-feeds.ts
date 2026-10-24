import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { knownPublicArchive, validatePublicArchive } from './public-archives';

const MAX_BYTES = 2 * 1024 * 1024;
type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;

export class PublicFeedError extends Error {}

/** Only public, credential-free publication URLs belong in the shared registry. */
export function publicFeedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new PublicFeedError('Enter a public website or RSS/Atom feed URL.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes('.') ||
    host.startsWith('[') ||
    /^\d[\d.]*$/.test(host) ||
    /\.(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)
  )
    throw new PublicFeedError('Use a public HTTP or HTTPS hostname without credentials.');
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^(?:token|access_token|key|api_key|auth|signature|password|secret|jwt|subscriber_id)$/i.test(
        key
      )
    ) {
      throw new PublicFeedError(
        'Private or authenticated feed URLs cannot enter the public publication.'
      );
    }
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = host;
  url.hash = '';
  url.searchParams.sort();
  return url;
}

export function publicFeedIdentity(value: string): string {
  const url = publicFeedUrl(value);
  url.hostname = url.hostname.replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

export function isPublicFeedAddress(address: string): boolean {
  if (address.includes(':')) {
    return (
      /^[23][\da-f]{0,3}:/i.test(address) && !/^(?:2001:(?:0*:|db8:)|2002:|3fff:)/i.test(address)
    );
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b, c] = parts;
  if ([0, 10, 127].includes(a) || a >= 224) return false;
  return !isReservedIpv4Range(a, b, c);
}

function isReservedIpv4Range(a: number, b: number, c: number): boolean {
  const reserved = [
    a === 100 && b >= 64 && b <= 127,
    a === 169 && b === 254,
    a === 172 && b >= 16 && b <= 31,
    a === 192 && [0, 168].includes(b),
    a === 198 && [18, 19].includes(b),
    a === 198 && b === 51 && c === 100,
    a === 203 && b === 0 && c === 113,
  ];
  return reserved.some(Boolean);
}

const dnsSchema = z.object({
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

async function checkPublicHost(
  host: string,
  request: FeedFetch,
  signal: AbortSignal
): Promise<void> {
  const results = await Promise.all(
    ['A', 'AAAA'].map(async (type) => {
      const response = await request(
        `https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name: host, type })}`,
        {
          headers: { Accept: 'application/dns-json' },
          signal,
          redirect: 'manual',
        }
      );
      if (!response.ok) throw new PublicFeedError('Could not resolve the feed hostname.');
      const result = dnsSchema.parse(JSON.parse(await boundedText(response)));
      return (result.Answer ?? [])
        .filter((answer) => answer.type === 1 || answer.type === 28)
        .map((answer) => answer.data);
    })
  );
  const addresses = results.flat();
  if (!addresses.length || addresses.some((address) => !isPublicFeedAddress(address))) {
    throw new PublicFeedError('The feed hostname must resolve only to public internet addresses.');
  }
}

async function boundedText(response: Response, allowPrefix = false): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      if (bytes + chunk.value.byteLength > MAX_BYTES) {
        await reader.cancel();
        if (!allowPrefix) throw new PublicFeedError('The feed exceeds the 2 MB download limit.');
        return text + decoder.decode(chunk.value.subarray(0, MAX_BYTES - bytes)) + decoder.decode();
      }
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchPublicDocument(
  input: URL,
  request: FeedFetch,
  signal: AbortSignal,
  allowPrefix = false
) {
  let url = input;
  for (let redirect = 0; redirect <= 4; redirect++) {
    await checkPublicHost(url.hostname, request, signal);
    const response = await request(url.href, {
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, text/html;q=0.8',
        'User-Agent': 'HighSignal-feed-discovery/1 (+https://highsignal.app)',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new PublicFeedError('The publisher returned an invalid redirect.');
      url = publicFeedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublicFeedError(`The publisher returned HTTP ${response.status}.`);
    }
    return { url, text: await boundedText(response, allowPrefix) };
  }
  throw new PublicFeedError('The publisher redirected too many times.');
}

const xmlText = z.union([z.string(), z.object({ '#text': z.string() })]);
const xmlLink = z.union([
  z.string(),
  z.object({ '@_href': z.string(), '@_rel': z.string().optional() }),
]);
const entrySchema = z.object({
  title: xmlText.optional(),
  link: z.union([xmlLink, z.array(xmlLink)]).optional(),
  pubDate: xmlText.optional(),
  published: xmlText.optional(),
  updated: xmlText.optional(),
  date: xmlText.optional(),
});
const entriesSchema = z.union([entrySchema, z.array(entrySchema)]).optional();
const channelSchema = z.object({ title: xmlText.optional(), item: entriesSchema });
const documentSchema = z.object({
  rss: z.object({ channel: channelSchema }).optional(),
  feed: z.object({ title: xmlText.optional(), entry: entriesSchema }).optional(),
  RDF: z.object({ channel: channelSchema, item: entriesSchema }).optional(),
});

function textValue(value: z.infer<typeof xmlText> | undefined): string {
  return typeof value === 'string' ? value : (value?.['#text'] ?? '');
}

export function parseFeedDocument(xml: string, feedUrl: string) {
  if (/^\s*<!doctype\s+html\b/i.test(xml)) return null;
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(markup))
    throw new PublicFeedError('Feeds with DTD or entity declarations are unsupported.');
  if (XMLValidator.validate(xml) !== true) return null;
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    maxNestedTags: 64,
  }).parse(xml);
  const result = documentSchema.safeParse(parsed);
  if (!result.success) return null;
  return feedMetadata(result.data, feedUrl);
}

function feedMetadata(root: z.infer<typeof documentSchema>, feedUrl: string) {
  const channel = root.rss?.channel ?? root.RDF?.channel;
  if (!channel && !root.feed) return null;
  const entries = root.feed?.entry ?? root.RDF?.item ?? channel?.item ?? [];
  const rows = Array.isArray(entries) ? entries : [entries];
  return {
    feedUrl,
    title:
      textValue(root.feed?.title ?? channel?.title)
        .trim()
        .slice(0, 240) || new URL(feedUrl).hostname,
    format: root.feed ? ('atom' as const) : ('rss' as const),
    articleCount: rows.length,
    lastPublishedAt: latestEntryDate(rows),
  };
}

function latestEntryDate(rows: z.infer<typeof entrySchema>[]): number | null {
  const dates = rows
    .map((entry) =>
      Date.parse(textValue(entry.published ?? entry.pubDate ?? entry.updated ?? entry.date))
    )
    .filter(Number.isFinite);
  return dates.length ? Math.floor(Math.max(...dates) / 1000) : null;
}

async function discoverLinks(html: string, base: URL): Promise<URL[]> {
  const urls = new Map<string, URL>();
  await new HTMLRewriter()
    .on('link', {
      element(element) {
        if (!element.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('alternate')) return;
        if (!/application\/(?:rss|atom)\+xml/i.test(element.getAttribute('type') ?? '')) return;
        const href = element.getAttribute('href');
        if (!href || urls.size >= 3) return;
        try {
          const url = publicFeedUrl(new URL(href, base).href);
          urls.set(url.href, url);
        } catch {
          /* Unsafe discovery links are never fetched. */
        }
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  return [...urls.values()];
}

export async function discoverPublicFeed(input: string, request: FeedFetch = fetch) {
  const submitted = publicFeedUrl(input.trim());
  const firstUrl = submitted.hostname.endsWith('.substack.com')
    ? publicFeedUrl(new URL('/feed', submitted).href)
    : submitted;
  const signal = AbortSignal.timeout(15_000);
  const archive = knownPublicArchive(submitted.href);
  let document;
  try {
    document = await fetchPublicDocument(firstUrl, request, signal);
  } catch (error) {
    if (!archive) throw error;
    document = await fetchPublicDocument(publicFeedUrl(archive.url), request, signal, true);
  }
  const direct = parseFeedDocument(document.text, document.url.href);
  if (direct) return { ...direct, url: submitted.href };
  if (archive) {
    const listing =
      publicFeedIdentity(document.url.href) === publicFeedIdentity(archive.url)
        ? document
        : await fetchPublicDocument(publicFeedUrl(archive.url), request, signal, true);
    try {
      return {
        ...(await validatePublicArchive(listing.text, listing.url.href, archive)),
        url: submitted.href,
      };
    } catch (error) {
      throw new PublicFeedError(
        error instanceof Error ? error.message : 'Unsupported public archive.'
      );
    }
  }
  const links = await discoverLinks(document.text, document.url);
  let lastError: unknown;
  for (const url of links) {
    try {
      const candidate = await fetchPublicDocument(url, request, signal);
      const feed = parseFeedDocument(candidate.text, candidate.url.href);
      if (feed) return { ...feed, url: submitted.href };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof PublicFeedError) throw lastError;
  throw new PublicFeedError('No RSS or Atom feed found. Paste the publication’s direct feed URL.');
}
