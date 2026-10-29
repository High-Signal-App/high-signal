'use client';

import { useEffect, useState } from 'react';
import { Panel } from '@/components/system/HighSignalUI';
import {
  fetchCurrentStockData,
  type StockDataset,
} from '../../../../../packages/shared/src/stock-data/public';
import { StockDataView } from './StockDataView';

export function StockDataClient({ company }: { company: string }) {
  const [dataset, setDataset] = useState<StockDataset | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentStockData(() =>
      fetch(`/api/stock-data?entity=${encodeURIComponent(company)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
    ).then((value) => {
      if (!controller.signal.aborted) {
        setDataset(value);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [company]);
  if (loading)
    return (
      <Panel eyebrow="ownership & valuation" title="Company valuation inputs">
        <p className="mt-4 text-sm text-[var(--color-muted)]">Loading validated company facts…</p>
      </Panel>
    );
  return <StockDataView dataset={dataset} company={company} />;
}
