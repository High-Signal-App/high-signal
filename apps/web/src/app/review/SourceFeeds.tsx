'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  addFeedSourceResponseSchema,
  feedSourceErrorSchema,
  feedSourceResponseSchema,
  feedSourcesResponseSchema,
  type FeedSource,
} from '@high-signal/shared';

type FeedRequest = (url: string, init?: RequestInit) => Promise<Response>;
const SOURCE_PATH = '/api/admin/feed-sources';
const BUTTON =
  'min-h-11 border border-zinc-700 px-3 py-2 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]';

async function requestJson(
  request: FeedRequest,
  url: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await request(url, { ...init, credentials: 'include' });
  if (response.status === 401 || response.status === 403)
    throw new Error('Operator access is required to manage sources.');
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = feedSourceErrorSchema.safeParse(body);
    throw new Error(
      error.success
        ? (error.data.message ?? 'Could not update publication sources.')
        : 'Could not update publication sources.'
    );
  }
  return body;
}

function collectionStatus(source: FeedSource): string {
  if (!source.enabled) return 'Paused for future refreshes';
  if (source.lastFetchError) return source.lastFetchError;
  if (source.lastFetchedAt === null) return 'Waiting for the first daily fetch';
  const when = new Date(source.lastFetchedAt * 1000).toLocaleString();
  return `${source.lastFetchCount ?? 0} recent records fetched · ${when}`;
}

/** Additional publication-wide feeds; the existing Access-protected proxy owns auth. */
function useSourceFeeds(request: FeedRequest) {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = feedSourcesResponseSchema.parse(await requestJson(request, SOURCE_PATH));
      setSources(body.sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load publication sources.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    setMessage(null);
    try {
      const body = addFeedSourceResponseSchema.parse(
        await requestJson(request, SOURCE_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
      );
      setSources((previous) => [
        body.source,
        ...previous.filter((source) => source.id !== body.source.id),
      ]);
      setMessage(
        body.created
          ? `${body.source.title} added. ${body.articleCount} feed entries found; collection starts with the next daily news refresh.`
          : `${body.source.title} is already added${body.source.enabled ? '.' : ' and is paused. Resume it below to collect it again.'}`
      );
      setUrl('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this source.');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(source: FeedSource) {
    setBusy(source.id);
    setError(null);
    setMessage(null);
    try {
      const body = feedSourceResponseSchema.parse(
        await requestJson(request, `${SOURCE_PATH}/${source.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !source.enabled }),
        })
      );
      setSources((previous) =>
        previous.map((item) => (item.id === body.source.id ? body.source : item))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this source.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = loading || adding || busy !== null;
  return {
    sources,
    url,
    setUrl,
    loading,
    adding,
    error,
    message,
    disabled,
    refresh,
    addSource,
    toggle,
  };
}

export default function SourceFeeds({ request = fetch }: { request?: FeedRequest }) {
  const {
    sources,
    url,
    setUrl,
    loading,
    adding,
    error,
    message,
    disabled,
    refresh,
    addSource,
    toggle,
  } = useSourceFeeds(request);
  return (
    <section
      aria-labelledby="publication-sources-title"
      className="mt-8 border-b border-zinc-800 pb-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="publication-sources-title" className="text-xl font-medium tracking-tight">
          publication sources
        </h2>
        <button type="button" onClick={() => void refresh()} disabled={disabled} className={BUTTON}>
          refresh sources
        </button>
      </div>
      <p
        id="publication-source-help"
        className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400"
      >
        Add a public feed or publication URL to High Signal’s existing sources. RSS, Atom and public
        Substack feeds are checked here and collected during the daily news refresh.
      </p>
      <SourceFeedForm
        url={url}
        setUrl={setUrl}
        adding={adding}
        disabled={disabled}
        onSubmit={addSource}
      />
      {error && (
        <p role="alert" className="mt-3 break-words text-sm text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm leading-relaxed text-zinc-300">
          {message}
        </p>
      )}
      {loading && sources.length === 0 && (
        <p role="status" className="mt-5 text-sm text-zinc-500">
          Loading added feeds…
        </p>
      )}
      {!loading && !error && sources.length === 0 && (
        <p className="mt-5 text-sm text-zinc-500">No additional feeds yet.</p>
      )}
      <ul className="mt-5 divide-y divide-zinc-800">
        {sources.map((source) => (
          <SourceFeedRow key={source.id} source={source} disabled={disabled} onToggle={toggle} />
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Collected records enter the Brief’s existing reporting and evidence checks.
      </p>
    </section>
  );
}

function SourceFeedForm({
  url,
  setUrl,
  adding,
  disabled,
  onSubmit,
}: {
  url: string;
  setUrl: (value: string) => void;
  adding: boolean;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form onSubmit={onSubmit} aria-busy={adding} className="mt-5">
      <label
        htmlFor="publication-feed-url"
        className="font-mono text-[11px] tracking-[0.08em] text-zinc-400"
      >
        website or feed URL
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="publication-feed-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="publication-source-help"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://writer.substack.com"
          disabled={adding}
          className="min-h-11 min-w-0 flex-1 border border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        />
        <button type="submit" disabled={disabled || !url.trim()} className={BUTTON}>
          {adding ? 'checking feed…' : 'add source'}
        </button>
      </div>
    </form>
  );
}

function SourceFeedRow({
  source,
  disabled,
  onToggle,
}: {
  source: FeedSource;
  disabled: boolean;
  onToggle: (source: FeedSource) => Promise<void>;
}) {
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <h3 className="font-medium text-zinc-200">{source.title}</h3>
        <a
          href={source.feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all font-mono text-[11px] text-zinc-500 underline-offset-4 hover:underline"
        >
          {source.feedUrl}
        </a>
        <p
          className={`mt-2 break-words text-xs leading-relaxed ${source.lastFetchError && source.enabled ? 'text-amber-400' : 'text-zinc-400'}`}
        >
          {collectionStatus(source)}
        </p>
        {source.lastFetchedAt !== null && (
          <a
            href={`/data/news?source=${encodeURIComponent(source.sourceKey)}&all=1`}
            className="mt-1 inline-flex min-h-11 items-center font-mono text-[11px] text-zinc-400 underline-offset-4 hover:underline"
          >
            inspect collected records ↗
          </a>
        )}
      </div>
      <button
        type="button"
        aria-label={`${source.enabled ? 'Pause' : 'Resume'} ${source.title}`}
        disabled={disabled}
        onClick={() => void onToggle(source)}
        className={`${BUTTON} self-start`}
      >
        {source.enabled ? 'pause' : 'resume'}
      </button>
    </li>
  );
}
