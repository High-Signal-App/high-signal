'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { SEED_PRODUCTS, type SeedProduct } from '@high-signal/shared';

export function ProductPicker({ active }: { active: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
      <span className="text-[var(--color-muted)]">product:</span>
      <select
        value={active}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams ?? undefined);
          const next = event.target.value;
          if (!next || next === 'spotlight') {
            params.delete('product');
          } else {
            params.set('product', next);
          }
          const query = params.toString();
          const href = (query ? `${pathname}?${query}` : pathname) as Route;
          router.replace(href);
        }}
        className="border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
      >
        <option value="spotlight">spotlight (rotating)</option>
        {(['technology', 'startups', 'finance'] as const).map((domain) => (
          <optgroup key={domain} label={domain}>
            {SEED_PRODUCTS.filter((p: SeedProduct) => p.domain === domain).map((p) => (
              <option key={p.id} value={p.id}>
                {p.brandName.toLowerCase()}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
