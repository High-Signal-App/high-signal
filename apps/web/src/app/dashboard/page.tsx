import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
} from '@/components/system/HighSignalUI';
import { api, type ProductDashboardSnapshot } from '@/lib/api';
import { getRequestAuth } from '@/lib/require-auth';
import type { MentionBrandConfig, TrackedCommunity } from '@high-signal/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — High Signal' };

const brandConfig: MentionBrandConfig = {
  id: 'brand_high_signal',
  companyId: 'company_high_signal',
  brandName: 'High Signal',
  brandAliases: ['HighSignal', 'High Signal Suite'],
  brandUrl: 'https://highsignalsuite.com',
  competitors: [{ name: 'Brandwatch' }, { name: 'G2' }],
  platforms: ['openai', 'anthropic', 'perplexity'],
  aiEndpointUrl: null,
  aiModel: 'multi-model',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const trackedCommunities: TrackedCommunity[] = [
  {
    id: 'community_localllama',
    ownerId: 'workspace_default',
    subreddit: 'LocalLLaMA',
    prompt:
      'Extract operational pain, buying intent, recurring product requests, and source-linked shifts in agent infrastructure.',
    period: 'week',
    isPublic: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'community_saas',
    ownerId: 'workspace_default',
    subreddit: 'SaaS',
    prompt: 'Find demand, pricing, positioning, and competitor signals for B2B software teams.',
    period: 'week',
    isPublic: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

function fallbackDashboard(ownerId: string): ProductDashboardSnapshot {
  return {
    ownerId,
    mentions: {
      configs: [brandConfig],
      prompts: [],
      recentChecks: [],
    },
    communities: {
      tracked: trackedCommunities,
      latestDigests: [],
    },
  };
}

export default async function DashboardPage() {
  // Public surface — anonymous visitors see the fallback dashboard
  // shape (sample tracked communities + brand config). Signed-in users
  // see their real data instead.
  const auth = await getRequestAuth();
  const userId = (auth && 'userId' in auth && auth.userId) || null;
  const ownerId = (auth && 'orgId' in auth && auth.orgId) || userId || 'anonymous';
  let dashboard = fallbackDashboard(ownerId);
  if (userId) {
    try {
      dashboard = await api.productDashboard(ownerId);
    } catch {
      /* Local fallback keeps the dashboard useful before product tables are seeded. */
    }
  }

  const activeBrand = dashboard.mentions.configs[0] ?? brandConfig;
  const communities = dashboard.communities.tracked.length
    ? dashboard.communities.tracked
    : trackedCommunities;
  const promptCount = dashboard.mentions.prompts.length;
  const latestCheck = dashboard.mentions.recentChecks[0];

  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="workspace" title="Signal Dashboard">
        A single place to check brand mentions, tracked communities, and market context before
        deciding what needs attention.
      </SectionHeader>

      <MetricGrid
        items={[
          { label: 'brand', value: activeBrand.brandName },
          { label: 'platforms', value: activeBrand.platforms.length.toString() },
          { label: 'prompts', value: promptCount.toString() },
          { label: 'communities', value: communities.length.toString() },
        ]}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-2">
        <Panel eyebrow="mention intelligence" title={activeBrand.brandName}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Track AI visibility, citations, competitor mentions, and prompt-level response quality
            for {activeBrand.brandUrl ?? activeBrand.brandName}.
          </p>
          {latestCheck ? (
            <MetricGrid
              items={[
                { label: 'status', value: latestCheck.status },
                {
                  label: 'queries',
                  value: `${latestCheck.completedQueries}/${latestCheck.totalQueries}`,
                },
                {
                  label: 'mention rate',
                  value:
                    latestCheck.brandMentionRate == null
                      ? 'unknown'
                      : `${Math.round(latestCheck.brandMentionRate * 100)}%`,
                },
                { label: 'completed', value: latestCheck.completedAt?.slice(0, 10) ?? 'pending' },
              ]}
            />
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {activeBrand.competitors.map((competitor) => (
              <span
                key={competitor.name}
                className="border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
              >
                {competitor.name}
              </span>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="community intelligence" title="Tracked subreddits">
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {communities.map((community) => (
              <a
                key={community.id}
                href={`/communities?subreddit=${encodeURIComponent(community.subreddit)}`}
                className="block py-4 hover:text-[var(--color-accent)]"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  r/{community.subreddit} / {community.period}
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                  {community.prompt}
                </p>
              </a>
            ))}
          </div>
        </Panel>
      </section>

      <FeedList
        eyebrow="next work areas"
        empty="No pending surfaces."
        items={[
          {
            href: '/personal',
            kicker: 'planning brief',
            title: 'Review what to build, change, watch, or pause',
            body: 'Evidence is mapped onto the current product fleet.',
          },
          {
            href: '/watchlist',
            kicker: 'watchlist',
            title: 'Prioritize unified watchlist items',
            body: 'Mention checks, community digests, and market signals roll up into one queue.',
          },
          {
            href: '/mentions',
            kicker: 'mentions',
            title: 'Productionize brand configs, prompts, checks, and reports',
            body: 'Keep brand and competitor checks easy to inspect.',
          },
          {
            href: '/communities',
            kicker: 'communities',
            title: 'Productionize tracked subreddit digests',
            body: 'Turn recurring public complaints into readable source-linked summaries.',
          },
          {
            href: '/agent-eval',
            kicker: 'agent evaluation',
            title: 'Run product audits against the buyer-agent checklist',
            body: 'Find missing evidence and the product proof needed for recommendation.',
          },
        ]}
      />
    </PageShell>
  );
}
