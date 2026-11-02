import { withAgentMetadata } from '@/lib/agent-page-metadata';
import type { Metadata } from 'next';
import { RecordContent } from '@/components/data/RecordContent';
import { recordMetadata } from '@/lib/retained-record';
import Link from 'next/link';
import { api, ApiError, type DataRecordResponse } from '@/lib/api';

export const revalidate = 300;

async function pageMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let record: DataRecordResponse | null = null;
  try {
    record = await api.dataRecord(id);
  } catch {
    /* metadata falls back to the generic title */
  }
  return recordMetadata(record, id);
}

export default async function DataRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let record: DataRecordResponse | null = null;
  let missing = false;
  try {
    const response = await api.dataRecord(id);
    if (response.available) record = response;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing = true;
  }

  return <RecordContent record={record} missing={missing} LinkComponent={Link} />;
}

export async function generateMetadata(props: Parameters<typeof pageMetadata>[0]) {
  const metadata = await pageMetadata(props);
  const params = await props.params;
  return withAgentMetadata(metadata, '/data/records/' + encodeURIComponent(params['id']));
}
