/**
 * Tests for the SEO/GEO auditor.
 *
 * We can't easily test the network-touching `runSeoAudit` in unit form
 * without a fixtures harness, so this file exercises the integration
 * surface via a mocked global fetch — verifying that a well-formed page
 * yields the right band, and a 404 yields the right error.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSeoAudit } from '../lib/seo-audit';

const originalFetch = globalThis.fetch;

const STRONG_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<title>High Signal — Daily Brief on technology, startups, and finance</title>
<meta name="description" content="Daily synthesized brief covering technology, startups, and finance with cited evidence and inline hit-rate per signal type." />
<link rel="canonical" href="https://example.com/" />
<meta property="og:title" content="High Signal" />
<meta property="og:description" content="Daily brief." />
<meta property="og:image" content="https://example.com/og.png" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="alternate" type="application/rss+xml" href="https://example.com/rss.xml" />
<link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Example"}</script>
</head><body></body></html>`;

const WEAK_HTML = `<!DOCTYPE html><html><head><title>X</title></head><body></body></html>`;

function mockFetch(routes: Record<string, () => Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : ((input as Request).url ?? (input as URL).toString());
    // Match by full path so "://example.com/" doesn't also catch "/llms.txt".
    try {
      const u = new URL(url);
      const fullPath = u.pathname;
      for (const [pattern, handler] of Object.entries(routes)) {
        if (pattern === fullPath || pattern === url) return handler();
      }
    } catch {
      /* fall through */
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('runSeoAudit', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 'missing' band on a fetch failure", async () => {
    mockFetch({});
    const report = await runSeoAudit('https://example.com/');
    expect(report.error).not.toBeNull();
    expect(report.band).toBe('missing');
    expect(report.score).toBe(0);
  });

  it('returns invalid_url for non-URL input', async () => {
    const report = await runSeoAudit('not a url');
    expect(report.error).toBe('invalid_url');
  });

  it("grades a fully-instrumented page as 'strong'", async () => {
    mockFetch({
      '/llms.txt': () => new Response('# llms.txt', { status: 200 }),
      '/robots.txt': () => new Response('User-agent: *', { status: 200 }),
      '/sitemap.xml': () => new Response('<urlset/>', { status: 200 }),
      '/': () =>
        new Response(STRONG_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    });
    const report = await runSeoAudit('https://example.com/');
    expect(report.error).toBeNull();
    expect(report.band).toBe('strong');
    expect(report.score).toBeGreaterThanOrEqual(80);
    expect(report.geoScore).toBeGreaterThanOrEqual(70);

    const get = (key: string) => report.checks.find((c) => c.key === key);
    expect(get('json-ld')?.status).toBe('strong');
    expect(get('llms-txt')?.status).toBe('strong');
    expect(get('robots')?.status).toBe('strong');
    expect(get('sitemap')?.status).toBe('strong');
    expect(get('canonical')?.status).toBe('strong');
    expect(get('open-graph')?.status).toBe('strong');
    expect(get('twitter-card')?.status).toBe('strong');
    expect(get('feeds')?.status).toBe('strong');
    expect(report.evidenceUrls.length).toBeGreaterThan(3);
  });

  it("grades a minimal page as 'missing'", async () => {
    mockFetch({
      '/': () => new Response(WEAK_HTML, { status: 200 }),
      // Explicit 404s on the discovery files (default catch-all).
    });
    const report = await runSeoAudit('https://example.com/');
    expect(report.error).toBeNull();
    expect(report.score).toBeLessThan(40);
    const get = (key: string) => report.checks.find((c) => c.key === key);
    expect(get('json-ld')?.status).toBe('missing');
    expect(get('llms-txt')?.status).toBe('missing');
    expect(get('sitemap')?.status).toBe('missing');
    expect(get('open-graph')?.status).toBe('missing');
    expect(get('canonical')?.status).toBe('missing');
  });

  it("flags multiple canonicals as 'weak'", async () => {
    const html = `<html><head>
<title>X</title>
<meta name="description" content="exactly the kind of description we expect" />
<link rel="canonical" href="https://example.com/a" />
<link rel="canonical" href="https://example.com/b" />
</head></html>`;
    mockFetch({
      '/': () => new Response(html, { status: 200 }),
    });
    const report = await runSeoAudit('https://example.com/');
    expect(report.checks.find((c) => c.key === 'canonical')?.status).toBe('weak');
  });
});
