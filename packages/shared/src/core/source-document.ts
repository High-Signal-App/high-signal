/** Stable URL identity shared by event retention and signal-proof sync. */
export function canonicalSourceUrl(value: string): string {
  if (!value || value.startsWith('/')) return value.trim();
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^ref$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}
