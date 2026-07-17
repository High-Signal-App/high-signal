import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { api, fetchJson, type SignalRow } from '@/lib/api';
import { getRequestAuth } from '@/lib/require-auth';
import {
  BUNDLED_D2C_ARTIFACT,
  D2C_NICHE_SEEDS,
  composeD2COpportunityBrief,
  generateProductOpportunities,
  scoreD2CNiche,
  sourceDiversityFraction,
  distinctSourceClasses,
  type CommunityDigestSnapshot,
  type D2CAgentVisibilityEntry,
  type D2CNicheDelta,
  type D2CNicheSnapshotRecord,
  type IdeaFlowEvidence,
  type OpportunityBriefPayload,
} from '@high-signal/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Product Opportunities' };

const fallbackFlows: IdeaFlowEvidence[] = [
  {
    id: 'fallback-agent-eval',
    source: 'mention',
    title: 'Buyers increasingly validate brands through AI answers',
    summary:
      'Marketing now has to win human attention and agent evaluation; teams need evidence pages, comparison pages, pricing clarity, and proof that agents can cite.',
    href: '/agent-eval',
    observedAt: '2026-05-21T00:00:00.000Z',
    confidence: 'high',
  },
  {
    id: 'fallback-app-complaints',
    source: 'community',
    title: 'App builders complain about monitoring, cost, provenance, and brittle workflows',
    summary:
      'Repeated app requirements show up as complaints before they become obvious categories: workflow visibility, source-linked outputs, cost control, and repeatability.',
    href: '/communities',
    observedAt: '2026-05-21T00:00:00.000Z',
    confidence: 'medium',
  },
  {
    id: 'fallback-local-control',
    source: 'community',
    title: 'Technical users ask for local control and predictable AI spend',
    summary:
      'Smaller trends in self-hosted and local AI communities point toward privacy, auditability, and predictable cost as product requirements.',
    href: '/communities',
    observedAt: '2026-05-21T00:00:00.000Z',
    confidence: 'medium',
  },
];

