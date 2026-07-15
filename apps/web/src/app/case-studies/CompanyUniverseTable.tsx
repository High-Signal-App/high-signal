import type { Route } from 'next';
import Link from 'next/link';
import type { UniverseCompany } from './data';

interface CompanyUniverseTableProps {
  companies: UniverseCompany[];
  peerNamesBySlug?: Record<string, string[]>;
}

export function CompanyUniverseTable({
  companies,
  peerNamesBySlug = {},
}: CompanyUniverseTableProps) {
  return (
    <div className="overflow-x-auto border border-[var(--color-line)]">
      <div className="min-w-[56rem]">
        <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.7fr)_minmax(12rem,1.1fr)_minmax(14rem,1.4fr)] border-b border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          <div>company</div>
          <div>category</div>
          <div>source</div>
          <div>similar companies</div>
        </div>
        <div className="divide-y divide-[var(--color-line)]">
          {companies.map((item) => {
            const peerNames =
              peerNamesBySlug[item.slug] ??
              item.competitors.slice(0, 3).map((peer) => peer.name ?? peer.slug);
            return (
              <Link
                key={item.slug}
                href={`/case-studies/${item.slug}` as Route}
                className="grid grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.7fr)_minmax(12rem,1.1fr)_minmax(14rem,1.4fr)] gap-3 px-3 py-3 text-sm transition hover:bg-zinc-950"
              >
                <div>
                  <div className="font-medium text-zinc-100">{item.name}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-zinc-500">
                    {item.description || 'source-backed company entry'}
                  </div>
                </div>
                <div className="text-zinc-400">{item.category}</div>
                <div className="text-zinc-500">{item.investors.join(', ')}</div>
                <div className="text-zinc-400">{peerNames.join(', ')}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
