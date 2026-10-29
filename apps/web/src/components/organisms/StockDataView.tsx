import { StockPanel as Panel, StockSelect } from './StockDataUI';
import { Button } from '@saas-maker/ui/components/button';
import { Badge } from '@saas-maker/ui/components/badge';
import { EmptyState } from '@saas-maker/ui/components/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@saas-maker/ui/components/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@saas-maker/ui/components/accordion';
import type {
  StockDataset,
  StockValuation,
} from '../../../../../packages/shared/src/stock-data/public';

function ratio(value: string | null) {
  if (value === null) return 'unavailable';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function StockDataView({
  dataset,
  company,
  coverage,
  freshness,
}: {
  dataset: StockDataset | null;
  company?: string;
  coverage?: string;
  freshness?: string;
}) {
  if (!dataset)
    return (
      <Panel eyebrow="ownership & valuation" title="Valuation inputs unavailable">
        <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
          A current, validated dataset is not available yet. Financial facts and valuations remain
          withheld until supported inputs are published.
        </p>
      </Panel>
    );
  const names = new Map(dataset.entities.map((entity) => [entity.id, entity.name]));
  const models = dataset.valuations.filter(
    (value) => !company || value.parent_entity_id === company
  );
  const rows = models.filter(
    (value) =>
      (!coverage || value.coverage === coverage) && (!freshness || value.freshness === freshness)
  );
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
        {company ? <input type="hidden" name="company" value={company} /> : null}
        <StockSelect
          name="coverage"
          label="Coverage"
          value={coverage}
          options={['complete', 'partial', 'unavailable']}
        />
        <StockSelect
          name="freshness"
          label="Freshness"
          value={freshness}
          options={['fresh', 'stale', 'unavailable']}
        />
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>
      {rows.length ? (
        <ValuationTable rows={rows} names={names} />
      ) : (
        <EmptyState
          title={
            coverage || freshness
              ? 'No qualified valuations match these filters'
              : 'No qualified valuations available'
          }
          description="Prices, ownership, accounting scope and usage rights must be supported together. Missing inputs remain unavailable."
        />
      )}
      {dataset.withheld_sources.length ? (
        <p className="mt-4 text-sm text-amber-300">
          Usage rights unresolved: {dataset.withheld_sources.join(', ')}.
        </p>
      ) : null}
      <CompanyEvidence dataset={dataset} company={company} names={names} />
      <p className="mt-5 break-all font-mono text-[10px] leading-5 text-zinc-500">
        Input {dataset.snapshot_id} · as of {dataset.as_of.slice(0, 10)}
      </p>
    </Panel>
  );
}

function ValuationTable({ rows, names }: { rows: StockValuation[]; names: Map<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <Table className="w-full min-w-[660px] text-left text-sm">
        <TableHeader className="border-b border-zinc-800 text-xs text-[var(--color-muted)]">
          <TableRow>
            <TableHead className="py-3">Company / model</TableHead>
            <TableHead>Listed coverage</TableHead>
            <TableHead>NAV discount</TableHead>
            <TableHead>Coverage / freshness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((value: StockValuation) => (
            <TableRow key={value.snapshot_id} className="border-b border-zinc-800">
              <TableCell className="py-3">
                <a
                  className="underline underline-offset-4"
                  href={`/equities?company=${encodeURIComponent(value.parent_entity_id)}`}
                >
                  {names.get(value.parent_entity_id) ?? value.parent_entity_id}
                </a>
                <div className="mt-1 text-xs text-zinc-500">
                  {value.method.replaceAll('_', ' ')}
                </div>
              </TableCell>
              <TableCell>{ratio(value.listed_investment_coverage)}</TableCell>
              <TableCell>
                {value.ranking_eligible ? ratio(value.discount_to_nav) : 'withheld'}
              </TableCell>
              <TableCell>
                {value.coverage} / {value.freshness}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CompanyEvidence({
  dataset,
  company,
  names,
}: {
  dataset: StockDataset;
  company?: string;
  names: Map<string, string>;
}) {
  const selected = company ? dataset.entities.find((entity) => entity.id === company) : null;
  const facts = selected ? dataset.facts.filter((fact) => fact.entity_id === selected.id) : [];
  const evidence = new Map(dataset.evidence.map((source) => [source.id, source]));
  if (!selected) return null;
  return (
    <div className="mt-8 border-t border-zinc-800 pt-6">
      <h2 className="text-xl">{selected.name}</h2>
      <p className="mt-2 font-mono text-xs text-zinc-500">{selected.id}</p>
      <h3 className="mt-5 text-sm font-medium">Ownership and financial evidence</h3>
      {!facts.length ? (
        <p className="mt-3 text-sm text-zinc-400">
          Underlying facts are unavailable for public display.
        </p>
      ) : null}
      <Accordion type="multiple" className="mt-3">
        {facts.map((fact) => {
          const source = evidence.get(fact.evidence_id);
          return (
            <AccordionItem key={fact.id} value={fact.id}>
              <AccordionTrigger>
                {fact.metric.replaceAll('_', ' ')}: {fact.value ?? 'unavailable'} {fact.unit}{' '}
                <Badge variant="outline">{fact.kind}</Badge>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 break-words text-xs leading-5 text-muted-foreground">
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
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