function signalTitle(signal: SignalRow) {
  const firstLine = signal.bodyMd.split('\n').find((line) => line.trim()) ?? signal.slug;
  return firstLine.replace(/^#\s*/, '').trim() || signal.slug;
}

function evidenceFromSignals(signals: SignalRow[]): IdeaFlowEvidence[] {
  return signals.slice(0, 25).map((signal) => ({
    id: `signal-${signal.id}`,
    source: 'market' as const,
    title: signalTitle(signal),
    summary: `${signal.primaryEntityId} / ${signal.signalType.replaceAll('_', ' ')} / ${signal.direction} / ${signal.confidence} confidence`,
    href: `/signals/${signal.slug}`,
    observedAt: new Date(signal.publishedAt).toISOString(),
    confidence: signal.confidence,
  }));
}

function evidenceFromDigests(digests: CommunityDigestSnapshot[]): IdeaFlowEvidence[] {
  return digests.slice(0, 20).map((digest) => ({
    id: `digest-${digest.id}`,
    source: 'community' as const,
    title: digest.summary?.keyTrend?.title ?? `r/${digest.subreddit} ${digest.period} digest`,
    summary: digest.summary?.keyTrend?.desc ?? digest.summaryText,
    href: `/communities/${encodeURIComponent(digest.subreddit)}/${digest.period}`,
    observedAt: digest.snapshotDate,
    confidence: digest.sourceCount >= 8 ? 'high' : digest.sourceCount >= 3 ? 'medium' : 'low',
  }));
}

function horizonTone(horizon: string) {
  if (horizon === 'now') return 'text-[var(--color-accent)]';
  if (horizon === 'next') return 'text-amber-300';
  return 'text-[var(--color-muted)]';
}

function verdictTone(verdict: 'enter' | 'test' | 'watch' | 'avoid') {
  if (verdict === 'enter') return 'text-emerald-300';
  if (verdict === 'test') return 'text-[var(--color-accent)]';
  if (verdict === 'watch') return 'text-amber-300';
  return 'text-rose-300';
}

export default async function OpportunitiesPage() {
  // Public surface — anonymous visitors see the cross-source evidence
  // grid. Per-owner dashboard is fetched only when signed in.
  const auth = await getRequestAuth();
  const userId = (auth && 'userId' in auth && auth.userId) || null;
  const ownerId = (auth && 'orgId' in auth && auth.orgId) || userId || '';
  const [signalsResult, dashboardResult, discoverResult] = await Promise.allSettled([
    api.signals({ status: 'published' }),
    ownerId
      ? api.productDashboard(ownerId)
      : Promise.resolve(null as unknown as Awaited<ReturnType<typeof api.productDashboard>>),
    api.productCommunityDiscover('week'),
  ]);
  const signals = signalsResult.status === 'fulfilled' ? signalsResult.value.signals : [];
  const dashboard = dashboardResult.status === 'fulfilled' ? dashboardResult.value : null;
  const discover = discoverResult.status === 'fulfilled' ? discoverResult.value.items : [];
  const evidence = [
    ...evidenceFromSignals(signals),
    ...evidenceFromDigests(discover),
    ...evidenceFromDigests(dashboard?.communities.latestDigests ?? []),
    ...fallbackFlows,
  ];
  const opportunities = generateProductOpportunities(evidence);
  const nowCount = opportunities.filter((item) => item.horizon === 'now').length;
  const complaintEvidence = evidence.filter((item) =>
    /complaint|pain|need|want|manual|missing|friction|cost|monitor/i.test(
      `${item.title} ${item.summary}`
    )
  ).length;

  // India D2C Opportunity Pipeline (plan 0013). Try the live /d2c/opportunities
  // API first (Slices 3 + 4: persisted snapshots with score deltas, verdict
  // changes, aging, and agent-visibility overlay). Fall back to the build-time
  // bundled artifact + seed-only briefs when D1 is empty or the API is unreachable.
  interface D2cApiEntry {
    slug: string;
    name: string;
    category: string;
    region: string;
    status: string;
    latest: D2CNicheSnapshotRecord | null;
    delta: D2CNicheDelta | null;
    aging: 'aged-well' | 'aged-poorly' | 'stable' | 'insufficient-history';
    brief: OpportunityBriefPayload | null;
    agentVisibility: D2CAgentVisibilityEntry[];
  }
  interface D2cApiResponse {
    generatedAt: string;
    region: string;
    niches: D2cApiEntry[];
    source: 'd1' | 'seed-fallback';
  }
  let d2cApi: D2cApiResponse | null = null;
  try {
    d2cApi = await fetchJson<D2cApiResponse>('/d2c/opportunities');
  } catch {
    d2cApi = null;
  }

  const d2cArtifact = BUNDLED_D2C_ARTIFACT;
  const d2cRows = D2C_NICHE_SEEDS.map((seed) => {
    const apiEntry = d2cApi?.niches.find((n) => n.slug === seed.slug) ?? null;
    if (apiEntry?.brief) {
      return {
        seed,
        evidence: d2cArtifact?.niches.find((n) => n.nicheSlug === seed.slug) ?? null,
        brief: apiEntry.brief,
        score: apiEntry.latest?.opportunityScore ?? 0,
        delta: apiEntry.delta,
        aging: apiEntry.aging,
        agentVisibility: apiEntry.agentVisibility,
        source: 'd1' as const,
      };
    }
    // Seed-only fallback.
    const evidence = d2cArtifact?.niches.find((n) => n.nicheSlug === seed.slug) ?? null;
    const brief = composeD2COpportunityBrief(seed, evidence);
    const diversity = sourceDiversityFraction(evidence?.evidence ?? []);
    const score = scoreD2CNiche({
      demand: evidence?.demandScore ?? seed.defaultScores.demand,
      sourceDiversity: diversity,
      competition: evidence?.competitionScore ?? seed.defaultScores.competition,
      pricing: evidence?.pricingScore ?? seed.defaultScores.pricing,
      adSaturation: evidence?.adSaturationScore ?? seed.defaultScores.adSaturation,
      agentVisibility: evidence?.agentVisibilityScore ?? seed.defaultScores.agentVisibility,
    }).score;
    return {
      seed,
      evidence,
      brief,
      score,
      delta: null,
      aging: 'insufficient-history' as const,
      agentVisibility: [] as D2CAgentVisibilityEntry[],
      source: 'seed' as const,
    };
  });
  const d2cTestCount = d2cRows.filter((r) => r.brief.verdict === 'test').length;
  const d2cWatchCount = d2cRows.filter((r) => r.brief.verdict === 'watch').length;
  const d2cAvoidCount = d2cRows.filter((r) => r.brief.verdict === 'avoid').length;
  const d2cImprovedCount = d2cRows.filter((r) => r.delta?.trend === 'improved').length;
  const d2cDegradedCount = d2cRows.filter((r) => r.delta?.trend === 'degraded').length;

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="product ideas" title="What Should Be Built">
        Product opportunities backed by market signals, community complaints, and repeated requests.
        Each item explains the user, why now, and the smallest next step.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: 'Evidence',
            value: evidence.length.toString(),
            sub: 'market + community inputs',
          },
          { label: 'Build now', value: nowCount.toString(), sub: 'strongest opportunities' },
          {
            label: 'Complaints',
            value: complaintEvidence.toString(),
            sub: 'requirement-shaped signals',
          },
        ]}
      />

      <section className="mt-10 grid gap-8">
        {opportunities.map((opportunity) => (
          <Panel
            key={opportunity.id}
            eyebrow={`${opportunity.confidence} confidence`}
            title={
              <span>
                <span className={horizonTone(opportunity.horizon)}>{opportunity.horizon}</span> /{' '}
                {opportunity.title}
              </span>
            }
          >
            <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
              {opportunity.worldChange}
            </p>
            <MetricGrid
              items={[
                { label: 'evidence', value: opportunity.evidence.length.toString() },
                { label: 'horizon', value: opportunity.horizon },
                { label: 'confidence', value: opportunity.confidence },
                { label: 'target', value: opportunity.targetUser.split(' ')[0] ?? 'users' },
              ]}
            />
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  product to build
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                  {opportunity.productToBuild}
                </p>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  complaint pattern
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                  {opportunity.complaintPattern}
                </p>
              </div>
            </div>
            <div className="mt-6 border-t border-[var(--color-line)] pt-5 text-sm leading-6 text-[var(--color-muted)]">
              <span className="text-[var(--color-fg)]">Next:</span> {opportunity.nextStep}
            </div>
          </Panel>
        ))}
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="india d2c · plan 0013" title="India D2C Opportunity Briefs">
          20 curated India D2C niches scored on demand, competition, pricing, ad saturation, and
          agent visibility. Each brief carries a{' '}
          <span className="text-[var(--color-fg)]">test / watch / avoid</span> verdict, confidence
          band, cited evidence mix, and a next validation step. No impuls8 data is used.
        </SectionHeader>

        <StatGrid
          items={[
            { label: 'Niches', value: d2cRows.length.toString(), sub: 'curated india d2c' },
            { label: 'Test', value: d2cTestCount.toString(), sub: 'demand + open wedge' },
            { label: 'Watch', value: d2cWatchCount.toString(), sub: 'thin corroboration' },
            { label: 'Avoid', value: d2cAvoidCount.toString(), sub: 'saturated / weak' },
          ]}
        />

        {(d2cImprovedCount > 0 || d2cDegradedCount > 0) && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            <span>
              <span className="text-[var(--color-accent)]">{d2cImprovedCount}</span> improving
            </span>
            <span>
              <span className="text-[var(--color-fg)]">{d2cDegradedCount}</span> degrading
            </span>
          </div>
        )}

        <div className="mt-8 grid gap-6">
          {d2cRows.map(({ seed, evidence, brief, score, delta, aging, agentVisibility }) => {
            const sourceClassCount = distinctSourceClasses(evidence?.evidence ?? []);
            const avGap =
              agentVisibility.length > 0
                ? Math.max(...agentVisibility.map((a) => a.gapScore ?? 0))
                : null;
            const avBrands = agentVisibility.flatMap((a) => a.recommendedBrands);
            return (
              <Panel
                key={seed.slug}
                eyebrow={`${brief.confidence} confidence · ${seed.category}`}
                title={
                  <span>
                    <span className={verdictTone(brief.verdict)}>{brief.verdict}</span>
                    {' · '}
                    {seed.name}
                    <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">
                      {score}/100
                    </span>
                    {delta && delta.scoreDelta != null && (
                      <span
                        className={`ml-2 font-mono text-xs ${
                          delta.scoreDelta > 0
                            ? 'text-[var(--color-accent)]'
                            : delta.scoreDelta < 0
                              ? 'text-[var(--color-fg)]'
                              : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {delta.scoreDelta > 0 ? '+' : ''}
                        {delta.scoreDelta} wk
                      </span>
                    )}
                  </span>
                }
              >
                <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
                  <span className="text-[var(--color-fg)]">{brief.targetUser}</span> —{' '}
                  {brief.problem}
                </p>
                <MetricGrid
                  items={[
                    { label: 'verdict', value: brief.verdict },
                    { label: 'confidence', value: brief.confidence },
                    { label: 'sources', value: sourceClassCount.toString() },
                    { label: 'first sku', value: seed.firstSku.split(' ').slice(0, 2).join(' ') },
                  ]}
                />
                {delta?.verdictChanged && delta.previousVerdict && (
                  <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    verdict shifted:{' '}
                    <span className={verdictTone(delta.previousVerdict)}>
                      {delta.previousVerdict}
                    </span>{' '}
                    →{' '}
                    <span className={verdictTone(delta.currentVerdict)}>
                      {delta.currentVerdict}
                    </span>
                  </div>
                )}
                {aging !== 'insufficient-history' && (
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    prior call:{' '}
                    <span
                      className={
                        aging === 'aged-well'
                          ? 'text-[var(--color-accent)]'
                          : aging === 'aged-poorly'
                            ? 'text-[var(--color-fg)]'
                            : 'text-[var(--color-muted)]'
                      }
                    >
                      {aging.replace(/-/g, ' ')}
                    </span>
                  </div>
                )}
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      evidence mix
                    </div>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
                      {brief.evidenceMix.slice(0, 4).map((item) => (
                        <li key={`${item.kind}-${item.label}`}>
                          <span className="text-[var(--color-fg)]">{item.label}</span> ·{' '}
                          {item.strength} · {item.sourceCount} src
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      first SKU
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                      {seed.firstSku}
                    </p>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      agent visibility {avGap != null ? `· gap ${avGap.toFixed(2)}` : ''}
                    </div>
                    {agentVisibility.length > 0 ? (
                      <div className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                        AI recommends:{' '}
                        {avBrands.length > 0 ? (
                          <span className="text-[var(--color-fg)]">
                            {avBrands.slice(0, 4).join(', ')}
                          </span>
                        ) : (
                          <span className="text-[var(--color-accent)]">
                            no brand named — wide-open
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                        overlay not yet run
                      </p>
                    )}
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      risks
                    </div>
                    <ul className="mt-3 space-y-1 text-sm leading-6 text-[var(--color-muted)]">
                      {brief.risks.slice(0, 3).map((risk) => (
                        <li key={risk}>· {risk}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      next validation
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                      {brief.nextValidationStep}
                    </p>
                  </div>
                </div>
                {evidence && evidence.evidence.length > 0 ? (
                  <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-4 font-mono text-[10px] text-[var(--color-muted)]">
                    {evidence.evidence.slice(0, 5).map((item) => (
                      <li key={item.url}>
                        <a
                          className="hover:text-[var(--color-accent)]"
                          href={item.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {item.sourceClass}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-5 border-t border-[var(--color-line)] pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    seed-only · awaiting weekly collector artifact
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      </section>

      <FeedList
        eyebrow="latest evidence"
        empty="No evidence yet."
        items={evidence.slice(0, 10).map((item) => ({
          href: item.href,
          kicker: `${item.source} / ${item.confidence} / ${item.observedAt.slice(0, 10)}`,
          title: item.title,
          body: item.summary,
        }))}
      />
    </PageShell>
  );
}
