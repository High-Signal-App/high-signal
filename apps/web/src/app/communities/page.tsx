import {
  BackLink,
  CommandButton,
  FeedList,
  Field,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { api, type CommunityDigestSnapshot, type TrackedCommunity } from '@/lib/api';
import { redditSourceLink } from '@high-signal/shared';
import { getRequestAuth, requireSignedIn } from '@/lib/require-auth';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Community Intelligence — High Signal' };

async function trackSubreddit(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const subreddit = `${formData.get('newSubreddit') ?? ''}`.replace(/^r\//i, '').trim();
  const prompt = `${formData.get('newPrompt') ?? ''}`.trim() || null;
  const period = `${formData.get('newPeriod') ?? 'week'}`;
  const isPublic = formData.get('newPublic') === 'on';
  if (!subreddit) return;
  await api.createTrackedCommunity(ownerId, {
    subreddit,
    prompt,
    period: period === 'day' || period === 'month' ? period : 'week',
    isPublic,
  });
  revalidatePath('/communities');
}

async function generateDigest(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const id = `${formData.get('trackedId') ?? ''}`.trim();
  if (!id) return;
  await api.generateCommunityDigest(ownerId, id);
  revalidatePath('/communities');
}

async function removeTracked(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const id = `${formData.get('trackedId') ?? ''}`.trim();
  if (!id) return;
  await api.deleteTrackedCommunity(ownerId, id);
  revalidatePath('/communities');
}

function digestForTracked(
  tracked: TrackedCommunity,
  digests: CommunityDigestSnapshot[]
): CommunityDigestSnapshot | undefined {
  return digests.find((d) => d.subreddit === tracked.subreddit && d.period === tracked.period);
}

export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams?: Promise<{ subreddit?: string; q?: string }>;
}) {
  // Page is public — anonymous visitors see the discover feed and ad-hoc
  // lookup. Personal tracked-community CRUD still requires sign-in (the
  // server actions above call `requireSignedIn`).
  const auth = await getRequestAuth();
  const userId = (auth && 'userId' in auth && auth.userId) || null;
  const ownerId = (auth && 'orgId' in auth && auth.orgId) || userId || 'anonymous';
  const isSignedIn = Boolean(userId);
  const params = (await searchParams) ?? {};
  const subreddit = (params.subreddit ?? 'LocalLLaMA').replace(/^r\//i, '').trim();
  const query = (params.q ?? 'AI agents').trim();

  const [dashboardResult, discoverResult, communityResult, mentionsResult] =
    await Promise.allSettled([
      // Skip the per-owner dashboard fetch entirely when anonymous —
      // there's nothing to render for them.
      isSignedIn
        ? api.productDashboard(ownerId)
        : Promise.resolve(null as unknown as Awaited<ReturnType<typeof api.productDashboard>>),
      api.productCommunityDiscover('week'),
      api.redditCommunity(subreddit),
      api.redditMentions(query, 8),
    ]);

  const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
  const discover = discoverResult.status === 'fulfilled' ? discoverResult.value.items : [];
  const community = communityResult.status === 'fulfilled' ? communityResult.value.community : null;
  const mentions = mentionsResult.status === 'fulfilled' ? mentionsResult.value.mentions : [];

  const tracked = dashboard?.communities.tracked ?? [];
  const latestDigests = dashboard?.communities.latestDigests ?? [];

  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="community signal layer" title="Community Intelligence">
        Tracked subreddits with periodic source-linked digests. Pain, demand, and narrative shifts —
        captured weekly, exportable to the planning brief.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: 'tracked',
            value: tracked.length.toString(),
            sub: 'subreddits in your watchlist',
          },
          {
            label: 'digests',
            value: latestDigests.length.toString(),
            sub: 'recent source-linked snapshots',
          },
          {
            label: 'discover',
            value: discover.length.toString(),
            sub: 'public digests across users',
          },
        ]}
      />

      {tracked.length === 0 ? (
        <Panel eyebrow="get started" title="Track your first subreddit">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Pick a subreddit relevant to a product, audience, or buyer signal. Digests roll up the
            top posts and comments into key trend / notable discussions / key action, with links
            back to source threads.
          </p>
        </Panel>
      ) : null}

      <section className="mt-10 grid gap-8 md:grid-cols-[0.9fr_1.1fr]">
        <Panel eyebrow="add tracked subreddit">
          <form action={trackSubreddit}>
            <Field label="Subreddit" name="newSubreddit" defaultValue="LocalLLaMA" />
            <Field label="Digest prompt (optional)" name="newPrompt" defaultValue="" multiline />
            <label className="mt-5 block text-sm text-[var(--color-muted)]">
              Period
              <select
                name="newPeriod"
                defaultValue="week"
                className="mt-2 block w-full border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
            </label>
            <label className="mt-5 flex items-center gap-3 text-sm text-[var(--color-muted)]">
              <input
                type="checkbox"
                name="newPublic"
                className="size-4 border border-[var(--color-line)] bg-transparent accent-[var(--color-accent)]"
              />
              publish digests to public discover feed
            </label>
            <CommandButton>track</CommandButton>
          </form>
        </Panel>

        <Panel eyebrow="ad-hoc lookup">
          <form>
            <Field label="Subreddit" name="subreddit" defaultValue={subreddit} />
            <Field label="Mention query" name="q" defaultValue={query} />
            <CommandButton>preview</CommandButton>
          </form>
          {community ? (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <a
                className="block text-lg font-medium hover:text-[var(--color-accent)]"
                href={community.url}
              >
                r/{community.name}
              </a>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                {community.description || community.title}
              </p>
              <MetricGrid
                items={[
                  { label: 'subs', value: community.subscribers.toLocaleString() },
                  { label: 'active', value: community.activeUsers?.toLocaleString() ?? '—' },
                  { label: 'nsfw', value: community.nsfw ? 'yes' : 'no' },
                ]}
              />
            </div>
          ) : null}
        </Panel>
      </section>

      {tracked.length > 0 ? (
        <section className="mt-10 border-y border-[var(--color-line)]">
          <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            your tracked communities
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {tracked.map((row) => {
              const digest = digestForTracked(row, latestDigests);
              const keyTrend = digest?.summary?.keyTrend;
              const link = keyTrend
                ? (redditSourceLink(row.subreddit, keyTrend.sourceId) ?? keyTrend.link ?? null)
                : null;
              return (
                <article key={row.id} className="grid gap-4 py-5 md:grid-cols-[1.2fr_0.8fr]">
                  <div>
                    <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      <a
                        className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                        href={`/communities/${encodeURIComponent(row.subreddit)}/${row.period}`}
                      >
                        r/{row.subreddit}
                      </a>
                      <span>{row.period}</span>
                      {row.isPublic ? (
                        <span className="text-[var(--color-accent)]">public</span>
                      ) : null}
                    </div>
                    {keyTrend ? (
                      <>
                        <a
                          className="mt-3 block text-lg font-medium tracking-tight hover:text-[var(--color-accent)]"
                          href={
                            link ??
                            `/communities/${encodeURIComponent(row.subreddit)}/${row.period}`
                          }
                        >
                          {keyTrend.title}
                        </a>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                          {keyTrend.desc}
                        </p>
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                          snapshot {digest!.snapshotDate.slice(0, 10)} / {digest!.sourceCount}{' '}
                          sources
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--color-muted)]">
                        No digest yet. Generate one to see the latest source-linked summary.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch justify-start gap-2">
                    <form action={generateDigest}>
                      <input type="hidden" name="trackedId" value={row.id} />
                      <button
                        className="w-full border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        type="submit"
                      >
                        generate digest
                      </button>
                    </form>
                    <form action={removeTracked}>
                      <input type="hidden" name="trackedId" value={row.id} />
                      <button
                        className="w-full border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-rose-400 hover:text-rose-400"
                        type="submit"
                      >
                        untrack
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <FeedList
        eyebrow="public discover (week)"
        empty="No public digests across users yet."
        items={discover.slice(0, 12).map((digest) => ({
          href: `/communities/${encodeURIComponent(digest.subreddit)}/${digest.period}`,
          kicker: `r/${digest.subreddit} / ${digest.period} / ${digest.snapshotDate.slice(0, 10)}`,
          title: digest.summary?.keyTrend?.title ?? digest.summaryText.slice(0, 100),
          body: digest.summary?.keyTrend?.desc ?? digest.summaryText,
        }))}
      />

      <FeedList
        eyebrow="ad-hoc reddit mentions"
        empty="No Reddit mentions returned for this query."
        items={mentions.map((mention) => ({
          href: mention.permalink,
          kicker: `r/${mention.subreddit} / ${mention.type} / score ${mention.score}`,
          title: mention.title || mention.body || 'Untitled mention',
          body: mention.selftext,
        }))}
      />
    </PageShell>
  );
}
