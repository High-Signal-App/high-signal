interface FacetSignal {
  signalType: string;
  direction: string;
  confidence: string;
  primaryEntityId: string | null;
  contentCategory: string;
  sourceClasses: readonly string[];
}

interface FacetValue {
  k: string;
  n: number;
}

function increment(counts: Map<string, number>, value: string | null) {
  if (!value) return;
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function ranked(counts: Map<string, number>): FacetValue[] {
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

export function buildSignalFacets(signals: readonly FacetSignal[]) {
  const typeCounts = new Map<string, number>();
  const directionCounts = new Map<string, number>();
  const confidenceCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const sourceClassCounts = new Map<string, number>();

  for (const signal of signals) {
    increment(typeCounts, signal.signalType);
    increment(directionCounts, signal.direction);
    increment(confidenceCounts, signal.confidence);
    increment(entityCounts, signal.primaryEntityId);
    increment(categoryCounts, signal.contentCategory);
    for (const sourceClass of signal.sourceClasses) increment(sourceClassCounts, sourceClass);
  }

  return {
    types: ranked(typeCounts),
    directions: ranked(directionCounts),
    confidences: ranked(confidenceCounts),
    topEntities: ranked(entityCounts).slice(0, 20),
    categories: ranked(categoryCounts),
    sourceClasses: ranked(sourceClassCounts),
  };
}
