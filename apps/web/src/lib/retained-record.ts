import type { DataRecordResponse } from './api';

export function recordDateTime(unixSec: number | null): string {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

export function retainedTextExplanation(reason?: string): string {
  return reason === 'legacy_shared_document_mismatch'
    ? 'The historical document was shared with another weather alert and cannot be attributed to this record. The original extract is preserved above; the exact alert link was not retained.'
    : 'No document body was retained for this record — only its metadata was stored.';
}

export function recordMetadata(record: DataRecordResponse | null, id: string) {
  return {
    title: record?.title ? `${record.title} — retained record` : `Retained record ${id}`,
    description: record
      ? `Retained ${record.family} record from ${record.source}.`
      : 'Retained High Signal record.',
  };
}
