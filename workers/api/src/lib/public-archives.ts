import catalog from '../../../../python/ingest/src/high_signal_ingest/seed/public-archives.json';

type Archive = (typeof catalog)[number];

function archiveIdentity(value: string): string {
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
}

/** Exact configured listing/legacy aliases only; no arbitrary Beehiiv sites or paid sections. */
export function knownPublicArchive(value: string): Archive | null {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.search ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const key = archiveIdentity(value);
  return (
    catalog.find((archive) =>
      [archive.url, ...archive.aliases].some((alias) => archiveIdentity(alias) === key)
    ) ?? null
  );
}

export async function validatePublicArchive(html: string, listingUrl: string, archive: Archive) {
  if (knownPublicArchive(listingUrl)?.id !== archive.id) {
    throw new Error('Public archive redirected outside its supported listing.');
  }
  const base = new URL(listingUrl);
  const links = new Set<string>();
  const selector =
    archive.kind === 'stratechery'
      ? 'li.category-articles a'
      : archive.kind === 'firstround'
        ? 'article[data-post-card-wrapper] a'
        : 'a';
  const patterns: Record<string, RegExp> = {
    batch: /^\/the-batch\/issue-\d+\/?$/,
    stratechery: /^\/\d{4}\/[^/]+\/?$/,
    beehiiv: /^\/p\/[^/]+\/?$/,
    cerebras: /^\/blog\/[^/]+\/?$/,
    firstround: /^\/[^/]+\/?$/,
  };
  await new HTMLRewriter()
    .on(selector, {
      element(element) {
        const href = element.getAttribute('href');
        if (!href || links.size >= 12) return;
        try {
          const url = new URL(href, base);
          if (
            url.origin !== base.origin ||
            url.search ||
            url.username ||
            url.password ||
            !patterns[archive.kind].test(url.pathname)
          )
            return;
          url.hash = '';
          links.add(url.href);
        } catch {
          /* Malformed links are not candidates. */
        }
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  if (!links.size) throw new Error('Public archive contained no supported article links.');
  return {
    feedUrl: archive.url,
    title: archive.title,
    format: 'archive' as const,
    articleCount: links.size,
    // A listing is discovery only. Dates and freely accessible bodies are
    // validated by the bounded recurring collector before retaining articles.
    lastPublishedAt: null,
  };
}
