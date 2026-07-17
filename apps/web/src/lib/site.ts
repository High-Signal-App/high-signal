/**
 * Canonical site constants — used by every metadata/SEO surface so we
 * never split link equity between the apex domain and the underlying
 * Cloudflare Workers hostname again.
 */

export const SITE_URL = 'https://highsignal.app';
export const SITE_NAME = 'High Signal';
export const SITE_TAGLINE = 'Evidence-first intelligence brief';
export const SITE_DESCRIPTION =
  'High Signal is evidence-first intelligence on technology, startups, and finance. ' +
  'Every claim cites two sources and a public hit-rate ledger.';
export const SITE_PUBLISHER = 'High Signal';
export const SITE_LOCALE = 'en';
export const SITE_TWITTER = '@sarthakagrawal';

/**
 * The agent / search engine should think of these as the canonical sub-surfaces.
 * Ordered roughly by priority for crawlers.
 */
export const SITE_KEY_PATHS = [
  '/',
  '/brief',
  '/track-record',
  '/signals',
  '/signals/today',
  '/digest',
  '/digest/rss',
  '/digest/atom',
  '/markets',
  '/communities',
  '/mentions',
  '/agent-eval',
  '/lab',
  '/entities',
  '/sectors',
  '/opportunities',
  '/ideas',
  '/personal',
  '/about',
] as const;

export function absoluteUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Clamp a meta description to the 70–160 char SEO sweet spot.
 * - Too long: truncate at the last word boundary ≤ 160 and append "…".
 * - Too short: fall back to the site default description if available.
 * - In range: pass through unchanged.
 */
export function clampDescription(desc: string, fallback: string = SITE_DESCRIPTION): string {
  let d = (desc ?? '').trim();
  if (d.length === 0) return fallback;
  if (d.length > 160) {
    d = d
      .slice(0, 157)
      .replace(/\s+\S*$/, '')
      .trim();
    if (d.length > 0) d += '…';
    return d;
  }
  if (d.length < 70) {
    const f = fallback.trim();
    if (f.length >= 70 && f.length <= 160) return f;
    if (d.length > 0 && f.length > 0) {
      const combined = `${d}. ${f}`;
      if (combined.length <= 160) return combined;
      return `${combined
        .slice(0, 157)
        .replace(/\s+\S*$/, '')
        .trim()}…`;
    }
    return f || d;
  }
  return d;
}
