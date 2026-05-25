import {
  BackLink,
  FeedList,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import { api, type SignalRow } from "@/lib/api";
import { getRequestAuth } from "@/lib/require-auth";
import {
  generateProductOpportunities,
  type CommunityDigestSnapshot,
  type IdeaFlowEvidence,
} from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product Opportunities — High Signal" };

const fallbackFlows: IdeaFlowEvidence[] = [
  {
    id: "fallback-agent-eval",
    source: "mention",
    title: "Buyers increasingly validate brands through AI answers",
    summary:
      "Marketing now has to win human attention and agent evaluation; teams need evidence pages, comparison pages, pricing clarity, and proof that agents can cite.",
    href: "/agent-eval",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "high",
  },
  {
    id: "fallback-app-complaints",
    source: "community",
    title: "App builders complain about monitoring, cost, provenance, and brittle workflows",
    summary:
      "Repeated app requirements show up as complaints before they become obvious categories: workflow visibility, source-linked outputs, cost control, and repeatability.",
    href: "/communities",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "medium",
  },
  {
    id: "fallback-local-control",
    source: "community",
    title: "Technical users ask for local control and predictable AI spend",
    summary:
      "Smaller trends in self-hosted and local AI communities point toward privacy, auditability, and predictable cost as product requirements.",
    href: "/communities",
    observedAt: "2026-05-21T00:00:00.000Z",
    confidence: "medium",
  },
];

function signalTitle(signal: SignalRow) {
  const firstLine = signal.bodyMd.split("\n").find((line) => line.trim()) ?? signal.slug;
  return firstLine.replace(/^#\s*/, "").trim() || signal.slug;
}

function evidenceFromSignals(signals: SignalRow[]): IdeaFlowEvidence[] {
  return signals.slice(0, 25).map((signal) => ({
    id: `signal-${signal.id}`,
    source: "market" as const,
    title: signalTitle(signal),
    summary: `${signal.primaryEntityId} / ${signal.signalType.replaceAll("_", " ")} / ${signal.direction} / ${signal.confidence} confidence`,
    href: `/signals/${signal.slug}`,
    observedAt: new Date(signal.publishedAt).toISOString(),
    confidence: signal.confidence,
  }));
}

function evidenceFromDigests(digests: CommunityDigestSnapshot[]): IdeaFlowEvidence[] {
  return digests.slice(0, 20).map((digest) => ({
    id: `digest-${digest.id}`,
    source: "community" as const,
    title: digest.summary?.keyTrend?.title ?? `r/${digest.subreddit} ${digest.period} digest`,
    summary: digest.summary?.keyTrend?.desc ?? digest.summaryText,
    href: `/communities/${encodeURIComponent(digest.subreddit)}/${digest.period}`,
    observedAt: digest.snapshotDate,
    confidence: digest.sourceCount >= 8 ? "high" : digest.sourceCount >= 3 ? "medium" : "low",
  }));
}

function horizonTone(horizon: string) {
  if (horizon === "now") return "text-[var(--color-accent)]";
  if (horizon === "next") return "text-amber-300";
  return "text-[var(--color-muted)]";
}

export default async function OpportunitiesPage() {
  // Public surface — anonymous visitors see the cross-source evidence
  // grid. Per-owner dashboard is fetched only when signed in.
  const auth = await getRequestAuth();
  const userId = (auth && "userId" in auth && auth.userId) || null;
  const ownerId = (auth && "orgId" in auth && auth.orgId) || userId || "";
  const [signalsResult, dashboardResult, discoverResult] = await Promise.allSettled([
    api.signals({ status: "published" }),
    ownerId
      ? api.productDashboard(ownerId)
      : Promise.resolve(null as unknown as Awaited<ReturnType<typeof api.productDashboard>>),
    api.productCommunityDiscover("week"),
  ]);
  const signals = signalsResult.status === "fulfilled" ? signalsResult.value.signals : [];
  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const discover = discoverResult.status === "fulfilled" ? discoverResult.value.items : [];
  const evidence = [
    ...evidenceFromSignals(signals),
    ...evidenceFromDigests(discover),
    ...evidenceFromDigests(dashboard?.communities.latestDigests ?? []),
    ...fallbackFlows,
  ];
  const opportunities = generateProductOpportunities(evidence);
  const nowCount = opportunities.filter((item) => item.horizon === "now").length;
  const complaintEvidence = evidence.filter((item) =>
    /complaint|pain|need|want|manual|missing|friction|cost|monitor/i.test(
      `${item.title} ${item.summary}`,
    ),
  ).length;

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="product ideas" title="What Should Be Built">
        Product opportunities backed by market signals, community complaints, and repeated requests.
        Each item explains the user, why now, and the smallest next step.
      </SectionHeader>

      <StatGrid
        items={[
          { label: "Evidence", value: evidence.length.toString(), sub: "market + community inputs" },
          { label: "Build now", value: nowCount.toString(), sub: "strongest opportunities" },
          { label: "Complaints", value: complaintEvidence.toString(), sub: "requirement-shaped signals" },
        ]}
      />

      <section className="mt-10 grid gap-8">
        {opportunities.map((opportunity) => (
          <Panel
            key={opportunity.id}
            eyebrow={`${opportunity.confidence} confidence`}
            title={
              <span>
                <span className={horizonTone(opportunity.horizon)}>{opportunity.horizon}</span>{" "}
                / {opportunity.title}
              </span>
            }
          >
            <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
              {opportunity.worldChange}
            </p>
            <MetricGrid
              items={[
                { label: "evidence", value: opportunity.evidence.length.toString() },
                { label: "horizon", value: opportunity.horizon },
                { label: "confidence", value: opportunity.confidence },
                { label: "target", value: opportunity.targetUser.split(" ")[0] ?? "users" },
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
