import {
  PUBLIC_CORPUS_POLICY_REVISION,
  PUBLIC_CORPUS_ROUTE_FAMILIES,
} from './public-corpus-policy.mjs';

export function buildPublicCorpusReceipt(candidates, previous = null, observedAt = new Date()) {
  const eligible = candidates.filter((item) => item.verdict.eligible);
  const eligibleUrls = eligible.map((item) => item.path).sort();
  const previousUrls = new Set(previous?.eligibleUrls ?? []);
  const currentUrls = new Set(eligibleUrls);
  const initialBaseline = !previous || previousUrls.size === 0;

  const families = Object.fromEntries(
    PUBLIC_CORPUS_ROUTE_FAMILIES.map((family) => {
      const rows = candidates.filter((item) => item.family === family);
      const eligibleRows = rows.filter((item) => item.verdict.eligible);
      const reasons = {};
      for (const row of rows) {
        for (const reason of row.verdict.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      return [
        family,
        {
          total: rows.length,
          eligible: eligibleRows.length,
          withheld: rows.length - eligibleRows.length,
          reasons: Object.fromEntries(
            Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b))
          ),
          eligibleSample: eligibleRows.slice(0, 5).map((item) => item.path),
          withheldSample: rows
            .filter((item) => !item.verdict.eligible)
            .slice(0, 5)
            .map((item) => ({ path: item.path, reasons: item.verdict.reasons })),
        },
      ];
    })
  );

  return {
    schema: 'high-signal.public-corpus-receipt.v1',
    observedAt: observedAt.toISOString(),
    policyRevision: PUBLIC_CORPUS_POLICY_REVISION,
    initialBaseline,
    totals: {
      candidates: candidates.length,
      eligible: eligible.length,
      withheld: candidates.length - eligible.length,
    },
    families,
    eligibleUrls,
    addedUrls: initialBaseline ? [] : eligibleUrls.filter((url) => !previousUrls.has(url)),
    removedUrls: initialBaseline
      ? []
      : [...previousUrls].filter((url) => !currentUrls.has(url)).sort(),
  };
}

export function assertPublicCorpusReceipt(
  receipt,
  {
    requiredFamilies = ['company', 'signal', 'entity'],
    maxEligibleDeltaRatio = 0.5,
    previous = null,
  } = {}
) {
  for (const family of requiredFamilies) {
    if ((receipt.families[family]?.eligible ?? 0) === 0) {
      throw new Error(`Public corpus family unexpectedly empty: ${family}`);
    }
  }
  if (previous?.totals?.eligible > 0) {
    const delta = Math.abs(receipt.totals.eligible - previous.totals.eligible);
    const ratio = delta / previous.totals.eligible;
    if (ratio > maxEligibleDeltaRatio) {
      throw new Error(
        `Public corpus eligible count changed by ${(ratio * 100).toFixed(1)}%, above ${(maxEligibleDeltaRatio * 100).toFixed(1)}%`
      );
    }
  }
  return receipt;
}
