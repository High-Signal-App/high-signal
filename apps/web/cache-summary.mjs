// Aggregated cache outcomes only: no URLs, headers, identities or query values.
// Cache API hits are independent of Cloudflare's account-level CDN hit ratio.
export function createCacheSummary(now = Date.now, emit = console.info) {
  let startedAt = now();
  let counts = { hits: 0, misses: 0, bypasses: 0, eligible: 0 };
  return (response, eligible) => {
    const status = response?.headers.get('x-edge-cache') ?? '';
    if (/(^|-)HIT$/.test(status)) counts.hits += 1;
    else if (/(^|-)MISS$/.test(status)) counts.misses += 1;
    else counts.bypasses += 1;
    if (eligible || /^(AGENT|RSC)-(HIT|MISS)$/.test(status)) counts.eligible += 1;
    const endedAt = now();
    if (endedAt - startedAt < 60_000) return;
    emit(
      JSON.stringify({
        event: 'web.cache.summary',
        started_at: startedAt,
        ended_at: endedAt,
        ...counts,
        eligible_hit_percent: counts.eligible ? (100 * counts.hits) / counts.eligible : null,
        overall_hit_percent: (100 * counts.hits) / (counts.hits + counts.misses + counts.bypasses),
        target_percent: 95,
      })
    );
    startedAt = endedAt;
    counts = { hits: 0, misses: 0, bypasses: 0, eligible: 0 };
  };
}
