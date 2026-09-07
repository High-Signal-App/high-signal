/** Review identities establish a sample, never a population trend by themselves. */
function reviewIdentity(value) {
  try {
    const url = new URL(value);
    const review = url.searchParams.get('reviewId');
    const app = url.searchParams.get('id');
    if (!review || !app || !['https:', 'http:'].includes(url.protocol)) return null;
    if (url.hostname === 'play.google.com' && url.pathname === '/store/apps/details') {
      return { platform: 'Play Store', identity: `play:${app}:${review}` };
    }
    if (url.hostname === 'itunes.apple.com' && url.pathname.endsWith('/review')) {
      return { platform: 'App Store', identity: `apple:${app}:${review}` };
    }
  } catch {
    // Unknown citations cannot be classified as review evidence.
  }
  return null;
}

export function reviewSample(signal) {
  const urls = signal?.evidenceUrls;
  if (!Array.isArray(urls) || urls.length === 0) return null;
  const reviews = urls.map(reviewIdentity);
  if (reviews.some((review) => !review)) return null;
  const count = new Set(reviews.map((review) => review.identity)).size;
  const platforms = [...new Set(reviews.map((review) => review.platform))].sort();
  return {
    count,
    platforms,
    headline: `${signal.primaryEntityId ?? 'App'}: recorded app review sample`,
    summary: `${count} distinct review record${count === 1 ? '' : 's'} cited from ${platforms.join(' and ')}. These selected reviews describe individual experiences; they do not measure adoption or a change in satisfaction.`,
    limitation:
      'No verified comparison period, sampling denominator or adoption measurement accompanies these review citations. A surge, spike or population trend is not established. Platforms are collection sources, not independent confirmation of that hypothesis.',
  };
}
