import {
  BackLink,
  CommandButton,
  FeedList,
  Field,
  MetricGrid,
  PageShell,
  Panel,
  RouteList,
  SectionHeader,
} from "@/components/system/HighSignalUI";
import { api, type SignalRow } from "@/lib/api";
import { getRequestAuth } from "@/lib/require-auth";
import {
  analyzeIdeaAgainstFlow,
  type CommunityDigestSnapshot,
  type IdeaFlowEvidence,
} from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Idea Intelligence — High Signal" };

const DEFAULT_IDEA =
  "A source-linked product intelligence tool that tells founders which product ideas are getting pulled by market, community, and AI visibility signals.";

const fallbackFlows: IdeaFlowEvidence[] = [
  {
    id: "fallback-community-ops",
    source: "community",
    title: "Operators ask for source-linked workflow monitoring",
    summary:
      "Community discussion keeps moving from broad AI hype into monitoring, provenance, repeatable workflows, and cost control.",
    href: "/communities",
    observedAt: "2026-05-01T00:00:00.000Z",
    confidence: "medium",
  },
  {
    id: "fallback-mention-citations",
    source: "mention",
    title: "AI visibility depends on cited source presence",
    summary:
      "Prompt opportunities show that brands need to know where competitors appear, where citations are missing, and what content should exist.",
    href: "/mentions",
    observedAt: "2026-05-01T00:00:00.000Z",
    confidence: "medium",
  },
  {
    id: "fallback-market-proof",
    source: "market",
    title: "Market products need evidence trails and source memory",
    summary:
      "The strongest wedge is not raw prediction; it is a versioned signal ledger with evidence and confidence.",
    href: "/signals",
    observedAt: "2026-05-01T00:00:00.000Z",
    confidence: "high",
  },
];

function signalTitle(signal: SignalRow) {
  const firstLine = signal.bodyMd.split("\n").find((line) => line.trim()) ?? signal.slug;
  return firstLine.replace(/^#\s*/, "").trim() || signal.slug;
}

function evidenceFromSignals(signals: SignalRow[]): IdeaFlowEvidence[] {
  return signals.slice(0, 20).map((signal) => ({
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
  return digests.slice(0, 12).map((digest) => ({
    id: `digest-${digest.id}`,
    source: "community" as const,
    title: digest.summary?.keyTrend?.title ?? `r/${digest.subreddit} ${digest.period} digest`,
    summary: digest.summary?.keyTrend?.desc ?? digest.summaryText,
    href: `/communities/${encodeURIComponent(digest.subreddit)}/${digest.period}`,
    observedAt: digest.snapshotDate,
    confidence: digest.sourceCount >= 8 ? "high" : digest.sourceCount >= 3 ? "medium" : "low",
  }));
}

function verdictTone(verdict: string) {
  if (verdict === "pursue") return "text-[var(--color-accent)]";
  if (verdict === "test") return "text-amber-300";
  if (verdict === "avoid") return "text-red-300";
  return "text-[var(--color-muted)]";
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams?: Promise<{ idea?: string }>;
}) {
  // Public surface — any visitor can type a thesis and see it scored
  // against published signals + community digests. Per-owner dashboard
  // is only fetched when signed in.
  const auth = await getRequestAuth();
  const userId = (auth && "userId" in auth && auth.userId) || null;
  const ownerId = (auth && "orgId" in auth && auth.orgId) || userId || "";
  const params = (await searchParams) ?? {};
  const idea = (params.idea ?? DEFAULT_IDEA).trim();

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
  const analysis = analyzeIdeaAgainstFlow(idea, evidence);

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="idea checker" title="Should I build this?">
        Paste a product idea. High Signal compares it with current evidence and returns a plain
        decision: pursue, test, watch, or avoid.
      </SectionHeader>

      <RouteList
        items={[
          {
            href: "/opportunities",
            title: "What should be built",
            sub: "product opportunities already found",
          },
        ]}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-[0.9fr_1.1fr]">
        <Panel eyebrow="input" title="Product idea">
          <form>
            <Field label="Idea" name="idea" defaultValue={idea} multiline />
            <CommandButton>analyze idea</CommandButton>
          </form>
        </Panel>

        <Panel eyebrow="decision" title={<span className={verdictTone(analysis.verdict)}>{analysis.verdict}</span>}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{analysis.thesis}</p>
          <MetricGrid
            items={[
              { label: "fit", value: analysis.fitScore.toString() },
              { label: "demand", value: analysis.demandScore.toString() },
              { label: "timing", value: analysis.timingScore.toString() },
              { label: "risk", value: analysis.riskScore.toString() },
            ]}
          />
        </Panel>
      </section>

      <FeedList
        eyebrow="supporting flow"
        empty="No supporting flow found yet."
        items={analysis.supporting.map((item) => ({
          href: item.href,
          kicker: `${item.source} / ${item.confidence} / ${item.observedAt.slice(0, 10)}`,
          title: item.title,
          body: item.summary,
        }))}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-2">
        <Panel eyebrow="risks" title="Contradicting flow">
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {analysis.contradicting.length ? (
              analysis.contradicting.map((item) => (
                <a key={item.id} href={item.href} className="block py-4 hover:text-[var(--color-accent)]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    {item.source} / {item.confidence}
                  </div>
                  <div className="mt-2 text-sm">{item.title}</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{item.summary}</p>
                </a>
              ))
            ) : (
              <p className="py-4 text-sm text-[var(--color-muted)]">No direct contradiction found.</p>
            )}
          </div>
        </Panel>

        <Panel eyebrow="next" title="What to do">
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {analysis.nextActions.map((action) => (
              <div key={action} className="py-4 text-sm leading-6 text-[var(--color-muted)]">
                {action}
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <FeedList
        eyebrow="watch flow"
        empty="No watch items."
        items={analysis.watch.map((item) => ({
          href: item.href,
          kicker: `${item.source} / ${item.confidence} / ${item.observedAt.slice(0, 10)}`,
          title: item.title,
          body: item.summary,
        }))}
      />
    </PageShell>
  );
}
