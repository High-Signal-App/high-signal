/**
 * SEO/GEO technical auditor.
 *
 * Fetches a URL and grades the technical primitives that determine
 * whether a brand surfaces in:
 *
 *   SEO — traditional search (Google, Bing): sitemap, robots, canonical,
 *         OG, Twitter card, JSON-LD (esp. Organization + WebSite +
 *         Article / Product schemas).
 *   GEO — generative-engine optimization (ChatGPT, Claude, Perplexity,
 *         Gemini): llms.txt, structured data, multi-source citations,
 *         declarative content the model can lift.
 *
 * Designed to run inside a Cloudflare Worker — no Node-specific deps,
 * uses native `fetch` and regex parsing rather than a DOM library so
 * the bundle stays small. Used by /products/agent-eval/seo-audit.
 *
 * High Signal's own Agent Eval product audits content quality. This
 * module is the missing twin: it audits the TECHNICAL primitives the
 * content sits on. Together they cover the full surface a brand needs
 * to be both legible to humans (SEO) and citable by agents (GEO).
 */

export interface SeoCheck {
  key: string;
  title: string;
  /** SEO / GEO / both — which axis this primitive lives on. */
  axis: 'seo' | 'geo' | 'both';
  status: 'strong' | 'clear' | 'weak' | 'missing';
  notes: string;
  /** Concrete one-line fix the operator should apply. */
  recommendation: string;
}

export interface SeoAuditReport {
  url: string;
  fetchedAt: string;
  finalUrl: string;
  status: number | null;
  /** Overall score 0–100 weighted by axis. */
  score: number;
  seoScore: number;
  geoScore: number;
  /** Quick read for the brief card. */
  band: 'strong' | 'clear' | 'weak' | 'missing';
  checks: SeoCheck[];
  /** All evidence URLs we surfaced (sitemaps, feeds, llms.txt). */
  evidenceUrls: string[];
  error: string | null;
}

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'HighSignal-SeoAuditor/1.0 (+https://highsignal.app)';

function statusScore(status: SeoCheck['status']): number {
  switch (status) {
    case 'strong':
      return 100;
    case 'clear':
      return 70;
    case 'weak':
      return 40;
    case 'missing':
      return 0;
  }
}

function bandFor(score: number): SeoAuditReport['band'] {
  if (score >= 80) return 'strong';
  if (score >= 55) return 'clear';
  if (score >= 25) return 'weak';
  return 'missing';
}

async function safeFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Extract a meta-style value from a parsed head segment. Regex chosen over
 * a real DOM parser because we're in a worker bundle — no DOMParser, no
 * cheerio, and meta tags are flat enough that regex is honest here.
 */
function meta(head: string, attr: 'name' | 'property', value: string): string | null {
  const re = new RegExp(
    `<meta\\s+(?:[^>]*\\s+)?${attr}=["']${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["'][^>]*?content=["']([^"']*)["']`,
    'i'
  );
  const m = re.exec(head);
  if (m) return m[1] ?? null;
  // Also try content-before-name ordering.
  const re2 = new RegExp(
    `<meta\\s+(?:[^>]*\\s+)?content=["']([^"']*)["'][^>]*?${attr}=["']${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']`,
    'i'
  );
  const m2 = re2.exec(head);
  return m2?.[1] ?? null;
}

function linkRel(head: string, rel: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<link\\s+(?:[^>]*\\s+)?rel=["']${rel}["'][^>]*?href=["']([^"']+)["']`,
    'gi'
  );
  for (const m of head.matchAll(re)) {
    if (m[1]) out.push(m[1]);
  }
  const re2 = new RegExp(
    `<link\\s+(?:[^>]*\\s+)?href=["']([^"']+)["'][^>]*?rel=["']${rel}["']`,
    'gi'
  );
  for (const m of head.matchAll(re2)) {
    if (m[1]) out.push(m[1]);
  }
  return Array.from(new Set(out));
}

function ldJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      // tolerate broken JSON — count as 0 valid blocks
    }
  }
  return blocks;
}

