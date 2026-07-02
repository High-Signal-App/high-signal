import Link from 'next/link';
import type { Route } from 'next';
import { ProductPicker } from '@/components/brief/ProductPicker';
import { RegionPicker } from '@/components/brief/RegionPicker';
import { regionLabel, type Region } from '@high-signal/shared';

const productLoop = [
  {
    label: 'Data',
    href: '/data',
  },
  {
    label: 'Signals',
    href: '/signals',
  },
  {
    label: 'History',
    href: '/daily/history',
  },
  {
    label: 'Evals',
    href: '/agent-eval',
  },
];

export function DailyBriefHero({
  region,
  activeProductId,
  generatedAt,
  selectedProductName,
  spotlightName,
}: {
  region: Region;
  activeProductId: string;
  generatedAt: string;
  selectedProductName?: string | null;
  spotlightName?: string | null;
}) {
  const generated = generatedAt.slice(0, 16).replace('T', ' ');
  const productContext = selectedProductName ?? spotlightName ?? 'rotating product spotlight';

  return (
    <section className="border-b border-[var(--color-line)] pb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
        <span className="text-[var(--color-accent)]">daily brief</span>
        <span>{regionLabel(region).toLowerCase()}</span>
        <span>{productContext.toLowerCase()}</span>
        <span className="ml-auto">{generated} UTC</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="text-3xl font-medium leading-tight tracking-tight text-[var(--color-fg)] sm:text-4xl">
            Daily signal brief
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            A source-linked readout across data, signals, history, and evaluations. Cited evidence
            stays attached to every claim.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <RegionPicker active={region} />
          <ProductPicker active={activeProductId} />
        </div>
      </div>

      <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
        {productLoop.map(({ label, href }, index) => (
          <Link key={label} href={href as Route} className="hover:text-[var(--color-accent)]">
            {String(index + 1).padStart(2, '0')} / {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
