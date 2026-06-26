import {
  BackLink,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { api, type LabFeedResult } from '@/lib/api';
import { requireSignedIn } from '@/lib/require-auth';
import type { Route } from 'next';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lab candidates — High Signal' };

export default async function LabCandidatesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; source?: string }>;
}) {
  await requireSignedIn();
  const params = (await searchParams) ?? {};
  const query = (params.q ?? '').trim();
  const source = (params.source ?? '').trim();

  let result: LabFeedResult | null = null;
  let error: string | null = null;
  try {
    result = await api.labFeed({ query, source, limit: 30 });
  } catch (e) {
    error = e instanceof Error ? e.message : 'lab_unreachable';
  }

  const items = result?.items ?? [];
  const stats = result?.stats ?? null;

  return (
    <PageShell>
      <BackLink href={'/review' as Route}>back to review</BackLink>
      <SectionHeader eyebrow="discovery → curation" title="Lab candidates">
        Top-scored documents from the local Lab substrate, ranked. Click <strong>draft</strong> on
        anything worth shipping as a signal — you'll get a pre-filled markdown template to drop into
        <code className="mx-1 border border-[var(--color-line)] px-1 py-0.5 text-xs">
          signals/YYYY-MM-DD/
        </code>
        , review, then publish.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: 'candidates',
            value: items.length.toString(),
            sub: error ? `lab unreachable: ${error}` : 'ranked by 4-factor signal score',
          },
          {
            label: 'documents indexed',
            value: stats?.documents.toLocaleString() ?? '—',
            sub: 'in the local Lab Postgres',
          },
          {
            label: 'last ingest',
            value: stats?.lastIngestAt?.slice(0, 16).replace('T', ' ') ?? '—',
            sub: 'UTC',
          },
        ]}
      />

      {error ? (
        <Panel eyebrow="lab not reachable" title="LAB_API_URL is not set or the FastAPI is down">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            The candidates view reads from your local Lab substrate via{' '}
            <code className="border border-[var(--color-line)] px-1 py-0.5 text-xs">
              LAB_API_URL
            </code>
            . Bring it up with{' '}
            <code className="border border-[var(--color-line)] px-1 py-0.5 text-xs">
              docker compose -f python/lab/docker-compose.yml up -d
            </code>{' '}
            then{' '}
            <code className="border border-[var(--color-line)] px-1 py-0.5 text-xs">
              uv run python -m high_signal_lab.server
            </code>
            , and export{' '}
            <code className="border border-[var(--color-line)] px-1 py-0.5 text-xs">
              LAB_API_URL=http://localhost:8765
            </code>
            .
          </p>
        </Panel>
      ) : null}

      <form className="mt-8 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-[1fr_200px_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          filter
          <input
            className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            defaultValue={query}
            name="q"
            placeholder="capex, hbm, agent, ..."
          />
        </label>
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          source
          <input
            className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            defaultValue={source}
            name="source"
            placeholder="hn / hn-linked / one-hop"
          />
        </label>
        <button
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
          type="submit"
        >
          search
        </button>
      </form>

      <section className="mt-8 border-t border-[var(--color-line)]">
        {items.map((item) => {
          const draftHref =
            `/review/lab-candidates/draft?id=${encodeURIComponent(item.id)}&url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title)}` as Route;
          return (
            <article
              key={item.id}
              className="grid gap-3 border-b border-[var(--color-line)] py-5 md:grid-cols-[1fr_220px]"
            >
              <div>
                <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  <span>{item.source}</span>
                  <span>· score {item.score.toFixed(2)}</span>
                  {item.clusterId ? <span>· cluster {item.clusterId.slice(0, 6)}</span> : null}
                  {item.publishedAt ? <span>· {item.publishedAt.slice(0, 10)}</span> : null}
                </div>
                <a
                  className="mt-3 block text-lg font-medium tracking-tight hover:text-[var(--color-accent)]"
                  href={item.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {item.title}
                </a>
                {item.summary ? (
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                    {item.summary}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <a
                  className="border border-[var(--color-line)] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  href={draftHref}
                >
                  draft signal
                </a>
                <a
                  className="border border-[var(--color-line)] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  href={item.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  open source
                </a>
              </div>
            </article>
          );
        })}
        {items.length === 0 && !error ? (
          <p className="py-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            no candidates — run lab ingest, then refresh
          </p>
        ) : null}
      </section>
    </PageShell>
  );
}
