/**
 * Canonical site constants — used by every metadata/SEO surface so we
 * never split link equity between the apex domain and the underlying
 * Cloudflare Workers hostname again.
 */

export const SITE_URL = 'https://highsignal.app';
export const SITE_NAME = 'High Signal';
export const SITE_TAGLINE = 'Daily Brief on technology, startups, and finance';
export const SITE_DESCRIPTION =
  'High Signal is a daily synthesized brief on technology, startups, and finance. ' +
  'Five sections, hit-rate inline on every market call, ≥ 2 citations per claim, ' +
  'regional filter, no signup required.';
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
