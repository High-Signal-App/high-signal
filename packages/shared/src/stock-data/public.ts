interface StockFact {
  id: string;
  entity_id: string;
  metric: string;
  value: string | null;
  unit: string;
  effective_at: string;
  available_at: string;
  ingested_at: string;
  evidence_id: string;
  locator: string;
  kind: string;
  dimensions: Record<string, string>;
}

export interface StockValuation {
  snapshot_id: string;
  parent_entity_id: string;
  model_version: string;
  method: string;
  currency: string;
  value: string | null;
  market_cap: string | null;
  listed_investment_coverage: string | null;
  discount_to_nav: string | null;
  ranking_eligible: boolean;
  coverage: string;
  freshness: string;
  issues: string[];
  input_fact_ids: string[];
  input_snapshot_ids: string[];
}

export interface StockDataset {
  publication_id: string;
  contract_version: string;
  snapshot_id: string;
  as_of: string;
  audience: 'display' | 'export';
  coverage: string;
  freshness: string;
  coverage_scope: string;
  facts: StockFact[];
  valuations: StockValuation[];
  changes: {
    id: string;
    entity_id: string;
    metric: string;
    before: StockFact | null;
    after: StockFact | null;
  }[];
  entities: { id: string; name: string; country: string; version_id: string }[];
  securities: { id: string; entity_id: string; ticker: string; currency: string }[];
  evidence: {
    id: string;
    source_id: string;
    url: string;
    sha256: string;
    available_at: string;
    ingested_at: string;
    media_type: string;
  }[];
  missing_metrics: string[];
  withheld_sources: string[];
  stale_fact_ids: string[];
  usage_rights: {
    id: string;
    policy_url: string;
    public_display: string;
    export: string;
    reviewed_at: string | null;
  }[];
  rights_versions: Record<string, string>;
}

export function currentStockData(dataset: StockDataset, now = new Date()): StockDataset {
  const age = now.getTime() - Date.parse(dataset.as_of);
  if (!Number.isFinite(age) || age < 0 || age > 86_400_000) {
    dataset.freshness = dataset.facts.length ? 'stale' : 'unavailable';
    dataset.valuations = dataset.valuations.map((value) => ({
      ...value,
      freshness: 'stale',
      ranking_eligible: false,
      issues: [...value.issues, 'Refresh is more than 24 hours old'],
    }));
  }
  return dataset;
}

export async function fetchCurrentStockData(
  fetchResponse: () => Promise<Response>
): Promise<StockDataset | null> {
  try {
    const response = await fetchResponse();
    if (!response.ok) return null;
    return currentStockData((await response.json()) as StockDataset);
  } catch {
    return null;
  }
}
