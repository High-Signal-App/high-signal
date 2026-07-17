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
import { api, type AgentEvaluationAuditDetail, type AgentEvaluationCompetitor } from '@/lib/api';
import { getRequestAuth, requireSignedIn } from '@/lib/require-auth';
import {
  buildAgentEvaluationAudit,
  type AgentEvaluationInput,
  type PersistedAgentPromptResult,
  type PersistedEvidenceLayerScore,
  type PersistedMissingEvidenceTask,
  type PersistedReelBrief,
} from '@high-signal/shared';
import type { Route } from 'next';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agent Evaluation' };

const DEFAULT_EVIDENCE = `High Signal extracts actionable signals from noisy public and semi-public information streams.
It serves operators and builders who need evidence-backed product, community, mention, and market intelligence.
The current product includes public signal cards, source-linked community digests, AI visibility checks, and product-flow idea analysis.
Pricing, support policy, refund policy, security docs, and third-party review pages still need stronger public evidence.`;

type AgentEvalSearchParams = {
  audit?: string;
  local?: string;
  brandName?: string | string[];
  brandUrl?: string | string[];
  buyerMission?: string | string[];
  targetSegment?: string | string[];
  competitors?: string | string[];
  evidenceText?: string | string[];
  evidenceUrls?: string | string[];
};

function parseCompetitors(raw: string): AgentEvaluationCompetitor[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const [name, url] = line.split(',').map((part) => part?.trim());
      return { name: name ?? '', url: url || undefined };
    })
    .filter((competitor) => competitor.name);
}

function parseUrls(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 12);
}

function scoreTone(score: number) {
  if (score >= 75) return 'text-[var(--color-accent)]';
  if (score >= 50) return 'text-amber-300';
  return 'text-red-300';
}

function statusTone(status: string) {
  if (status === 'strong') return 'text-[var(--color-accent)]';
  if (status === 'clear') return 'text-zinc-100';
  if (status === 'weak') return 'text-amber-300';
  return 'text-red-300';
}

function localParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function localInput(params: AgentEvalSearchParams): AgentEvaluationInput | null {
  if (params.local !== '1') return null;
  const brandName = localParam(params.brandName).trim();
  const brandUrl = localParam(params.brandUrl).trim();
  const buyerMission = localParam(params.buyerMission).trim();
  if (!brandName || !brandUrl || !buyerMission) return null;
  return {
    ownerId: 'local',
    brandName,
    brandUrl,
    buyerMission,
    targetSegment: localParam(params.targetSegment).trim() || null,
    competitors: parseCompetitors(localParam(params.competitors)),
    evidenceText: localParam(params.evidenceText).trim() || null,
    evidenceUrls: parseUrls(localParam(params.evidenceUrls)),
  };
}

function buildLocalAuditDetail(input: AgentEvaluationInput): AgentEvaluationAuditDetail {
  const result = buildAgentEvaluationAudit(input);
  const now = new Date().toISOString();
  const auditId = 'local';
  return {
    audit: {
      id: auditId,
      ownerId: 'local',
      brandName: input.brandName,
      brandUrl: input.brandUrl,
      buyerMission: input.buyerMission,
      targetSegment: input.targetSegment ?? null,
      competitors: input.competitors ?? [],
      status: 'completed',
      overallScore: result.overallScore,
      recommendationSummary: result.recommendationSummary,
      evidenceText: input.evidenceText ?? null,
      evidenceUrls: input.evidenceUrls ?? [],
      createdAt: now,
      completedAt: now,
    },
    prompts: result.prompts.map(
      (prompt, index): PersistedAgentPromptResult => ({
        ...prompt,
        id: `local-prompt-${index}`,
        auditId,
        createdAt: now,
      })
    ),
    scores: result.scores.map(
      (score, index): PersistedEvidenceLayerScore => ({
        ...score,
        id: `local-score-${index}`,
        auditId,
        createdAt: now,
      })
    ),
    tasks: result.tasks.map(
      (task, index): PersistedMissingEvidenceTask => ({
        ...task,
        id: `local-task-${index}`,
        auditId,
        createdAt: now,
      })
    ),
    reelBriefs: result.reelBriefs.map(
      (brief, index): PersistedReelBrief => ({
        ...brief,
        id: `local-reel-${index}`,
        auditId,
        createdAt: now,
      })
    ),
  };
}

