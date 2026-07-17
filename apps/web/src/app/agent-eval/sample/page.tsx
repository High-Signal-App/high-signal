import Link from 'next/link';
import type { Route } from 'next';
import {
  BackLink,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import {
  COMPETITOR_PROMPT_TEMPLATES,
  SAMPLE_AUDIT_INPUTS,
  hydratePrompt,
  type CompetitorPromptTemplate,
  type VisibilityIntentCategory,
} from '@high-signal/shared';

export const metadata = {
  title: 'Sample AI visibility audit',
  description:
    'Walk-through of a finished AI visibility audit: how a brand shows up in ChatGPT, Claude, Gemini, and Perplexity vs its competitors, and the recommendation gaps to close.',
};

type CaseKey = 'linear' | 'cursor' | 'posthog';

const CASE_INDEX: Record<CaseKey, number> = {
  linear: 0,
  cursor: 1,
  posthog: 2,
};

const CASE_LABELS: Record<CaseKey, string> = {
  linear: 'Linear vs Jira',
  cursor: 'Cursor vs Copilot',
  posthog: 'PostHog vs Mixpanel',
};

const PLATFORMS = ['chatgpt', 'claude', 'gemini', 'perplexity'] as const;
type Platform = (typeof PLATFORMS)[number];

interface PlatformVisibility {
  platform: Platform;
  mentioned: number; // % of prompts where brand was named
  recommended: number; // % of prompts where brand was the recommended answer
  competitorPreferred: number; // % where a competitor was preferred over brand
}

interface CompetitorShare {
  name: string;
  share: number; // % share of voice across all prompt responses
  recommendedFor: number; // count of prompts where this competitor was the recommended answer
}

interface RecommendationGap {
  promptKey: string;
  category: VisibilityIntentCategory;
  rationale: string;
  promptText: string;
  observed: string;
  remedy: string;
  severity: 'blocker' | 'weak' | 'watch';
}

interface CaseReport {
  visibility: PlatformVisibility[];
  competitors: CompetitorShare[];
  gaps: RecommendationGap[];
  headlineRecommended: number; // prompts (out of total) where brand is recommended
  headlineMentioned: number;
  total: number;
}

// Hand-curated, deterministic per case. No data/model changes — pure sample.
const REPORTS: Record<CaseKey, CaseReport> = {
  linear: {
    total: 15,
    headlineRecommended: 6,
    headlineMentioned: 11,
    visibility: [
      { platform: 'chatgpt', mentioned: 80, recommended: 47, competitorPreferred: 33 },
      { platform: 'claude', mentioned: 73, recommended: 40, competitorPreferred: 27 },
      { platform: 'gemini', mentioned: 60, recommended: 27, competitorPreferred: 47 },
      { platform: 'perplexity', mentioned: 87, recommended: 53, competitorPreferred: 20 },
    ],
    competitors: [
      { name: 'Jira', share: 34, recommendedFor: 5 },
      { name: 'Asana', share: 19, recommendedFor: 2 },
      { name: 'GitHub Issues', share: 12, recommendedFor: 1 },
      { name: 'Linear', share: 35, recommendedFor: 6 },
    ],
    gaps: [
      {
        promptKey: 'trust_pricing_policy',
        category: 'trust_audit',
        rationale: 'Pricing opacity is the single most common reason agents decline to recommend.',
        promptText: "What is Linear's pricing, refund policy, and support SLA?",
        observed:
          'Agents quote per-seat tiers but flag missing refund policy and explicit SLA. Two assistants decline a confident answer and suggest contacting sales.',
        remedy:
          'Publish a single canonical pricing + policy page covering refund window, support tiers, and uptime SLA. Add Schema.org Offer + FAQPage.',
        severity: 'blocker',
      },
      {
        promptKey: 'dis_cheaper_option',
        category: 'displacement_risk',
        rationale: 'Tests price-sensitive displacement — a common B2B objection.',
        promptText:
          "Is there a cheaper option than Linear that still handles Jira's core use case?",
        observed:
          "Three of four agents surface lower-cost issue trackers (Plane, Shortcut, GitHub Issues) before defending Linear's value.",
        remedy:
          'Add a price-per-outcome comparison page citing throughput / cycle-time data, not just feature checkmarks. Make it indexable.',
        severity: 'weak',
      },
      {
        promptKey: 'trust_complaints',
        category: 'trust_audit',
        rationale: 'Agents surface complaints when proof is thin — this shows the risk.',
        promptText: 'What are the most common complaints about Linear?',
        observed:
          'Agents pull dated Reddit threads about missing native time-tracking and limited custom workflows. No counter-evidence cited.',
        remedy:
          'Publish a changelog highlight page mapping the top three complaints to shipped fixes, dates, and source links.',
        severity: 'weak',
      },
      {
        promptKey: 'dec_implementation_time',
        category: 'decision_support',
        rationale:
          'Implementation time is an agent-readable signal of docs and onboarding quality.',
        promptText: 'How long does it take to fully implement Linear versus Jira?',
        observed:
          'Agents estimate qualitatively ("days" vs "weeks") without citing setup docs. Linear\'s quickstart is not reliably surfaced.',
        remedy:
          'Add a /docs/setup-time anchor with a time-boxed onboarding outline. Cross-link from customers page.',
        severity: 'watch',
      },
    ],
  },
  cursor: {
    total: 15,
    headlineRecommended: 8,
    headlineMentioned: 13,
    visibility: [
      { platform: 'chatgpt', mentioned: 93, recommended: 60, competitorPreferred: 27 },
      { platform: 'claude', mentioned: 87, recommended: 67, competitorPreferred: 20 },
      { platform: 'gemini', mentioned: 73, recommended: 40, competitorPreferred: 47 },
      { platform: 'perplexity', mentioned: 93, recommended: 53, competitorPreferred: 33 },
    ],
    competitors: [
      { name: 'GitHub Copilot', share: 38, recommendedFor: 4 },
      { name: 'Codeium', share: 9, recommendedFor: 1 },
      { name: 'Tabnine', share: 6, recommendedFor: 0 },
      { name: 'Cursor', share: 47, recommendedFor: 8 },
    ],
    gaps: [
      {
        promptKey: 'cmp_compare_feature',
        category: 'direct_comparison',
        rationale: 'Reveals whether feature-level comparisons favour the brand.',
        promptText: 'Compare Cursor and GitHub Copilot on workflow automation and reporting.',
        observed:
          "Agents default to Copilot because Microsoft + GitHub trust signals dominate. Cursor's agent-mode advantages are referenced from third-party blogs, not first-party docs.",
        remedy:
          'Ship a canonical /compare/copilot page maintained in-house with side-by-side capabilities, refreshed quarterly with date stamps.',
        severity: 'blocker',
      },
      {
        promptKey: 'trust_pricing_policy',
        category: 'trust_audit',
        rationale: 'Pricing opacity is the single most common reason agents decline to recommend.',
        promptText: "What is Cursor's pricing, refund policy, and support SLA?",
        observed:
          'Plan names and prices are surfaced reliably but support SLA and refund terms missing.',
        remedy:
          'Add a public support policy page and link it from pricing. Schema.org Offer.priceValidUntil + termsOfService.',
        severity: 'weak',
      },
      {
        promptKey: 'dis_alternatives_to_brand',
        category: 'displacement_risk',
        rationale: 'Shows which competitors agents surface when the brand is named as the problem.',
        promptText: 'What are the best alternatives to Cursor?',
        observed:
          "Continue.dev and Aider are now surfaced alongside Copilot in three of four agents — newer OSS entrants are getting indexed faster than Cursor's response pages.",
        remedy:
          'Publish a /vs/open-source page acknowledging the OSS field and citing benchmarks. Defensible positioning > silence.',
        severity: 'weak',
      },
    ],
  },
  posthog: {
    total: 15,
    headlineRecommended: 7,
    headlineMentioned: 12,
    visibility: [
      { platform: 'chatgpt', mentioned: 87, recommended: 53, competitorPreferred: 33 },
      { platform: 'claude', mentioned: 80, recommended: 47, competitorPreferred: 33 },
      { platform: 'gemini', mentioned: 67, recommended: 33, competitorPreferred: 47 },
      { platform: 'perplexity', mentioned: 87, recommended: 53, competitorPreferred: 27 },
    ],
    competitors: [
      { name: 'Mixpanel', share: 28, recommendedFor: 3 },
      { name: 'Amplitude', share: 22, recommendedFor: 2 },
      { name: 'Heap', share: 8, recommendedFor: 1 },
      { name: 'PostHog', share: 42, recommendedFor: 7 },
    ],
    gaps: [
      {
        promptKey: 'cat_recommended_by_role',
        category: 'category_discovery',
        rationale: 'Tests visibility when a specific buyer role is named.',
        promptText:
          'What tools do engineering leaders recommend for issue tracking instead of Mixpanel?',
        observed:
          "Agents drift to traditional product-analytics rankings and miss PostHog's session replay + experiments bundle. Role-specific framing isn't crawled.",
        remedy:
          'Publish role-targeted landing pages (heads-of-eng, growth-leads) with citable customer outcomes.',
        severity: 'weak',
      },
      {
        promptKey: 'trust_reviews',
        category: 'trust_audit',
        rationale: 'Reveals whether third-party review sources are crawlable and cited.',
        promptText: 'What do G2 and Reddit say about PostHog compared to Mixpanel?',
        observed:
          'G2 review pages cited correctly; Reddit threads referenced are >12 months old and pre-date the analytics-suite reframe.',
        remedy:
          'Seed timely Reddit + HN AMAs around the analytics-suite positioning. Update the customers page with 2025 quotes.',
        severity: 'watch',
      },
      {
        promptKey: 'dec_who_not_for',
        category: 'decision_support',
        rationale: 'Agents that can answer this clearly signal the brand has strong positioning.',
        promptText: 'Who should NOT use PostHog and would be better served by Mixpanel?',
        observed:
          'Two agents answer cleanly (enterprise-only mobile analytics); two hedge. Mismatched stories suggest no canonical positioning page.',
        remedy:
          'Ship a /vs/mixpanel#not-for-you anchor stating exactly which segments to skip. Counter-intuitive honesty earns recommendations.',
        severity: 'weak',
      },
    ],
  },
};

const CATEGORY_LABEL: Record<VisibilityIntentCategory, string> = {
  category_discovery: 'category discovery',
  direct_comparison: 'direct comparison',
  displacement_risk: 'displacement risk',
  trust_audit: 'trust audit',
  decision_support: 'decision support',
};

function severityTone(severity: RecommendationGap['severity']) {
  if (severity === 'blocker') return 'text-rose-300';
  if (severity === 'weak') return 'text-amber-300';
  return 'text-zinc-100';
}

function scoreTone(value: number) {
  if (value >= 60) return 'text-[var(--color-accent)]';
  if (value >= 40) return 'text-zinc-100';
  if (value >= 25) return 'text-amber-300';
  return 'text-rose-300';
}

function MeterRow({
  label,
  value,
  suffix = '%',
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className="text-[var(--color-muted)]">{label}</span>
        <span className={`tabular-nums ${scoreTone(value)}`}>
          {value}
          {suffix}
        </span>
      </div>
      <div className="mt-2 h-px w-full bg-[var(--color-line)]">
        <div className="h-px bg-[var(--color-accent)]" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function templateFor(key: string): CompetitorPromptTemplate | undefined {
  return COMPETITOR_PROMPT_TEMPLATES.find((t) => t.key === key);
}

export default async function SampleReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ case?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const raw = (params.case ?? 'linear').toLowerCase();
  const caseKey: CaseKey = raw === 'cursor' || raw === 'posthog' ? (raw as CaseKey) : 'linear';

  const sample = SAMPLE_AUDIT_INPUTS[CASE_INDEX[caseKey]];
  const report = REPORTS[caseKey];
  const brand = sample.input.brandName;
  const primaryCompetitor = sample.input.competitors[0]?.name ?? '';

  const recommendedPct = Math.round((report.headlineRecommended / report.total) * 100);
  const mentionedPct = Math.round((report.headlineMentioned / report.total) * 100);
  const brandShare = report.competitors.find((c) => c.name === brand)?.share ?? 0;

  return (
    <PageShell max="max-w-5xl">
      <BackLink href="/agent-eval" />
      <SectionHeader
        eyebrow={`sample report / ${CASE_LABELS[caseKey]}`}
        title="AI visibility audit"
      >
        How {brand} actually shows up when buyers ask ChatGPT, Claude, Gemini, and Perplexity for{' '}
        {sample.input.buyerMission}. Read the gaps, then run the same audit on your own brand.
      </SectionHeader>

      <nav className="mt-6 flex flex-wrap gap-px border border-[var(--color-line)] bg-[var(--color-line)] font-mono text-[10px] uppercase tracking-[0.18em]">
        {(Object.keys(CASE_LABELS) as CaseKey[]).map((key) => {
          const active = key === caseKey;
          return (
            <Link
              key={key}
              href={`/agent-eval/sample?case=${key}` as Route}
              className={`bg-[var(--color-bg)] px-4 py-3 ${
                active
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              {CASE_LABELS[key]}
            </Link>
          );
        })}
      </nav>

      <StatGrid
        items={[
          {
            label: 'Prompts run',
            value: report.total.toString(),
            sub: 'five intent categories',
          },
          {
            label: 'Brand mentioned',
            value: `${mentionedPct}%`,
            sub: `${report.headlineMentioned} of ${report.total} prompts`,
          },
          {
            label: 'Brand recommended',
            value: `${recommendedPct}%`,
            sub: `${report.headlineRecommended} of ${report.total} prompts`,
          },
          {
            label: 'Share of voice',
            value: `${brandShare}%`,
            sub: `vs ${sample.input.competitors.length} named competitors`,
          },
        ]}
      />

      <section className="mt-10 grid gap-8 md:grid-cols-[1.05fr_0.95fr]">
        <Panel eyebrow="brand visibility" title="By AI platform">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Mention rate = how often {brand} appears in the response. Recommendation rate = how
            often {brand} is the answer the agent leads with.
          </p>
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {report.visibility.map((row) => (
              <div key={row.platform} className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-fg)]">
                    {row.platform}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    competitor preferred {row.competitorPreferred}%
                  </div>
                </div>
                <MeterRow label="mentioned" value={row.mentioned} />
                <MeterRow label="recommended" value={row.recommended} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="share of voice" title="Brand vs competitors">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            How prompt responses split between {brand} and the named competitor set across all 15
            prompts and 4 platforms.
          </p>
          <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {report.competitors
              .slice()
              .sort((a, b) => b.share - a.share)
              .map((c) => {
                const isBrand = c.name === brand;
                return (
                  <div key={c.name} className="py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={
                          isBrand
                            ? 'text-sm text-[var(--color-accent)]'
                            : 'text-sm text-[var(--color-fg)]'
                        }
                      >
                        {c.name}
                        {isBrand ? ' (you)' : ''}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
                        recommended for {c.recommendedFor}/{report.total}
                      </span>
                    </div>
                    <MeterRow label="share of voice" value={c.share} />
                  </div>
                );
              })}
          </div>
        </Panel>
      </section>

      <section className="mt-12 border-t border-[var(--color-line)] pt-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          recommendation gaps
        </div>
        <h2 className="mt-4 text-2xl font-medium tracking-tight sm:text-3xl">
          Where {brand} loses the recommendation
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
          Each gap is a prompt where the agent did not surface {brand} as the recommended answer.
          Severity reflects how close this prompt sits to a real buying decision.
        </p>

        <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {report.gaps.map((gap) => {
            const t = templateFor(gap.promptKey);
            const hydrated = t ? hydratePrompt(t, brand, primaryCompetitor) : gap.promptText;
            return (
              <article key={gap.promptKey} className="py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  <span>
                    {CATEGORY_LABEL[gap.category]} · {gap.promptKey}
                  </span>
                  <span className={severityTone(gap.severity)}>{gap.severity}</span>
                </div>
                <p className="mt-3 text-base leading-7 text-[var(--color-fg)]">
                  &ldquo;{hydrated}&rdquo;
                </p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      what agents said
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                      {gap.observed}
                    </p>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      close the gap
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-fg)]">{gap.remedy}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <MetricGrid
          items={[
            {
              label: 'blockers',
              value: report.gaps.filter((g) => g.severity === 'blocker').length.toString(),
            },
            {
              label: 'weak',
              value: report.gaps.filter((g) => g.severity === 'weak').length.toString(),
            },
            {
              label: 'watch',
              value: report.gaps.filter((g) => g.severity === 'watch').length.toString(),
            },
            {
              label: 'fixes shipped',
              value: '0 (sample)',
            },
          ]}
        />
      </section>

      <section className="mt-12 border-t border-[var(--color-line)] pt-8 sm:flex sm:items-baseline sm:justify-between sm:gap-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
            run your own
          </div>
          <h2 className="mt-3 text-xl font-medium tracking-tight">
            Audit your brand against your real competitors.
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-muted)]">
            Same 15-prompt matrix. Real agent responses where an LLM key is configured;
            deterministic synthesis otherwise. Output is a scored audit with prompts, evidence gaps,
            and the fixes ranked by impact.
          </p>
        </div>
        <Link
          href={'/agent-eval' as Route}
          className="mt-5 inline-flex border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] sm:mt-0"
        >
          run audit →
        </Link>
      </section>

      <p className="mt-10 border-l-2 border-[var(--color-line)] pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        Sample report. Numbers above are illustrative of a real run on the same 15-prompt matrix —
        not a live audit. Real audits cite the verbatim response per platform.
      </p>
    </PageShell>
  );
}
