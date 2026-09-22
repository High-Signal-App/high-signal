import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { api, ApiError, type DataRecordResponse } from '@/lib/api';

export const revalidate = 300;

function fmtDateTime(unixSec: number | null): string {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let record: DataRecordResponse | null = null;
  try {
    record = await api.dataRecord(id);
  } catch {
    /* metadata falls back to the generic title */
  }
  return {
    title: record?.title ? `${record.title} — retained record` : `Retained record ${id}`,
    description: record
      ? `Retained ${record.family} record from ${record.source}.`
      : 'Retained High Signal record.',
  };
}

function RecordHeader({ record }: { record: DataRecordResponse }) {
  return (
    <header className="mt-4 mb-8 border-b border-zinc-800 pb-5">
      <h1 className="text-xl font-medium leading-8 tracking-[-0.01em] text-zinc-100">
        {record.title ?? record.url}
      </h1>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs tabular-nums text-zinc-400">
        <span>
          source:{' '}
          <Link
            href={`/data/${encodeURIComponent(record.family)}` as Route}
            className="text-zinc-100 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
          >
            {record.family}
          </Link>
          {record.source !== record.family && (
            <span className="text-zinc-500"> ({record.source})</span>
          )}
        </span>
        <span>published {fmtDateTime(record.publishedAt)}</span>
        <span>ingested {fmtDateTime(record.ingestedAt)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500">
        {record.entity && (
          <Link
            href={`/entities/${encodeURIComponent(record.entity)}` as Route}
            className="rounded border border-zinc-800 px-1.5 py-0.5 hover:text-[var(--color-accent)]"
          >
            {record.entityName ?? record.entity}
          </Link>
        )}
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-zinc-800 px-1.5 py-0.5 hover:text-[var(--color-accent)]"
        >
          original source ↗
        </a>
      </div>
    </header>
  );
}

function RecordText({ record }: { record: DataRecordResponse }) {
  return (
    <>
      {record.content && record.content !== record.retainedText && (
        <section className="mb-8">
          <h2 className="font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-zinc-500">
            Extract
          </h2>
          <p className="mt-3 max-w-[70ch] whitespace-pre-wrap text-sm leading-6 text-zinc-400">
            {record.content}
          </p>
        </section>
      )}

      <section>
        <h2 className="font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-zinc-500">
          Retained text
          {record.retainedTextTruncated ? ' (truncated)' : ''}
        </h2>
        {record.retainedText ? (
          <pre className="mt-3 max-w-[70ch] whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-400">
            {record.retainedText}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No document body was retained for this record — only its metadata was stored.
          </p>
        )}
        {record.documentFetchedAt ? (
          <p className="mt-2 font-mono text-[10px] text-zinc-600">
            document fetched {fmtDateTime(record.documentFetchedAt)}
            {record.canonicalUrl && record.canonicalUrl !== record.url
              ? ` · canonical ${record.canonicalUrl}`
              : ''}
          </p>
        ) : null}
      </section>
    </>
  );
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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/data"
        className="font-mono text-[11px] text-zinc-500 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
      >
        ← sources
      </Link>

      {record ? (
        <>
          <RecordHeader record={record} />
          <RecordText record={record} />
        </>
      ) : missing ? (
        <p className="mt-8 text-sm text-zinc-500">
          No retained record exists with this id. Records are append-only but predate the retention
          window in some families; check the source browser for the family instead.
        </p>
      ) : (
        <p className="mt-8 font-mono text-[11px] text-amber-400/80">
          Record store not reachable — try again once the API is up.
        </p>
      )}
    </main>
  );
}
