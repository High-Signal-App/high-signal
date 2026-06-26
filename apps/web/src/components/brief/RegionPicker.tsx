'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { DEMO_REGIONS, regionLabel, type Region } from '@high-signal/shared';

export function RegionPicker({ active }: { active: Region }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
      <span className="text-[var(--color-muted)]">region:</span>
      <select
        value={active}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams ?? undefined);
          const next = event.target.value;
          if (!next || next === 'global') {
            params.delete('region');
          } else {
            params.set('region', next);
          }
          const query = params.toString();
          const href = (query ? `${pathname}?${query}` : pathname) as Route;
          router.replace(href);
        }}
        className="border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
      >
        {DEMO_REGIONS.map((region) => (
          <option key={region} value={region}>
            {regionLabel(region).toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
