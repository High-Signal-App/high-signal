import { Panel } from '@/components/system/HighSignalUI';
import {
  getPublicStockData,
  type StockValuation,
} from '../../../../../packages/shared/src/stock-data/public';
import type { StockDataset } from '../../../../../packages/shared/src/stock-data/public';
import { fetchApiResponse } from '@/lib/api';

function ratio(value: string | null) {
  if (value === null) return 'unavailable';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export async function StockDataPanel({
  company,
  coverage,
  freshness,
}: {
  company?: string;
  coverage?: string;
  freshness?: string;
}) {
  let dataset: StockDataset;
  try {
    const response = await fetchApiResponse(
      `/v1/stock-data${company ? `?entity=${encodeURIComponent(company)}` : ''}`,
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error('Stock data unavailable');
    dataset = (await response.json()) as StockDataset;
  } catch {
    dataset = getPublicStockData();
    dataset.freshness = dataset.facts.length ? 'stale' : 'unavailable';
    dataset.valuations = dataset.valuations.map((value) => ({
      ...value,
      freshness: 'stale',
      ranking_eligible: false,
    }));
  }
  const names = new Map(dataset.entities.map((entity) => [entity.id, entity.name]));
  const models = dataset.valuations.filter(
    (value) => !company || value.parent_entity_id === company
  );
  const rows = models.filter(
    (value) =>
      (!coverage || value.coverage === coverage) && (!freshness || value.freshness === freshness)
  );
  const selected = company ? dataset.entities.find((entity) => entity.id === company) : null;
  const facts = selected ? dataset.facts.filter((fact) => fact.entity_id === selected.id) : [];
  const evidence = new Map(dataset.evidence.map((source) => [source.id, source]));
  return (
    <Panel eyebrow="ownership & valuation" title="What is supported by the filings?">
      <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
        Listed investment coverage compares disclosed listed holdings with the parent’s market
        value. NAV includes other net assets and obligations. SOTP values businesses separately.
        Incomplete models do not receive NAV-discount rankings.
      </p>
      <div className="my-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-[var(--color-muted)]">
        <span>coverage: {dataset.coverage}</span>
        <span>freshness: {dataset.freshness}</span>
        <span>{models.length} supported company models</span>
      </div>
      <form action="/equities" className="mb-5 flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          Coverage
          <select
            name="coverage"
            defaultValue={coverage ?? ''}
            className="border border-zinc-700 bg-zinc-900 p-2"
          >
            <option value="">All coverage</option>
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className="grid gap-1">
          Freshness
          <select
            name="freshness"
            defaultValue={freshness ?? ''}
            className="border border-zinc-700 bg-zinc-900 p-2"
          >
            <option value="">All dates</option>
            <option value="fresh">Fresh</option>
            <option value="stale">Stale</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <button type="submit" className="border border-zinc-700 px-4 py-2 hover:border-zinc-500">
          Apply
        </button>
      </form>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs text-[var(--color-muted)]">
              <tr>
                <th className="py-3">Company / model</th>
                <th>Listed coverage</th>
                <th>NAV discount</th>
                <th>Coverage / freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((value: StockValuation) => (
                <tr key={value.snapshot_id} className="border-b border-zinc-800">
                  <td className="py-3">
                    <a
                      className="underline underline-offset-4"
                      href={`/equities?company=${encodeURIComponent(value.parent_entity_id)}`}
                    >
                      {names.get(value.parent_entity_id) ?? value.parent_entity_id}
                    </a>
                    <div className="mt-1 text-xs text-zinc-500">
                      {value.method.replaceAll('_', ' ')}
                    </div>
                  </td>
                  <td>{ratio(value.listed_investment_coverage)}</td>
                  <td>{value.ranking_eligible ? ratio(value.discount_to_nav) : 'withheld'}</td>
                  <td>
                    {value.coverage} / {value.freshness}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-l-2 border-amber-700 pl-4 text-sm leading-6">
          <p>
            No qualified valuations
            {coverage || freshness ? ' match these filters' : ' are available'}.
          </p>
          <p className="mt-2 text-[var(--color-muted)]">
            Prices, ownership, accounting scope and usage rights must be supported together. Missing
            inputs remain unavailable.
          </p>
        </div>
      )}
      {dataset.withheld_sources.length ? (
        <p className="mt-4 text-sm text-amber-300">
          Usage rights unresolved: {dataset.withheld_sources.join(', ')}.
        </p>
      ) : null}
      {selected ? (
        <div className="mt-8 border-t border-zinc-800 pt-6">
          <h2 className="text-xl">{selected.name}</h2>
          <p className="mt-2 font-mono text-xs text-zinc-500">{selected.id}</p>
          <h3 className="mt-5 text-sm font-medium">Ownership and financial evidence</h3>
          {!facts.length ? (
            <p className="mt-3 text-sm text-zinc-400">
              Underlying facts are unavailable for public display.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {facts.map((fact) => {
              const source = evidence.get(fact.evidence_id);
              return (
                <details key={fact.id} className="border border-zinc-800 p-3 text-sm">
                  <summary className="cursor-pointer">
                    {fact.metric.replaceAll('_', ' ')}: {fact.value ?? 'unavailable'} {fact.unit}{' '}
                    <span className="text-zinc-500">/ {fact.kind}</span>
                  </summary>
                  <div className="mt-3 space-y-2 break-words text-xs leading-5 text-zinc-400">
                    <p>
                      Effective {fact.effective_at.slice(0, 10)} · public{' '}
                      {fact.available_at.slice(0, 10)} · retained {fact.ingested_at.slice(0, 10)}
                    </p>
                    <p>
                      {fact.dimensions['asset_entity_id']
                        ? `Ownership target: ${names.get(fact.dimensions['asset_entity_id']) ?? fact.dimensions['asset_entity_id']}`
                        : `Scope: ${fact.dimensions['accounting_basis'] ?? 'unspecified'}`}
                    </p>
                    <p>{fact.locator}</p>
                    {source ? (
                      <a className="underline" href={source.url}>
                        Original source ({source.source_id})
                      </a>
                    ) : null}
                    <p className="break-all">Fact {fact.id}</p>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}
      <p className="mt-5 break-all font-mono text-[10px] leading-5 text-zinc-500">
        Input {dataset.snapshot_id} · as of {dataset.as_of.slice(0, 10)}
      </p>
    </Panel>
  );
}
