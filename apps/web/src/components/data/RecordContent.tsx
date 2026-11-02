import type { ElementType } from 'react';
import type { DataRecordResponse } from '@/lib/api';
import { recordDateTime, retainedTextExplanation } from '@/lib/retained-record';

type RecordProps = {
  record: DataRecordResponse;
  template?: boolean;
  LinkComponent?: ElementType;
};

function RecordHeader({ record, template = false, LinkComponent = 'a' }: RecordProps) {
  return (
    <header data-record-state="available" className="mt-4 mb-8 border-b border-zinc-800 pb-5">
      <h1
        data-record-text="title"
        className="text-xl font-medium leading-8 tracking-[-0.01em] text-zinc-100"
      >
        {record.title ?? record.url}
      </h1>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs tabular-nums text-zinc-400">
        <span>
          source:{' '}
          <LinkComponent
            data-record-link="family"
            data-record-text="family"
            href={`/data/${encodeURIComponent(record.family)}`}
            className="text-zinc-100 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
          >
            {record.family}
          </LinkComponent>
          {(template || record.source !== record.family) && (
            <span data-record-text="source" className="text-zinc-500">
              {' '}
              ({record.source})
            </span>
          )}
        </span>
        <span data-record-text="published">published {recordDateTime(record.publishedAt)}</span>
        <span data-record-text="ingested">ingested {recordDateTime(record.ingestedAt)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500">
        {(template || record.entity) && (
          <LinkComponent
            data-record-link="entity"
            data-record-text="entity"
            href={`/entities/${encodeURIComponent(record.entity ?? '')}`}
            className="rounded border border-zinc-800 px-1.5 py-0.5 hover:text-[var(--color-accent)]"
          >
            {record.entityName ?? record.entity}
          </LinkComponent>
        )}
        <a
          data-record-link="original"
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

function RecordText({ record, template = false }: RecordProps) {
  return (
    <>
      {(template || (record.content && record.content !== record.retainedText)) && (
        <section data-record-state="available" data-record-group="extract" className="mb-8">
          <h2 className="font-mono text-[10px] font-normal tracking-[0.14em] text-zinc-500">
            extract
          </h2>
          <p
            data-record-text="extract"
            className="mt-3 max-w-[70ch] whitespace-pre-wrap text-sm leading-6 text-zinc-400"
          >
            {record.content}
          </p>
        </section>
      )}

      <section data-record-state="available">
        <h2
          data-record-text="retained-heading"
          className="font-mono text-[10px] font-normal tracking-[0.14em] text-zinc-500"
        >
          retained text
          {record.retainedTextTruncated ? ' (truncated)' : ''}
        </h2>
        {(template || record.retainedText) && (
          <pre
            data-record-text="retained"
            className="mt-3 max-w-[70ch] whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-400"
          >
            {record.retainedText}
          </pre>
        )}
        {(template || !record.retainedText) && (
          <p data-record-text="unretained" className="mt-3 text-sm text-zinc-500">
            {retainedTextExplanation(record.retainedTextUnavailableReason)}
          </p>
        )}
        {template || record.documentFetchedAt ? (
          <p data-record-text="fetched" className="mt-2 font-mono text-[10px] text-zinc-600">
            document fetched {recordDateTime(record.documentFetchedAt)}
            {record.canonicalUrl && record.canonicalUrl !== record.url
              ? ` · canonical ${record.canonicalUrl}`
              : ''}
          </p>
        ) : null}
      </section>
    </>
  );
}

export function RecordContent({
  record,
  missing = false,
  template = false,
  LinkComponent = 'a',
}: Omit<RecordProps, 'record'> & { record: DataRecordResponse | null; missing?: boolean }) {
  return (
    <main data-record-reader="v1" className="mx-auto max-w-4xl px-6 py-12">
      <LinkComponent
        href="/data"
        className="font-mono text-[11px] text-zinc-500 underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
      >
        ← sources
      </LinkComponent>
      {record && (
        <>
          <RecordHeader record={record} template={template} LinkComponent={LinkComponent} />
          <RecordText record={record} template={template} />
        </>
      )}
      {(template || (!record && missing)) && (
        <p data-record-state="missing" className="mt-8 text-sm text-zinc-500">
          No retained record exists with this id. Records are append-only but predate the retention
          window in some families; check the source browser for the family instead.
        </p>
      )}
      {(template || (!record && !missing)) && (
        <p data-record-state="unavailable" className="mt-8 font-mono text-[11px] text-amber-400/80">
          Record store not reachable — try again once the API is up.
        </p>
      )}
    </main>
  );
}
