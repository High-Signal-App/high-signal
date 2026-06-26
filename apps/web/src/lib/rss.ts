/**
 * Minimal RSS 2.0 builder. Public-feed surfaces in agents.md (per-signal
 * + weekly digest) consume this. Keep dependency-free so it stays cheap
 * at the worker edge.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: Date;
  categories?: string[];
}

export interface RssFeed {
  title: string;
  link: string;
  description: string;
  language?: string;
  lastBuildDate?: Date;
  items: RssItem[];
}

export function buildRssXml(feed: RssFeed): string {
  const last = feed.lastBuildDate ?? new Date();
  const items = feed.items
    .map((item) => {
      const cats = (item.categories ?? [])
        .map((c) => `      <category>${escapeXml(c)}</category>`)
        .join('\n');
      return [
        '    <item>',
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>`,
        `      <pubDate>${item.pubDate.toUTCString()}</pubDate>`,
        `      <description>${escapeXml(item.description)}</description>`,
        cats,
        '    </item>',
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.link)}</link>
    <description>${escapeXml(feed.description)}</description>
    <language>${feed.language ?? 'en'}</language>
    <lastBuildDate>${last.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feed.link)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

/**
 * Extract a one-line headline from a signal's markdown body. Mirrors
 * SignalCard's display: first line, leading "#" stripped, falling back
 * to a slug if the body is empty.
 */
export function signalHeadline(bodyMd: string | undefined, slug: string): string {
  if (!bodyMd) return slug;
  const first =
    bodyMd
      .split('\n')
      .map((line) =>
        line
          .replace(/^>\s*/, '')
          .replace(/^#+\s*/, '')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
          .replace(/https?:\/\/\S+/g, '')
          .replace(/[_*`]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .find((line) => line.length > 0 && !line.toLowerCase().includes('backfill')) ?? '';
  const cleaned = first.trim();
  return cleaned.length > 0 ? cleaned : slug;
}

/** A short plain-text excerpt of a signal body, suitable for RSS description. */
export function signalExcerpt(bodyMd: string | undefined, maxChars = 800): string {
  if (!bodyMd) return '';
  // Drop the first line (used as title) and any leading whitespace.
  const rest = bodyMd
    .split('\n')
    .slice(1)
    .map((line) =>
      line
        .replace(/^>\s*/, '')
        .replace(/^#+\s*/, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[_*`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((line) => line.length > 0 && !line.toLowerCase().includes('backfill'))
    .join(' ');
  if (rest.length === 0) return '';
  if (rest.length <= maxChars) return rest;
  return rest.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}
