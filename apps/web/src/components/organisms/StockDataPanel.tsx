import { fetchCurrentStockData } from '../../../../../packages/shared/src/stock-data/public';
import { fetchApiResponse } from '@/lib/api';
import { StockDataView } from './StockDataView';

export async function StockDataPanel(props: {
  company?: string;
  coverage?: string;
  freshness?: string;
}) {
  const dataset = await fetchCurrentStockData(() =>
    fetchApiResponse(
      `/v1/stock-data${props.company ? `?entity=${encodeURIComponent(props.company)}` : ''}`,
      { cache: 'no-store' }
    )
  );
  return <StockDataView dataset={dataset} {...props} />;
}