function ldTypes(blocks: unknown[]): string[] {
  const types: string[] = [];
  for (const b of blocks) {
    if (b && typeof b === 'object' && '@type' in (b as Record<string, unknown>)) {
      const t = (b as Record<string, unknown>)['@type'];
      if (typeof t === 'string') types.push(t);
    }
  }
  return types;
}

function titleOf(head: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(head);
  return m ? (m[1]?.trim() ?? null) : null;
}

/** Run a HEAD probe for a known-good resource. */
async function probe(
  url: string
): Promise<{ ok: boolean; status: number | null; bytes: number | null }> {
  // Some hosts block HEAD; fall back to GET with a small range.
  let r = await safeFetch(url, { method: 'HEAD' });
  if (!r || r.status === 405 || r.status === 403) {
    r = await safeFetch(url, { method: 'GET', headers: { Range: 'bytes=0-1024' } });
  }
  if (!r) return { ok: false, status: null, bytes: null };
  const lenHeader = r.headers.get('Content-Length');
  const bytes = lenHeader ? Number(lenHeader) || null : null;
  return { ok: r.ok, status: r.status, bytes };
}

export async function runSeoAudit(rawUrl: string): Promise<SeoAuditReport> {
  const fetchedAt = new Date().toISOString();
  const origin = normalizeOrigin(rawUrl);
  if (!origin) {
    return {
      url: rawUrl,
      fetchedAt,
      finalUrl: rawUrl,
      status: null,
      score: 0,
      seoScore: 0,
      geoScore: 0,
      band: 'missing',
      checks: [],
      evidenceUrls: [],
      error: 'invalid_url',
    };
  }

  const pageResp = await safeFetch(rawUrl);
  if (!pageResp || !pageResp.ok) {
    return {
      url: rawUrl,
      fetchedAt,
      finalUrl: pageResp?.url ?? rawUrl,
      status: pageResp?.status ?? null,
      score: 0,
      seoScore: 0,
      geoScore: 0,
      band: 'missing',
      checks: [],
      evidenceUrls: [],
      error: pageResp ? `http_${pageResp.status}` : 'fetch_failed',
    };
  }
  const finalUrl = pageResp.url || rawUrl;
  const html = await pageResp.text();
  const head = html.split(/<\/head>/i)[0] ?? html;

  const checks: SeoCheck[] = [];
  const evidence = new Set<string>();
  evidence.add(finalUrl);

  // ---- 1. <title> -----------------------------------------------------
  const pageTitle = titleOf(head);
  checks.push({
    key: 'title',
    title: 'Page title',
    axis: 'seo',
    status: pageTitle && pageTitle.length >= 10 ? 'strong' : pageTitle ? 'weak' : 'missing',
    notes: pageTitle ? `Title is "${pageTitle.slice(0, 80)}".` : 'No <title> tag on the homepage.',
    recommendation: pageTitle
      ? 'Keep titles ≤ 60 chars and place the brand last so the differentiator leads.'
      : 'Add a <title> in the layout metadata; this is table-stakes for SEO.',
  });

  // ---- 2. meta description -------------------------------------------
  const metaDesc = meta(head, 'name', 'description');
  checks.push({
    key: 'meta-description',
    title: 'Meta description',
    axis: 'seo',
    status: metaDesc && metaDesc.length >= 60 ? 'strong' : metaDesc ? 'clear' : 'missing',
    notes: metaDesc ? `Description present (${metaDesc.length} chars).` : 'No meta description.',
    recommendation: metaDesc
      ? 'Aim for 110–160 chars and lead with the buyer outcome, not the brand.'
      : "Add <meta name='description'> with the value proposition in plain language.",
  });

  // ---- 3. canonical ---------------------------------------------------
  const canonicals = linkRel(head, 'canonical');
  checks.push({
    key: 'canonical',
    title: 'Canonical link',
    axis: 'seo',
    status: canonicals.length === 1 ? 'strong' : canonicals.length > 1 ? 'weak' : 'missing',
    notes:
      canonicals.length === 0
        ? "No <link rel='canonical'> tag."
        : `Canonical points at ${canonicals[0]}`,
    recommendation:
      canonicals.length === 1
        ? 'Canonical is set. Verify it points at the apex domain, not a workers.dev / vercel.app subdomain.'
        : "Add exactly one <link rel='canonical'> per page to avoid splitting link equity.",
  });

  // ---- 4. Open Graph --------------------------------------------------
  const ogTitle = meta(head, 'property', 'og:title');
  const ogDesc = meta(head, 'property', 'og:description');
  const ogImage = meta(head, 'property', 'og:image');
  const ogType = meta(head, 'property', 'og:type');
  const ogCount = [ogTitle, ogDesc, ogImage, ogType].filter(Boolean).length;
  checks.push({
    key: 'open-graph',
    title: 'Open Graph tags',
    axis: 'both',
    status: ogCount >= 4 ? 'strong' : ogCount >= 2 ? 'clear' : ogCount === 1 ? 'weak' : 'missing',
    notes: `${ogCount}/4 essential OG tags present (title / description / image / type).`,
    recommendation:
      ogCount === 4
        ? 'All four OG essentials present. Verify the image is 1200×630 and under 1MB.'
        : 'Add og:title, og:description, og:image (1200×630), og:type. Required for X/LinkedIn previews and used by AI assistants for context.',
  });

  // ---- 5. Twitter card -----------------------------------------------
  const twCard = meta(head, 'name', 'twitter:card');
  checks.push({
    key: 'twitter-card',
    title: 'Twitter / X card',
    axis: 'seo',
    status: twCard === 'summary_large_image' ? 'strong' : twCard ? 'clear' : 'missing',
    notes: twCard ? `card=${twCard}` : 'No twitter:card meta.',
    recommendation:
      twCard === 'summary_large_image'
        ? 'Best card variant for daily-content brands.'
        : "Add <meta name='twitter:card' content='summary_large_image'>.",
  });

  // ---- 6. JSON-LD structured data ------------------------------------
  const blocks = ldJsonBlocks(html);
  const types = ldTypes(blocks);
  const hasOrg = types.includes('Organization');
  const hasWebSite = types.includes('WebSite');
  const hasContent = types.some((t) =>
    [
      'Article',
      'AnalysisNewsArticle',
      'NewsArticle',
      'BlogPosting',
      'WebApplication',
      'Dataset',
      'FAQPage',
      'Product',
    ].includes(t)
  );
  const ldStatus: SeoCheck['status'] =
    blocks.length === 0
      ? 'missing'
      : hasOrg && hasWebSite && hasContent
        ? 'strong'
        : hasOrg || hasWebSite || hasContent
          ? 'clear'
          : 'weak';
  checks.push({
    key: 'json-ld',
    title: 'Schema.org JSON-LD',
    axis: 'geo',
    status: ldStatus,
    notes: blocks.length
      ? `${blocks.length} block(s), types: ${types.join(', ') || '(unknown)'}`
      : "No <script type='application/ld+json'> found.",
    recommendation:
      hasOrg && hasWebSite && hasContent
        ? 'Solid foundation. Consider adding per-page schemas (Article, FAQPage, Product) where applicable.'
        : 'Add Organization + WebSite site-wide, plus a page-specific schema (Article for posts, Product for SKUs, FAQPage for help). This is the single highest-leverage GEO change.',
  });

  // ---- 7. RSS / Atom alternates --------------------------------------
  const rss = linkRel(head, 'alternate');
  for (const u of rss) {
    const resolved = u.startsWith('http') ? u : `${origin}${u.startsWith('/') ? '' : '/'}${u}`;
    evidence.add(resolved);
  }
  checks.push({
    key: 'feeds',
    title: 'RSS / Atom feeds',
    axis: 'both',
    status: rss.length >= 2 ? 'strong' : rss.length === 1 ? 'clear' : 'missing',
    notes: rss.length ? `${rss.length} alternate feed(s).` : 'No alternate feed links declared.',
    recommendation:
      rss.length >= 2
        ? 'Two or more feed alternates is ideal — humans get the picker, agents get a crawlable stream.'
        : "Declare <link rel='alternate' type='application/rss+xml'> and/or atom for any time-series content. AI crawlers prefer these to HTML scraping.",
  });

  // ---- 8. llms.txt (GEO discovery) ----------------------------------
  const llmsUrl = `${origin}/llms.txt`;
  const llmsProbe = await probe(llmsUrl);
  if (llmsProbe.ok) evidence.add(llmsUrl);
  checks.push({
    key: 'llms-txt',
    title: 'llms.txt',
    axis: 'geo',
    status: llmsProbe.ok ? 'strong' : 'missing',
    notes: llmsProbe.ok
      ? `Present at ${llmsUrl}${llmsProbe.bytes ? ` (${llmsProbe.bytes} bytes)` : ''}.`
      : 'No /llms.txt — AI agents have no canonical discovery document for the site.',
    recommendation: llmsProbe.ok
      ? "Keep it current. Update the 'Hard rules' section when product policy changes."
      : 'Ship /llms.txt (see llmstxt.org). One markdown file describing what the site is, its claims, key machine-readable endpoints, and how to cite it.',
  });

  // ---- 9. robots.txt -------------------------------------------------
  const robotsUrl = `${origin}/robots.txt`;
  const robotsProbe = await probe(robotsUrl);
  if (robotsProbe.ok) evidence.add(robotsUrl);
  checks.push({
    key: 'robots',
    title: 'robots.txt',
    axis: 'seo',
    status: robotsProbe.ok ? 'strong' : 'missing',
    notes: robotsProbe.ok ? `Present at ${robotsUrl}.` : 'No /robots.txt.',
    recommendation: robotsProbe.ok
      ? 'Verify it includes a Sitemap: line.'
      : 'Add /robots.txt with at minimum a Sitemap: line so crawlers find the inventory.',
  });

  // ---- 10. sitemap.xml -----------------------------------------------
  const sitemapUrl = `${origin}/sitemap.xml`;
  const sitemapProbe = await probe(sitemapUrl);
  if (sitemapProbe.ok) evidence.add(sitemapUrl);
  checks.push({
    key: 'sitemap',
    title: 'sitemap.xml',
    axis: 'seo',
    status: sitemapProbe.ok ? 'strong' : 'missing',
    notes: sitemapProbe.ok ? `Present at ${sitemapUrl}.` : 'No /sitemap.xml.',
    recommendation: sitemapProbe.ok
      ? 'Include every public route with lastmod set; submit to Google Search Console once.'
      : 'Generate /sitemap.xml from the route table; trivial in Next.js, Hono, etc.',
  });

  // ---- Score ---------------------------------------------------------
  const seoChecks = checks.filter((c) => c.axis === 'seo' || c.axis === 'both');
  const geoChecks = checks.filter((c) => c.axis === 'geo' || c.axis === 'both');
  const avg = (xs: SeoCheck[]) =>
    xs.length === 0
      ? 0
      : Math.round(xs.reduce((acc, c) => acc + statusScore(c.status), 0) / xs.length);
  const seoScore = avg(seoChecks);
  const geoScore = avg(geoChecks);
  const score = Math.round(avg(checks));

  return {
    url: rawUrl,
    fetchedAt,
    finalUrl,
    status: pageResp.status,
    score,
    seoScore,
    geoScore,
    band: bandFor(score),
    checks,
    evidenceUrls: Array.from(evidence),
    error: null,
  };
}
