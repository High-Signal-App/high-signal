import { canonicalSourceUrl } from '@high-signal/shared';
import type { EventInput } from '../routes/admin';

/** A replay may correct only the legacy report-index association, not observations. */
export function cftcReceiptRepairUrls(event: EventInput): string[] | null {
  const doc = event.sourceDocument;
  if (
    event.source !== 'us-gov-api:cftc-cot' ||
    !event.title ||
    !event.content ||
    !doc ||
    doc.rawText !== event.content ||
    doc.rawHash !== event.rawHash
  )
    return null;
  const fields = doc.parsedFields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const metadata = fields as Record<string, unknown>;
  if (
    metadata['documentKind'] !== 'cftc_contract_report' ||
    typeof metadata['contract'] !== 'string' ||
    typeof metadata['reportDate'] !== 'string'
  )
    return null;
  try {
    const url = new URL(event.sourceUrl);
    const contract = metadata['contract'];
    const reportDate = metadata['reportDate'];
    const canonical = canonicalSourceUrl(event.sourceUrl);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'publicreporting.cftc.gov' ||
      url.pathname !== '/resource/jun7-fc8e.json' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      [...url.searchParams.keys()].length !== 2 ||
      url.searchParams.get('market_and_exchange_names') !== contract ||
      url.searchParams.get('report_date_as_yyyy_mm_dd') !== reportDate ||
      event.title !== `CFTC CoT: ${contract} (${reportDate})` ||
      !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?)?$/.test(reportDate) ||
      Date.parse(`${reportDate.slice(0, 10)}T00:00:00Z`) !== Date.parse(event.publishedAt) ||
      canonicalSourceUrl(doc.canonicalUrl ?? '') !== canonical ||
      (doc.documentKey != null && doc.documentKey !== `${event.source}:${canonical}`.toLowerCase())
    )
      return null;
    return [
      'http://www.cftc.gov',
      'https://www.cftc.gov',
      'http://cftc.gov',
      'https://cftc.gov',
    ].map((origin) => `${origin}/MarketReports/CommitmentsofTraders/index.htm`);
  } catch {
    return null;
  }
}

export function isSameCftcObservation(
  event: EventInput,
  existing: { source: string; title: string | null; content: string | null; publishedAt: Date }
): boolean {
  return (
    existing.source === event.source &&
    existing.title === event.title &&
    existing.content === event.content &&
    existing.publishedAt.getTime() === Date.parse(event.publishedAt)
  );
}
