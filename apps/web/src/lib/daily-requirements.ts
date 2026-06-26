import type { DailyBroadInsight } from '@/lib/daily-intelligence';
import type {
  LightweightDomain,
  LightweightSignalLayer,
  PersonalActionKind,
  PersonalActionTask,
  PersonalProductProfile,
  SignalContentCategory,
} from '@high-signal/shared';

export type DailyRequirementPriority = 'critical' | 'high' | 'medium' | 'low';

export type DailyRequirementItem = {
  id: string;
  title: string;
  summary: string;
  href: string;
  sourceLabel: string;
  contentCategory: SignalContentCategory;
  signalLayer: LightweightSignalLayer;
  domains: LightweightDomain[];
  intent: string;
  sentiment: string;
  priority: DailyRequirementPriority;
  score: number;
  painScore: number;
  buyerIntentScore: number;
  actionabilityScore: number;
  qualityScore: number;
  scoreBreakdown: Array<{
    label: 'actionability' | 'buyer-intent' | 'pain' | 'quality' | 'repetition';
    value: number;
    contribution: number;
    max: number;
  }>;
  fleetTarget: DailyRequirementFleetTarget | null;
  alternativeFleetTargets: DailyRequirementFleetTarget[];
  taskDraft: PersonalActionTask | null;
  sourceCount: number;
  repeatedSignalCount: number;
  suggestedBuild: string;
  whyNow: string;
  nextStep: string;
  userStory: string;
  acceptanceCriteria: string[];
  validationArtifact: string;
  smallestTest: string;
};

export type DailyRequirementFleetTarget = {
  productSlug: string;
  productName: string;
  action: PersonalActionKind;
  fitScore: number;
  reason: string;
  defaultAction: string;
};

export const DAILY_REQUIREMENT_GATE = {
  minScore: 50,
  minSourceCount: 3,
  minRepeatedSignalCount: 3,
  acceptedTargetActions: ['build', 'change'] as PersonalActionKind[],
  rejectedAnnotationStatuses: ['weak'] as const,
  description:
    'Only publishes requirements with score >= 50, >=3 source items, >=3 repeated product cues, a non-weak annotation gate, and a build/change fleet target.',
} as const;

const DOMAIN_BUILD: Partial<Record<LightweightDomain, string>> = {
  'agent-evaluation': 'Agent-readiness evidence surface',
  consumer: 'Consumer pressure radar',
  developer: 'Developer workflow friction spec',
  market: 'Market-regime watch note',
  operations: 'Operations workflow requirement',
  regional: 'Regional constraint tracker',
  'small-business': 'Small-business operations artifact',
  startup: 'Startup validation artifact',
};

const DOMAIN_OPPORTUNITIES: Partial<Record<LightweightDomain, string[]>> = {
  'agent-evaluation': ['agent-evaluation', 'source-provenance'],
  consumer: ['public-consumer-shift', 'complaint-to-spec'],
  developer: ['developer-workflow-friction', 'workflow-observability', 'source-provenance'],
  market: ['market-regime-watch'],
  operations: ['workflow-observability', 'small-business-ops', 'complaint-to-spec'],
  regional: ['regional-constraint-watch', 'public-consumer-shift', 'complaint-to-spec'],
  'small-business': ['small-business-ops', 'complaint-to-spec', 'workflow-observability'],
  startup: ['launch-distribution', 'complaint-to-spec', 'agent-evaluation'],
};

const CATEGORY_OPPORTUNITIES: Partial<Record<SignalContentCategory, string[]>> = {
  'agent-evaluation': ['agent-evaluation', 'source-provenance'],
  'customer-complaint': ['complaint-to-spec', 'small-business-ops'],
  'market-pulse': ['market-regime-watch'],
  'policy-regulatory': ['regional-constraint-watch', 'public-consumer-shift'],
  'product-opportunity': ['complaint-to-spec', 'workflow-observability'],
  'regional-issue': ['regional-constraint-watch', 'public-consumer-shift'],
  'security-risk': ['platform-risk-watch', 'developer-trust-proof'],
  'startup-move': ['launch-distribution', 'complaint-to-spec'],
};

