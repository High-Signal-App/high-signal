import { pathToFileURL } from 'node:url';

export async function inspectSignalEvidence({ api, token, slug, fetchImpl = fetch }) {
  if (!token?.trim()) throw new Error('Operator token required');
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug ?? '')) throw new Error('Invalid signal slug');
  const response = await fetchImpl(`${api.replace(/\/$/, '')}/admin/signals-review/${slug}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Signal evidence inspection failed (HTTP ${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload.claims) || !Array.isArray(payload.evidence))
    throw new Error('Invalid signal evidence response');
  const links = payload.claims.flatMap((claim) => claim.evidence ?? []);
  const coverage = Array.isArray(payload.evidenceCoverage) ? payload.evidenceCoverage : null;

  return {
    slug,
    claims: payload.claims.length,
    citedSources: payload.evidence.length,
    retainedTextSources: payload.evidence.filter((item) => item.excerpt?.trim()).length,
    linkedDocumentSources: new Set(
      links.filter((link) => link.sourceDocumentId).map((link) => link.evidenceUrl)
    ).size,
    contextOnlySources: payload.evidence.filter((item) => item.sourceType === 'techmeme').length,
    ...(coverage
      ? {
          textGaps: {
            unlinked: coverage.filter((item) => !item.legacyText && !item.linked).length,
            documentMissing: coverage.filter(
              (item) => !item.legacyText && item.linked && !item.documentPresent
            ).length,
            citationMismatch: coverage.filter(
              (item) => !item.legacyText && item.documentPresent && !item.canonicalMatch
            ).length,
            textMissing: coverage.filter(
              (item) => !item.legacyText && item.canonicalMatch && !item.retainedText
            ).length,
            recovered: coverage.filter((item) => !item.legacyText && item.retainedText).length,
          },
        }
      : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await inspectSignalEvidence({
    api: process.env.API_BASE ?? 'https://api.highsignal.app',
    token: process.env.ADMIN_TOKEN,
    slug: process.env.INSPECT_SLUG,
  });
  console.log('[signal-evidence]', JSON.stringify(result));
}
