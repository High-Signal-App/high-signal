export const RSS_FIXTURE = `<rss version="2.0"><channel><title>Research &amp; engineering</title>
  <item><title>New research tools</title><link>https://publisher.example.org/tools</link><pubDate>Fri, 23 Oct 2026 12:00:00 GMT</pubDate>
  <description><![CDATA[<p>Retained article text for the new research tools.</p>]]></description></item>
</channel></rss>`;

export function feedTransport(document = RSS_FIXTURE) {
  return async (value: string, _init: RequestInit) => {
    const url = new URL(value);
    if (url.hostname === 'cloudflare-dns.com') {
      return Response.json({
        Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '8.8.8.8' }] : [],
      });
    }
    return new Response(document, { headers: { 'Content-Type': 'application/rss+xml' } });
  };
}