function priorityFor(score: number): DailyRequirementPriority {
  if (score >= 78) return 'critical';
  if (score >= 62) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function passesDailyRequirementGate(input: {
  item: DailyBroadInsight;
  score: number;
  fleetTarget: DailyRequirementFleetTarget | null;
}) {
  if (!input.item.annotation.productRequirement) return false;
  if (input.item.annotation.qualityGate.status === 'weak') return false;
  if (input.item.sourceCount < DAILY_REQUIREMENT_GATE.minSourceCount) return false;
  if (input.item.repeatedSignalCount < DAILY_REQUIREMENT_GATE.minRepeatedSignalCount) return false;
  if (input.score < DAILY_REQUIREMENT_GATE.minScore) return false;
  if (!input.fleetTarget) return false;
  return DAILY_REQUIREMENT_GATE.acceptedTargetActions.includes(input.fleetTarget.action);
}

function primaryDomain(item: DailyBroadInsight): LightweightDomain | null {
  return item.annotation.domains[0] ?? null;
}

function suggestedBuildFor(item: DailyBroadInsight) {
  const domain = primaryDomain(item);
  return domain
    ? (DOMAIN_BUILD[domain] ?? 'Source-linked validation artifact')
    : 'Source-linked validation artifact';
}

function requirementOpportunitySlugs(item: DailyBroadInsight) {
  return Array.from(
    new Set(
      [
        ...item.annotation.domains.flatMap((domain) => DOMAIN_OPPORTUNITIES[domain] ?? []),
        ...(CATEGORY_OPPORTUNITIES[item.contentCategory] ?? []),
        item.annotation.productRequirement ? 'complaint-to-spec' : '',
      ].filter(Boolean)
    )
  );
}

function normalizedTextFor(item: DailyBroadInsight) {
  return [
    item.title,
    item.summary,
    item.sourceLabel,
    item.contentCategory,
    item.annotation.signalLayer,
    ...item.annotation.domains,
    ...item.annotation.productSignals,
  ]
    .join(' ')
    .toLowerCase();
}

function productTermScore(product: PersonalProductProfile, text: string) {
  return product.terms.reduce((sum, term) => {
    const normalizedTerm = term.toLowerCase();
    if (!normalizedTerm) return sum;
    return text.includes(normalizedTerm) ? sum + 7 : sum;
  }, 0);
}

function stageAdjustment(product: PersonalProductProfile) {
  if (product.stage === 'active') return 8;
  if (product.stage === 'exploratory') return 2;
  return -6;
}

function productSpecificBoost(
  product: PersonalProductProfile,
  item: DailyBroadInsight,
  text: string
) {
  if (
    product.slug === 'CodeVetter' &&
    (item.annotation.domains.includes('developer') || /bug|review|github|ci|deploy|code/.test(text))
  ) {
    return 18;
  }
  if (
    product.slug === 'saas-maker' &&
    /fleet|task|audit|deploy|monitor|ops|workflow|automation|project/.test(text)
  ) {
    return 18;
  }
  if (
    product.slug === 'free-ai' &&
    /local|privacy|model|routing|cost|open source|self-hosted/.test(text)
  ) {
    return 18;
  }
  if (
    product.slug === 'high-signal' &&
    (item.annotation.signalLayer === 'world-change' ||
      item.annotation.domains.some((domain) =>
        [
          'agent-evaluation',
          'market',
          'regional',
          'small-business',
          'startup',
          'consumer',
        ].includes(domain)
      ))
  ) {
    return 12;
  }
  return 0;
}

function targetActionFor(input: {
  product: PersonalProductProfile;
  fitScore: number;
  requirementScore: number;
  item: DailyBroadInsight;
}): PersonalActionKind {
  if (input.fitScore < 24) return 'pause';
  if (input.product.stage === 'watch') return input.fitScore >= 48 ? 'watch' : 'pause';
  if (input.requirementScore >= 70 && input.fitScore >= 58) return 'build';
  if (input.requirementScore >= 45 && input.fitScore >= 38) return 'change';
  return 'watch';
}

function fleetTargetsFor(
  item: DailyBroadInsight,
  products: PersonalProductProfile[] = []
): DailyRequirementFleetTarget[] {
  if (!products.length) return [];
  const text = normalizedTextFor(item);
  const opportunitySlugs = requirementOpportunitySlugs(item);
  const requirementScore = scoreFor(item);
  return products
    .map((product) => {
      const opportunityHits = opportunitySlugs.filter(
        (slug) => product.opportunitySlugs?.includes(slug) ?? false
      );
      const termScore = productTermScore(product, text);
      const fitScore = Math.min(
        100,
        opportunityHits.length * 16 +
          termScore +
          stageAdjustment(product) +
          productSpecificBoost(product, item, text)
      );
      const action = targetActionFor({ product, fitScore, requirementScore, item });
      return {
        productSlug: product.slug,
        productName: product.name,
        action,
        fitScore,
        reason:
          opportunityHits.length > 0
            ? `matches ${opportunityHits.slice(0, 3).join(', ')}`
            : termScore > 0
              ? `matches ${Math.ceil(termScore / 7)} product term(s)`
              : `${product.stage} product with weak direct match`,
        defaultAction: product.defaultAction,
      };
    })
    .filter((target) => target.action !== 'pause')
    .sort((a, b) => b.fitScore - a.fitScore || a.productName.localeCompare(b.productName))
    .slice(0, 3);
}

function taskStatusFor(action: PersonalActionKind): PersonalActionTask['status'] {
  if (action === 'build' || action === 'change') return 'todo';
  if (action === 'watch') return 'later';
  return 'rejected';
}

function taskDraftFor(input: {
  item: DailyBroadInsight;
  score: number;
  priority: DailyRequirementPriority;
  target: DailyRequirementFleetTarget | null;
  whyNow: string;
  nextStep: string;
  acceptanceCriteria: string[];
}): PersonalActionTask | null {
  if (!input.target) return null;
  return {
    id: `daily-requirement-task-${input.item.id}`,
    recommendationId: `daily-requirement-${input.item.id}`,
    productSlug: input.target.productSlug,
    productName: input.target.productName,
    title: `[High Signal Requirement] ${input.target.action.toUpperCase()} ${input.target.productName}: ${input.item.title}`,
    status: taskStatusFor(input.target.action),
    priority: input.priority,
    action: input.target.action,
    rationale: `${input.whyNow} Fit: ${input.target.reason}.`,
    nextStep: input.nextStep,
    acceptanceCriteria: input.acceptanceCriteria,
    evidenceUrls: [input.item.href],
    saasMakerProjectSlug: input.target.productSlug,
    syncStatus: 'pending',
  };
}

function userLabelFor(item: DailyBroadInsight) {
  const domain = primaryDomain(item);
  if (domain === 'small-business') return 'small business operator';
  if (domain === 'developer') return 'developer or technical operator';
  if (domain === 'regional') return 'local operator';
  if (domain === 'startup') return 'startup builder';
  if (domain === 'agent-evaluation') return 'founder being evaluated by AI/search agents';
  if (domain === 'operations') return 'operations owner';
  if (domain === 'consumer') return 'consumer-facing product owner';
  if (domain === 'market') return 'market-aware product operator';
  return 'product operator';
}

function nextStepFor(item: DailyBroadInsight) {
  if (item.annotation.buyerIntentScore >= 0.5) {
    return 'Create a small offer or comparison page and validate whether the buyer intent repeats tomorrow.';
  }
  if (item.annotation.actionabilityScore >= 0.67) {
    return 'Convert the repeated requirement into a one-page spec with acceptance criteria and a manual validation path.';
  }
  if (item.annotation.painScore >= 0.34) {
    return 'Collect two more examples of the pain and identify the current workaround before building.';
  }
  return 'Keep watching until the requirement repeats with stronger pain, buyer intent, or implementation detail.';
}

function validationArtifactFor(item: DailyBroadInsight) {
  if (item.annotation.buyerIntentScore >= 0.5) return 'offer/comparison page';
  if (item.annotation.actionabilityScore >= 0.67) return 'one-page requirement spec';
  if (item.annotation.painScore >= 0.34) return 'pain teardown with current workaround';
  return 'watch note with repeat evidence';
}

function acceptanceCriteriaFor(item: DailyBroadInsight) {
  const criteria = [
    `Cites ${Math.max(2, Math.min(item.sourceCount, 5))} source item(s) behind the requirement.`,
    `States the target user, current pain, and current workaround in one screen.`,
    `Defines one manual validation step that can be completed within 48 hours.`,
  ];
  if (item.annotation.buyerIntentScore >= 0.25)
    criteria.push('Includes an explicit price/alternative/comparison check.');
  if (item.annotation.actionabilityScore >= 0.34)
    criteria.push('Includes clear acceptance criteria for the smallest shippable version.');
  return criteria;
}

function scoreFor(item: DailyBroadInsight) {
  const score = scoreBreakdownFor(item).reduce((sum, part) => sum + part.contribution, 0);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function scoreBreakdownFor(item: DailyBroadInsight): DailyRequirementItem['scoreBreakdown'] {
  const annotation = item.annotation;
  return [
    {
      label: 'actionability',
      value: annotation.actionabilityScore,
      contribution: Math.round(annotation.actionabilityScore * 34),
      max: 34,
    },
    {
      label: 'buyer-intent',
      value: annotation.buyerIntentScore,
      contribution: Math.round(annotation.buyerIntentScore * 28),
      max: 28,
    },
    {
      label: 'pain',
      value: annotation.painScore,
      contribution: Math.round(annotation.painScore * 18),
      max: 18,
    },
    {
      label: 'quality',
      value: item.qualityScore,
      contribution: Math.round(item.qualityScore * 0.16),
      max: 16,
    },
    {
      label: 'repetition',
      value: item.repeatedSignalCount,
      contribution: Math.min(item.repeatedSignalCount, 5) * 2,
      max: 10,
    },
  ];
}

export function buildDailyRequirementQueue(
  insights: DailyBroadInsight[],
  limit = 12,
  products: PersonalProductProfile[] = []
): DailyRequirementItem[] {
  return insights
    .map<DailyRequirementItem | null>((item) => {
      const score = scoreFor(item);
      const suggestedBuild = suggestedBuildFor(item);
      const scoreBreakdown = scoreBreakdownFor(item);
      const fleetTargets = fleetTargetsFor(item, products);
      const fleetTarget = fleetTargets[0] ?? null;
      const priority = priorityFor(score);
      const whyNow = `${item.sourceLabel} produced a ${item.annotation.signalLayer.replaceAll('-', ' ')} signal with ${item.sourceCount} underlying item(s), ${item.repeatedSignalCount} repeated product cue(s), and ${item.annotation.domains.join('/') || 'no'} domain tag(s).`;
      const nextStep = nextStepFor(item);
      const acceptanceCriteria = acceptanceCriteriaFor(item);
      const taskDraft = taskDraftFor({
        item,
        score,
        priority,
        target: fleetTarget,
        whyNow,
        nextStep,
        acceptanceCriteria,
      });
      if (!passesDailyRequirementGate({ item, score, fleetTarget })) return null;
      return {
        id: `requirement-${item.id}`,
        title: item.title,
        summary: item.summary,
        href: item.href,
        sourceLabel: item.sourceLabel,
        contentCategory: item.contentCategory,
        signalLayer: item.annotation.signalLayer,
        domains: item.annotation.domains,
        intent: item.intent,
        sentiment: item.sentiment,
        priority,
        score,
        painScore: item.annotation.painScore,
        buyerIntentScore: item.annotation.buyerIntentScore,
        actionabilityScore: item.annotation.actionabilityScore,
        qualityScore: item.qualityScore,
        scoreBreakdown,
        fleetTarget,
        alternativeFleetTargets: fleetTargets.slice(1),
        taskDraft,
        sourceCount: item.sourceCount,
        repeatedSignalCount: item.repeatedSignalCount,
        suggestedBuild,
        whyNow,
        nextStep,
        userStory: `As a ${userLabelFor(item)}, I need ${item.title.toLowerCase()} so I can decide what to change or validate next.`,
        acceptanceCriteria,
        validationArtifact: validationArtifactFor(item),
        smallestTest: `Publish a ${validationArtifactFor(item)} for this requirement and check whether the same pain repeats in the next source refresh.`,
      };
    })
    .filter((item): item is DailyRequirementItem => item !== null)
    .sort(
      (a, b) =>
        b.score - a.score || b.qualityScore - a.qualityScore || a.title.localeCompare(b.title)
    )
    .slice(0, limit);
}
