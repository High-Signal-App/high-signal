import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
} from '@/components/system/HighSignalUI';
import { api, type ProductDashboardSnapshot, type SignalRow } from '@/lib/api';
import { requireSignedIn } from '@/lib/require-auth';
import {
  buildWatchlistDigest,
  type WatchlistCollection,
  type WatchlistItem,
  type WatchlistPriority,
} from '@high-signal/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unified Watchlist' };

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function priorityTone(priority: WatchlistPriority) {
  if (priority === 'critical') return 'text-red-300';
  if (priority === 'high') return 'text-amber-300';
  if (priority === 'medium') return 'text-[var(--color-accent)]';
  return 'text-[var(--color-muted)]';
}

function signalTitle(signal: SignalRow) {
  const firstLine = signal.bodyMd.split('\n').find((line) => line.trim()) ?? signal.slug;
  return firstLine.replace(/^#\s*/, '').trim() || signal.slug;
}

function marketPriority(signal: SignalRow): WatchlistPriority {
  if (signal.confidence === 'high' && signal.direction !== 'neutral') return 'high';
  if (signal.confidence === 'high') return 'medium';
  if (signal.direction !== 'neutral') return 'medium';
  return 'low';
}

function fallbackCollections(): WatchlistCollection[] {
  return [
    {
      id: 'mentions',
      title: 'Mention Intelligence',
      surface: 'mentions',
      description: 'AI visibility, citation, competitor mention, and share-of-voice follow-ups.',
      items: [
        {
          id: 'mention-high-signal-check',
          surface: 'mentions',
          title: 'Run cross-model mention check for High Signal',
          summary: 'No recent mention check is available, so brand visibility is a blind spot.',
          href: '/mentions',
          priority: 'high',
          status: 'actionable',
          sourceLabel: 'workspace default',
          action:
            'Run OpenAI, Anthropic, Perplexity, and Google prompts before the next launch note.',
          evidenceCount: 3,
          observedAt: isoDaysAgo(2),
        },
      ],
    },
    {
      id: 'communities',
      title: 'Community Intelligence',
      surface: 'communities',
      description: 'Tracked communities and digest follow-ups from source-linked Reddit research.',
      items: [
        {
          id: 'community-localllama',
          surface: 'communities',
          title: 'Refresh r/LocalLLaMA operational pain digest',
          summary: 'The default tracked community needs a current source-linked digest.',
          href: '/communities?subreddit=LocalLLaMA&q=agent%20ops',
          priority: 'medium',
          status: 'watching',
          sourceLabel: 'r/LocalLLaMA',
          action: 'Generate the weekly digest and extract one product opportunity.',
          evidenceCount: 2,
          observedAt: isoDaysAgo(6),
        },
      ],
    },
    {
      id: 'markets',
      title: 'Market Intelligence',
      surface: 'markets',
      description: 'Published signals, sector pressure, and review-ready market movement.',
      items: [
        {
          id: 'market-weekly-digest',
          surface: 'markets',
          title: 'Publish weekly AI-infra market digest',
          summary: 'Market signal cards need a digest pass before distribution.',
          href: '/digest',
          priority: 'medium',
          status: 'actionable',
          sourceLabel: 'weekly market digest',
          action: "Review this week's signals and ship a source-linked digest.",
          evidenceCount: 2,
          observedAt: isoDaysAgo(3),
        },
      ],
    },
  ];
}

function buildCollections(dashboard: ProductDashboardSnapshot | null, signals: SignalRow[]) {
  const fallback = fallbackCollections();
  if (!dashboard && signals.length === 0) return fallback;

  const mentionItems: WatchlistItem[] = [];
  for (const config of dashboard?.mentions.configs ?? []) {
    const latestCheck = dashboard?.mentions.recentChecks.find(
      (check) => check.configId === config.id
    );
    const mentionRate = latestCheck?.brandMentionRate ?? null;
    mentionItems.push({
      id: `mention-${config.id}`,
      surface: 'mentions',
      title: `Track ${config.brandName} AI visibility`,
      summary:
        latestCheck?.summary ??
        `Monitor ${config.platforms.join(', ')} for brand, competitor, and citation visibility.`,
      href: '/mentions',
      priority: mentionRate == null || mentionRate < 0.35 ? 'high' : 'medium',
      status: mentionRate == null || mentionRate < 0.35 ? 'actionable' : 'watching',
      sourceLabel: `${config.platforms.length} platforms`,
      action:
        mentionRate == null
          ? 'Run the first prompt suite and store the baseline.'
          : 'Review low-visibility prompts and competitor citations.',
      evidenceCount: config.platforms.length + config.competitors.length,
      observedAt: latestCheck?.completedAt ?? latestCheck?.createdAt ?? config.updatedAt,
    });
  }

  const communityItems: WatchlistItem[] = [];
  for (const community of dashboard?.communities.tracked ?? []) {
    const latestDigest = dashboard?.communities.latestDigests.find(
      (digest) =>
        digest.subreddit.toLowerCase() === community.subreddit.toLowerCase() &&
        digest.period === community.period
    );
    communityItems.push({
      id: `community-${community.id}`,
      surface: 'communities',
      title: `r/${community.subreddit} ${community.period} watch`,
      summary:
        latestDigest?.summary?.keyTrend?.desc ??
        latestDigest?.summaryText ??
        community.prompt ??
        'Tracked community needs a source-linked digest.',
      href: `/communities/${encodeURIComponent(community.subreddit)}/${community.period}`,
      priority: latestDigest ? 'medium' : 'high',
      status: latestDigest ? 'watching' : 'actionable',
      sourceLabel: `r/${community.subreddit}`,
      action:
        latestDigest?.summary?.keyAction?.desc ??
        'Generate a source-linked digest and extract the next product action.',
      evidenceCount: latestDigest?.sourceCount ?? 1,
      observedAt: latestDigest?.snapshotDate ?? community.updatedAt,
    });
  }

  const marketItems: WatchlistItem[] = signals.slice(0, 8).map((signal) => ({
    id: `market-${signal.id}`,
    surface: 'markets',
    title: signalTitle(signal),
    summary: `${signal.primaryEntityId} / ${signal.signalType.replaceAll('_', ' ')} / ${signal.direction}`,
    href: `/signals/${signal.slug}`,
    priority: marketPriority(signal),
    status: signal.confidence === 'high' ? 'actionable' : 'watching',
    sourceLabel: signal.primaryEntityId,
    action:
      signal.confidence === 'high'
        ? 'Review the thesis and decide whether it belongs in the weekly digest.'
        : 'Watch for a second confirming source before publishing follow-up.',
    evidenceCount: signal.evidenceUrls.length,
    observedAt: new Date(signal.publishedAt).toISOString(),
  }));

  return [
    {
      ...fallback[0],
      items: mentionItems.length ? mentionItems : fallback[0].items,
    },
    {
      ...fallback[1],
      items: communityItems.length ? communityItems : fallback[1].items,
    },
    {
      ...fallback[2],
      items: marketItems.length ? marketItems : fallback[2].items,
    },
  ];
}

export default async function WatchlistPage() {
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const [dashboardResult, signalsResult] = await Promise.allSettled([
    api.productDashboard(ownerId),
    api.signals({ status: 'published' }),
  ]);
  const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
  const signals = signalsResult.status === 'fulfilled' ? signalsResult.value.signals : [];
  const digest = buildWatchlistDigest(buildCollections(dashboard, signals));

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="operator watchlist" title="Unified Watchlist">
        One prioritized queue across mention checks, community digests, and market signals. The
        action digest keeps High Signal from becoming three disconnected feeds.
      </SectionHeader>

      <a
        href="/watchlist/entities"
        className="mt-6 inline-block border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        watched entities + impact chain →
      </a>

      <MetricGrid
        items={[
          { label: 'active items', value: digest.totalItems.toString() },
          { label: 'actionable', value: digest.actionableItems.toString() },
          { label: 'critical', value: digest.criticalItems.toString() },
          { label: 'stale', value: digest.staleItems.toString() },
        ]}
      />

      <FeedList
        eyebrow="action digest"
        empty="No urgent actions."
        items={digest.topActions.map((item) => ({
          href: item.href,
          kicker: `${item.surface} / ${item.priority} / ${item.reason}`,
          title: item.action,
          body: item.title,
        }))}
      />

      <section className="mt-10 grid gap-6">
        {digest.collections.map((collection) => (
          <Panel key={collection.id} eyebrow={collection.surface} title={collection.title}>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
              {collection.description}
            </p>
            <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {collection.items.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  className="block py-5 hover:text-[var(--color-accent)]"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                        {item.sourceLabel} / {item.status} / {item.evidenceCount} sources
                      </div>
                      <h2 className="mt-2 text-lg">{item.title}</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                        {item.summary}
                      </p>
                    </div>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${priorityTone(item.priority)}`}
                    >
                      {item.priority}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-fg)]">{item.action}</p>
                </a>
              ))}
            </div>
          </Panel>
        ))}
      </section>
    </PageShell>
  );
}
