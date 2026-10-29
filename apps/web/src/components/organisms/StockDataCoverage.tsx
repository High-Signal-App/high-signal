import { Badge } from '@saas-maker/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-maker/ui/components/table';
import { StockPanel } from './StockDataUI';

const datasets = [
  [
    'Securities & listings',
    'NSE retained',
    'Symbols, names, ISINs, exchange instrument IDs, series, lot sizes and listing flags. Inactive and test records remain identified.',
  ],
  [
    'Daily market data',
    'NSE retained',
    'Open, high, low, close, previous close, volume, turnover and trade counts. A security without an observation has no invented price.',
  ],
  [
    'Financial statements',
    'Partial coverage',
    'Structured SEC companyfacts and reviewed report extraction. NSE-wide balance sheets, cash, debt and obligations are not normalized yet.',
  ],
  [
    'Ownership & businesses',
    'Separate filings',
    'Shareholding disclosures, subsidiaries, associates and segment reports are required. The daily market dump does not establish ownership or operating-business values.',
  ],
  [
    'Corporate actions & FX',
    'Partial coverage',
    'Retained provider actions and ECB reference FX. NSE action-adjusted return history and historical share bases remain unqualified.',
  ],
  [
    'NAV, SOTP & discounts',
    'Inputs incomplete',
    'The calculation engine withholds unsupported models and rankings. A large discount is a research candidate, not a buy recommendation.',
  ],
];

export function StockDataCoverage() {
  return (
    <StockPanel eyebrow="data coverage" title="What can the shared layer pull?">
      <Table aria-label="Stock data coverage">
        <TableHeader>
          <TableRow>
            <TableHead>Dataset</TableHead>
            <TableHead>Coverage</TableHead>
            <TableHead>Available fields and limits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {datasets.map(([name, status, detail]) => (
            <TableRow key={name}>
              <TableCell className="align-top font-medium">{name}</TableCell>
              <TableCell className="align-top">
                <Badge variant="outline">{status}</Badge>
              </TableCell>
              <TableCell className="min-w-64 whitespace-normal text-sm leading-6 text-muted-foreground">
                {detail}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Collection coverage, price availability and valuation completeness are separate. Public
        display and export require their own source permissions.
      </p>
    </StockPanel>
  );
}