async function createAudit(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const brandName = `${formData.get('brandName') ?? ''}`.trim();
  const brandUrl = `${formData.get('brandUrl') ?? ''}`.trim();
  const buyerMission = `${formData.get('buyerMission') ?? ''}`.trim();
  const targetSegment = `${formData.get('targetSegment') ?? ''}`.trim();
  const competitors = parseCompetitors(`${formData.get('competitors') ?? ''}`);
  const evidenceText = `${formData.get('evidenceText') ?? ''}`.trim();
  const evidenceUrls = parseUrls(`${formData.get('evidenceUrls') ?? ''}`);
  const detail = await api.createAgentEvaluationAudit(ownerId, {
    brandName,
    brandUrl,
    buyerMission,
    targetSegment,
    competitors,
    evidenceText,
    evidenceUrls,
  });
  redirect(`/agent-eval?audit=${encodeURIComponent(detail.audit.id)}` as Route);
}

function AuditResult({ detail }: { detail: AgentEvaluationAuditDetail }) {
  const missing = detail.scores.filter((score) => score.status === 'missing').length;
  const weak = detail.scores.filter((score) => score.status === 'weak').length;
  const recommended = detail.prompts.filter((prompt) => prompt.brandRecommended).length;
  const firstReel = detail.reelBriefs[0];

  return (
    <>
      <section className="mt-10 grid gap-8 md:grid-cols-[0.85fr_1.15fr]">
        <Panel
          eyebrow="recommendation"
          title={
            <span className={scoreTone(detail.audit.overallScore)}>
              {detail.audit.overallScore}/100
            </span>
          }
        >
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            {detail.audit.recommendationSummary}
          </p>
          <MetricGrid
            items={[
              { label: 'prompts', value: detail.prompts.length.toString() },
              { label: 'recommended', value: `${recommended}/${detail.prompts.length}` },
              { label: 'missing', value: missing.toString() },
              { label: 'weak', value: weak.toString() },
            ]}
          />
        </Panel>

        <Panel eyebrow="brand" title={detail.audit.brandName}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            {detail.audit.buyerMission}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {detail.audit.competitors.map((competitor) => (
              <span
                key={competitor.name}
                className="border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
              >
                {competitor.name}
              </span>
            ))}
          </div>
          <a
            href={`/agent-eval/${encodeURIComponent(detail.audit.id)}/attributes`}
            className="mt-5 inline-block border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            view attribute grid →
          </a>
        </Panel>
      </section>

      <section className="mt-10 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
        {detail.scores.map((score) => (
          <div key={score.id} className="bg-[var(--color-bg)] p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {score.area}
            </div>
            <div className={`mt-5 text-xl font-medium ${statusTone(score.status)}`}>
              {score.status}
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{score.notes}</p>
          </div>
        ))}
      </section>

      <FeedList
        eyebrow="missing evidence tasks"
        empty="No missing evidence tasks."
        items={detail.tasks.map((task) => ({
          href: `/agent-eval?audit=${detail.audit.id}`,
          kicker: `${task.priority} / ${task.area}`,
          title: task.title,
          body: task.status,
        }))}
      />

      <FeedList
        eyebrow="agent prompt matrix"
        empty="No prompt results."
        items={detail.prompts.map((prompt) => ({
          href: `/agent-eval?audit=${detail.audit.id}`,
          kicker: `${prompt.surface} / ${prompt.brandRecommended ? 'recommendable' : 'not-ready'}`,
          title: prompt.promptText,
          body: prompt.responseText,
        }))}
      />

      {firstReel ? (
        <section className="mt-10 grid gap-8 md:grid-cols-[0.9fr_1.1fr]">
          <Panel eyebrow="attention layer" title="First reel brief">
            <div className="mt-5 text-xl leading-7">{firstReel.hook}</div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">{firstReel.caption}</p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {firstReel.claimBoundary}
            </p>
          </Panel>
          <Panel eyebrow="beats" title={firstReel.title}>
            <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {firstReel.visualBeats.map((beat) => (
                <div key={beat} className="py-3 text-sm leading-6 text-[var(--color-muted)]">
                  {beat}
                </div>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      <FeedList
        eyebrow="reel brief backlog"
        empty="No reel briefs."
        items={detail.reelBriefs.map((brief) => ({
          href: `/agent-eval?audit=${detail.audit.id}`,
          kicker: `claim boundary / ${brief.evidenceUrls.length} evidence urls`,
          title: brief.title,
          body: brief.hook,
        }))}
      />
    </>
  );
}

export default async function AgentEvalPage({
  searchParams,
}: {
  searchParams?: Promise<AgentEvalSearchParams>;
}) {
  const auth = await getRequestAuth();
  const ownerId = auth ? (auth.orgId ?? auth.userId) : null;
  const params = (await searchParams) ?? {};
  const auditId = params.audit;
  const localDetail = localInput(params);
  const [auditsResult, detailResult] = ownerId
    ? await Promise.allSettled([
        api.agentEvaluationAudits(ownerId, 8),
        auditId ? api.agentEvaluationAudit(ownerId, auditId) : Promise.resolve(null),
      ])
    : [
        { status: 'fulfilled' as const, value: { audits: [] } },
        { status: 'fulfilled' as const, value: null },
      ];
  const audits = auditsResult.status === 'fulfilled' ? auditsResult.value.audits : [];
  const detail = localDetail
    ? buildLocalAuditDetail(localDetail)
    : detailResult.status === 'fulfilled'
      ? detailResult.value
      : null;

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="agent evaluation intelligence" title="Agent Evaluation">
        Audit whether a brand is legible, credible, and recommendable to AI assistants and buyer
        agents. Then turn only verified proof into short-form attention briefs.
      </SectionHeader>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        new to this →{' '}
        <a href="/agent-eval/sample" className="text-[var(--color-accent)] hover:underline">
          read a sample report
        </a>
      </p>

      <StatGrid
        items={[
          { label: 'Input', value: 'URL + mission', sub: 'product, buyer, competitors' },
          { label: 'Output', value: 'audit + tasks', sub: 'scores, gaps, prompt matrix' },
          { label: 'Attention', value: 'reel briefs', sub: 'proof-bound short-form hooks' },
        ]}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-[0.95fr_1.05fr]">
        <Panel eyebrow="new audit" title="Recommendation-worthiness">
          <form action={ownerId ? createAudit : '/agent-eval'} method={ownerId ? undefined : 'get'}>
            {!ownerId ? <input type="hidden" name="local" value="1" /> : null}
            <Field label="Brand" name="brandName" defaultValue="High Signal" />
            <Field label="Brand URL" name="brandUrl" defaultValue="https://highsignalsuite.com" />
            <Field
              label="Buyer mission"
              name="buyerMission"
              defaultValue="find source-linked product and market signals before deciding what to build"
            />
            <Field
              label="Target segment"
              name="targetSegment"
              defaultValue="solo builders, operators, and product teams"
            />
            <Field
              label="Competitors (one per line, optional comma URL)"
              name="competitors"
              defaultValue={'AlphaSense\nBrandwatch\nExploding Topics'}
              multiline
            />
            <Field
              label="Evidence notes"
              name="evidenceText"
              defaultValue={DEFAULT_EVIDENCE}
              multiline
            />
            <Field
              label="Evidence URLs"
              name="evidenceUrls"
              defaultValue="https://highsignalsuite.com/signals https://highsignalsuite.com/digest"
              multiline
            />
            <CommandButton>{ownerId ? 'run and save audit' : 'run local audit'}</CommandButton>
          </form>
        </Panel>

        <Panel
          eyebrow={ownerId ? 'recent audits' : 'local mode'}
          title={ownerId ? 'History' : 'No login required'}
        >
          {!ownerId ? (
            <p className="mt-5 text-sm leading-6 text-[var(--color-muted)]">
              You can run the deterministic local evaluator without signing in. Login is only needed
              to save audit history, rerun previous audits, and attach results to a tracked brand.
            </p>
          ) : null}
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {audits.length ? (
              audits.map((audit) => (
                <a
                  key={audit.id}
                  href={`/agent-eval?audit=${encodeURIComponent(audit.id)}`}
                  className="block py-4 hover:text-[var(--color-accent)]"
                >
                  <div className="flex items-center justify-between gap-5">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                        {audit.createdAt.slice(0, 10)} / {audit.status}
                      </div>
                      <div className="mt-2 text-sm">{audit.brandName}</div>
                    </div>
                    <div className={`font-mono text-sm ${scoreTone(audit.overallScore)}`}>
                      {audit.overallScore}
                    </div>
                  </div>
                </a>
              ))
            ) : (
              <p className="py-4 text-sm text-[var(--color-muted)]">No audits yet.</p>
            )}
          </div>
        </Panel>
      </section>

      {detail ? <AuditResult detail={detail} /> : null}
    </PageShell>
  );
}
