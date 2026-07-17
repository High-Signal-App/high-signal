import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
} from '@/components/system/HighSignalUI';
import { MarkdownView } from '@/components/system/MarkdownView';
import { api, type CommunityDigestSnapshot } from '@/lib/api';
import { requireSignedIn } from '@/lib/require-auth';
import { redditSourceLink } from '@high-signal/shared';

export const dynamic = 'force-dynamic';

const periods = ['day', 'week', 'month'] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ subreddit: string; period: string }>;
}) {
  const { subreddit, period } = await params;
  return { title: `r/${subreddit} ${period} archive` };
}

export default async function CommunityArchivePage({
  params,
}: {
  params: Promise<{ subreddit: string; period: string }>;
}) {
  await requireSignedIn();
  const { subreddit, period: rawPeriod } = await params;
  const period = periods.includes(rawPeriod as (typeof periods)[number])
    ? (rawPeriod as 'day' | 'week' | 'month')
    : 'week';
  let digests: CommunityDigestSnapshot[] = [];
  try {
    const result = await api.productCommunityDigests(subreddit, period);
    digests = result.digests;
  } catch {
    /* Empty archive until snapshots are seeded. */
  }

  const latest = digests[0];
  const keyItems = latest
    ? [
        latest.summary?.keyTrend,
        ...(latest.summary?.notableDiscussions ?? []),
        latest.summary?.keyAction,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return (
    <PageShell>
      <BackLink href="/communities">back to communities</BackLink>
      <SectionHeader eyebrow="community archive" title={`r/${subreddit}`}>
        Archived source-linked digests for the {period} view.
      </SectionHeader>

      <MetricGrid
        items={[
          { label: 'period', value: period },
          { label: 'digests', value: digests.length.toString() },
          { label: 'sources', value: String(latest?.sourceCount ?? 0) },
          { label: 'latest', value: latest?.snapshotDate.slice(0, 10) ?? 'none' },
        ]}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-[1.1fr_0.9fr]">
        <Panel eyebrow="latest summary" title={latest?.summary?.keyTrend?.title ?? 'No digest yet'}>
          <div className="mt-3">
            <MarkdownView
              markdown={
                latest?.summaryText ??
                'No source-linked digest has been generated for this community period.'
              }
            />
          </div>
        </Panel>

        <Panel eyebrow="archive periods">
          <div className="mt-5 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {periods.map((option) => (
              <a
                key={option}
                href={`/communities/${encodeURIComponent(subreddit)}/${option}`}
                className={`border px-3 py-2 ${
                  option === period
                    ? 'border-[var(--color-accent)] text-[var(--color-fg)]'
                    : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-accent)]'
                }`}
              >
                {option}
              </a>
            ))}
          </div>
        </Panel>
      </section>

      {keyItems.length > 0 ? (
        <section className="mt-10 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-3">
          {keyItems.map((item) => {
            const href = redditSourceLink(subreddit, item.sourceId) ?? item.link ?? '#';
            return (
              <article key={`${item.title}-${href}`} className="bg-[var(--color-bg)] p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  source
                </div>
                <a
                  className="mt-5 block text-lg font-medium tracking-tight hover:text-[var(--color-accent)]"
                  href={href}
                >
                  {item.title}
                </a>
                <div className="mt-3">
                  <MarkdownView markdown={item.desc} />
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <FeedList
        eyebrow="digest history"
        empty="No archived digests found."
        items={digests.map((digest) => ({
          href: `/communities/${encodeURIComponent(subreddit)}/${period}`,
          kicker: `${digest.period} / ${digest.snapshotDate.slice(0, 10)} / ${digest.sourceCount} sources`,
          title: digest.summary?.keyTrend?.title ?? digest.summaryText,
          body: digest.summaryText,
        }))}
      />
    </PageShell>
  );
}
