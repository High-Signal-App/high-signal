import {
  BackLink,
  FeedList,
  PageShell,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lab Substrate' };

export default async function LabPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; source?: string; cluster?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? '').trim();
  const source = (params.source ?? '').trim();
  const byCluster = params.cluster === 'on';

  const feedResult = await Promise.allSettled([
    api.labFeed({ query, source, limit: 30, byCluster }),
  ]);
  const result = feedResult[0].status === 'fulfilled' ? feedResult[0].value : null;
  const items = result?.items ?? [];
  const stats = result?.stats ?? null;

  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="primary-source substrate" title="Lab">
        The shared discovery substrate beneath every sub-product. Local-first Postgres index over
        Hacker News, GitHub trending, engineering blogs, arXiv, and operator forums. Ranked,
        searchable, and feeding the curated signal layers above.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: 'documents',
            value: stats ? stats.documents.toLocaleString() : '—',
            sub: 'ingested primary-source docs',
          },
          {
            label: 'sources',
            value: stats ? stats.sources.toString() : '—',
            sub: 'feeds, repos, blogs, forums',
          },
          {
            label: 'last ingest',
            value: stats?.lastIngestAt ? stats.lastIngestAt.slice(0, 16).replace('T', ' ') : '—',
            sub: 'UTC, refreshed by lab worker',
          },
          {
            label: 'vector index',
            value: stats ? `${stats.embeddings.toLocaleString()}` : '—',
            sub: 'pgvector embeddings',
          },
        ]}
      />

      <form className="mt-8 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-[1fr_200px_auto_auto]">
        <label className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          search
          <input
            className="border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
            defaultValue={query}
            name="q"
            placeholder="hacker news, github trending, semantic..."
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
        <label className="flex items-end gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <input
            type="checkbox"
            name="cluster"
            value="on"
            defaultChecked={byCluster}
            className="size-4 accent-[var(--color-accent)]"
          />
          cluster
        </label>
        <button
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:self-end"
          type="submit"
        >
          search
        </button>
      </form>

      {!result ? <LabPreview /> : null}

      {result ? (
        <FeedList
          eyebrow={`${byCluster ? 'by cluster / ' : ''}${query || source ? `results / ${items.length}` : `latest / ${items.length}`}`}
          empty="No documents in the Lab index match this query."
          items={items.map((item) => ({
            href: item.url,
            kicker: `${item.source} / score ${item.score.toFixed(2)}${
              item.clusterId ? ` / cluster ${item.clusterId.slice(0, 6)}` : ''
            } / ${item.publishedAt?.slice(0, 10) ?? '—'}`,
            title: item.title,
            body: item.summary ?? null,
          }))}
        />
      ) : null}
    </PageShell>
  );
}

/**
 * Renders a canned preview of what /lab looks like when the local
 * substrate is running. Avoids the "Lab not running → empty page →
 * looks broken" reaction. The preview rows are clearly labelled and
 * link to the operator runbook for anyone who wants to spin it up.
 */
function LabPreview() {
  const previewItems = [
    {
      source: 'hn',
      score: 0.86,
      title: 'Show HN: a local-first Postgres + pgvector substrate for discovery',
      summary:
        'Reference example. With Lab running, the top of this feed shows ranked HN items by 4-factor signal score (HN discussion + recency + velocity + GitHub momentum).',
      cluster: 'ab12cd',
      publishedAt: '2026-05-24',
    },
    {
      source: 'hn-linked',
      score: 0.78,
      title: 'Article extraction + one-hop link materialisation (Trafilatura)',
      summary:
        "Each HN submission's linked page becomes a document of its own, with outbound links recorded as `links` rows so subsequent passes can materialise them.",
      cluster: 'ef34gh',
      publishedAt: '2026-05-23',
    },
    {
      source: 'github-trending',
      score: 0.71,
      title: 'github.com/trending scraper → repos table (no API key)',
      summary:
        'Daily / weekly / monthly trending in Python, Rust, TypeScript, Go. Star count feeds the GitHub-momentum factor in the scorer.',
      cluster: 'ij56kl',
      publishedAt: '2026-05-22',
    },
    {
      source: 'one-hop',
      score: 0.64,
      title: 'Story clustering (union-find over shared link targets + embedding cosine)',
      summary:
        'Documents that point at the same upstream get the same cluster_id so the feed can collapse near-duplicates into one row.',
      cluster: 'mn78op',
      publishedAt: '2026-05-21',
    },
  ];
  return (
    <>
      <section className="mt-8 border border-[var(--color-line)] bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <span className="text-[var(--color-accent)]">preview only</span>
          <span>· Lab substrate is local-first; bring it up to see live data</span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
          The rows below are a static preview of what /lab shows when the local Postgres substrate
          is running. The Lab is intentionally local-only — it ranks raw discovery material (Hacker
          News, GitHub trending, one-hop link extraction) so the operator can turn the top of the
          ranking into cited signals in the public brief. See{' '}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href="https://github.com/High-Signal-App/high-signal/tree/main/python/lab"
            rel="noreferrer"
            target="_blank"
          >
            python/lab
          </a>{' '}
          for the runbook.
        </p>
      </section>

      <section className="mt-6 border-t border-[var(--color-line)]">
        {previewItems.map((item) => (
          <article key={item.title} className="border-b border-[var(--color-line)] py-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {item.source} / score {item.score.toFixed(2)} / cluster {item.cluster} /{' '}
              {item.publishedAt} <span className="text-[var(--color-accent)]">(preview)</span>
            </div>
            <h3 className="mt-2 text-lg font-medium tracking-tight text-[var(--color-fg)]">
              {item.title}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
              {item.summary}
            </p>
          </article>
        ))}
      </section>
    </>
  );
}
