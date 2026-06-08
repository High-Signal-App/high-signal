import type { IdeaFlowEvidence, ProductOpportunity, ProductSignalLayer } from "./idea-intelligence";

export type ProductStage = "active" | "exploratory" | "watch";
export type PersonalActionKind = "build" | "change" | "watch" | "pause";
export type PersonalFeedbackLabel = "useful" | "obvious" | "wrong" | "build" | "ignore";
export type PersonalDecisionStatus = "accepted" | "deferred" | "rejected" | "done";
export type PersonalTaskSyncStatus = "pending" | "created" | "failed" | "skipped";

export interface PersonalProductProfile {
  slug: string;
  name: string;
  description: string;
  stage: ProductStage;
  focus: string;
  terms: string[];
  opportunitySlugs?: string[];
  defaultAction: string;
}

export interface PersonalProductRecommendation {
  id: string;
  productSlug: string;
  productName: string;
  action: PersonalActionKind;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  whyNow: string;
  suggestedChange: string;
  nextStep: string;
  opportunityTitle: string;
  signalLayer: ProductSignalLayer;
  evidence: IdeaFlowEvidence[];
  sourceDiversity: number;
  uniqueEvidenceUrls: number;
  duplicateEvidenceUrls: number;
  score: number;
  feedbackAdjustment: number;
  decisionStatus?: PersonalDecisionStatus;
}

export interface PersonalRecommendationFeedback {
  recommendationId: string;
  productSlug: string;
  opportunityId: string;
  action: PersonalActionKind;
  label: PersonalFeedbackLabel;
  note?: string;
  createdAt: string;
}

export interface PersonalRecommendationDecision {
  recommendationId: string;
  productSlug: string;
  opportunityId: string;
  action: PersonalActionKind;
  status: PersonalDecisionStatus;
  note?: string;
  createdAt: string;
}

export interface PersonalActionTask {
  id: string;
  recommendationId: string;
  productSlug: string;
  productName: string;
  title: string;
  status: "todo" | "later" | "rejected" | "done";
  priority: PersonalProductRecommendation["priority"];
  action: PersonalActionKind;
  rationale: string;
  nextStep: string;
  acceptanceCriteria: string[];
  evidenceUrls: string[];
  saasMakerProjectSlug: string;
  syncStatus: PersonalTaskSyncStatus;
  syncedTaskId?: string;
  syncedAt?: string;
}

export interface PersonalTaskSyncRecord {
  recommendationId: string;
  taskId: string;
  status: PersonalTaskSyncStatus;
  externalTaskId?: string;
  externalTaskTitle?: string;
  error?: string;
  createdAt: string;
}

export interface PersonalBriefRecommendationSnapshot {
  id: string;
  action: PersonalActionKind;
  priority: PersonalProductRecommendation["priority"];
  score: number;
  decisionStatus?: PersonalDecisionStatus;
}

export interface PersonalBriefSnapshot {
  generatedAt: string;
  latestEvidenceAt: string | null;
  recommendations: PersonalBriefRecommendationSnapshot[];
  changeSummary?: PersonalBriefChangeSummary;
  complaintClusters?: PersonalComplaintCluster[];
}

export interface PersonalBriefChangeSummary {
  previousGeneratedAt: string | null;
  newRecommendations: PersonalBriefRecommendationSnapshot[];
  removedRecommendationIds: string[];
  actionChanged: Array<{
    id: string;
    before: PersonalActionKind;
    after: PersonalActionKind;
  }>;
  priorityChanged: Array<{
    id: string;
    before: PersonalProductRecommendation["priority"];
    after: PersonalProductRecommendation["priority"];
  }>;
  scoreMoved: Array<{
    id: string;
    before: number;
    after: number;
  }>;
}

export interface PersonalComplaintCluster {
  id: string;
  title: string;
  confidence: "low" | "medium" | "high";
  sourceCount: number;
  repeatedSignalCount: number;
  evidenceIds: string[];
  sourceUrls: string[];
  sampleTitles: string[];
  productImplication: string;
}

export interface PersonalBriefFreshness {
  latestEvidenceAt: string | null;
  evidenceAgeDays: number | null;
  staleEvidenceCount: number;
  staleAcceptedDecisionCount: number;
  noisyEvidenceCount: number;
  thinEvidenceCount: number;
  duplicateEvidenceCount: number;
  warnings: string[];
}

export interface PersonalInsightLaneScore {
  id: string;
  title: string;
  score: number;
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
  uniqueEvidenceUrls: number;
  sourceDiversity: number;
  topRecommendationIds: string[];
  whyNow: string;
  nextStep: string;
}

export interface PersonalBriefQualityGate {
  status: "ready" | "thin-day" | "blocked";
  score: number;
  uniqueEvidenceUrls: number;
  sourceFamilies: number;
  highConfidenceDuplicateSignals: number;
  reasons: string[];
}

export interface PersonalUsefulnessAudit {
  score: number;
  readiness: "rough" | "usable" | "strong" | "personal-command";
  strengths: string[];
  gaps: string[];
}

export interface PersonalReelBrief {
  id: string;
  recommendationId: string;
  productSlug: string;
  productName: string;
  title: string;
  hook: string;
  humanTension: string;
  proofBeat: string;
  visualBeats: string[];
  caption: string;
  cta: string;
  claimBoundary: string;
  evidenceUrls: string[];
}

export interface PersonalCommandBrief {
  generatedAt: string;
  productsTracked: number;
  evidenceBreakdown: {
    worldChange: number;
    appComplaint: number;
    marketWatch: number;
  };
  recommendations: PersonalProductRecommendation[];
  topBuilds: PersonalProductRecommendation[];
  watchItems: PersonalProductRecommendation[];
  actionTasks: PersonalActionTask[];
  operatingQuestions: string[];
  feedbackCount: number;
  decisionCount: number;
  freshness: PersonalBriefFreshness;
  changeSummary: PersonalBriefChangeSummary;
  complaintClusters: PersonalComplaintCluster[];
  laneScores: PersonalInsightLaneScore[];
  qualityGate: PersonalBriefQualityGate;
  reelBriefs: PersonalReelBrief[];
  usefulnessAudit: PersonalUsefulnessAudit;
}

const INSIGHT_LANE_DEFS = [
  {
    id: "ai-workflow-reliability",
    title: "AI workflow reliability",
    opportunityIds: ["workflow-observability", "developer-workflow-friction"],
    terms: ["workflow", "observability", "trace", "routing", "cost", "failure", "debug", "eval"],
    nextStep: "Collect app-builder complaints and ship a source-linked teardown before building tooling.",
  },
  {
    id: "agent-readiness",
    title: "Agent-readiness",
    opportunityIds: ["agent-evaluation"],
    terms: ["agent", "recommend", "visibility", "ai search", "proof", "trust"],
    nextStep: "Run owned-product audits and convert every missing proof area into a page or task.",
  },
  {
    id: "complaint-to-spec",
    title: "Complaint-to-spec",
    opportunityIds: ["complaint-to-spec"],
    terms: ["complaint", "pain", "manual", "missing", "friction", "validation"],
    nextStep: "Promote only repeated complaints with a named user, workaround, and validation artifact.",
  },
  {
    id: "source-provenance",
    title: "Source provenance",
    opportunityIds: ["source-provenance"],
    terms: ["citation", "source", "provenance", "hallucination", "retrieval", "evidence"],
    nextStep: "Turn citation/provenance failures into source-linked UI requirements.",
  },
  {
    id: "launch-distribution-friction",
    title: "Launch and distribution friction",
    opportunityIds: ["launch-distribution"],
    terms: ["launch", "distribution", "growth", "pricing", "onboarding", "users"],
    nextStep: "Convert repeated distribution pain into one manual validation artifact.",
  },
];

const COMPLAINT_CLUSTER_DEFS = [
  {
    id: "agentic-launch-trust",
    title: "Launch trust and agent-readiness anxiety",
    terms: ["trust", "landing page", "pay", "agent", "ai search", "visibility", "recommend", "compare"],
    productImplication:
      "Turn vague launch/visibility anxiety into agent-readiness and proof-page tasks before building new acquisition surfaces.",
  },
  {
    id: "validation-before-build",
    title: "Validation before build",
    terms: ["validate", "validation", "customer", "problem", "idea", "overbuilding", "show real users", "first customers"],
    productImplication:
      "Promote only complaints with a named user, current workaround, and smallest manual validation artifact.",
  },
  {
    id: "workflow-reliability",
    title: "AI workflow reliability",
    terms: ["workflow", "bug", "failure", "stable", "trace", "eval", "agentic harness", "routing", "cost"],
    productImplication:
      "Convert repeated reliability issues into source-linked teardowns before investing in observability tooling.",
  },
  {
    id: "local-control-friction",
    title: "Local control friction",
    terms: ["local", "self hosted", "self-hosted", "privacy", "control", "dashboard", "replacement", "open source"],
    productImplication:
      "Separate paid product pull from implementation preference by tracking whether users describe budget or recurring workflow pain.",
  },
  {
    id: "distribution-and-collaboration",
    title: "Distribution and collaboration bottlenecks",
    terms: ["distribution", "collaborator", "cofounder", "linkedin", "founders", "customers", "revenue"],
    productImplication:
      "Treat distribution/collaboration complaints as product requirements only when they repeat across communities or show payment intent.",
  },
];

function termHits(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

function canonicalEvidenceHref(href: string) {
  if (!href || href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^ref$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return href.trim();
  }
}

function evidenceFamily(item: IdeaFlowEvidence) {
  if (item.source !== "news") return item.source;
  if (item.href.startsWith("/")) return item.source;
  try {
    return new URL(item.href).hostname.replace(/^www\./, "");
  } catch {
    return item.source;
  }
}

function uniqueEvidenceUrlCount(evidence: IdeaFlowEvidence[]) {
  return new Set(evidence.map((item) => item.canonicalHref ?? canonicalEvidenceHref(item.href)).filter(Boolean)).size;
}

function duplicateEvidenceUrlCount(evidence: IdeaFlowEvidence[]) {
  const urls = evidence.map((item) => item.canonicalHref ?? canonicalEvidenceHref(item.href)).filter(Boolean);
  return Math.max(0, urls.length - new Set(urls).size);
}

function productOpportunityText(opportunity: ProductOpportunity) {
  return [
    opportunity.title,
    opportunity.worldChange,
    opportunity.productToBuild,
    opportunity.targetUser,
    opportunity.whyNow,
    opportunity.complaintPattern,
    opportunity.nextStep,
    ...opportunity.evidence.flatMap((item) => [item.title, item.summary]),
  ].join(" ");
}

function priorityFrom(
  score: number,
  action: PersonalActionKind,
): PersonalProductRecommendation["priority"] {
  if (action === "build" && score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function priorityRank(priority: PersonalProductRecommendation["priority"]) {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  return 3;
}

function scoreCapFor(opportunity: ProductOpportunity) {
  if (opportunity.horizon === "now") return 100;
  if (opportunity.horizon === "next") return 84;
  return 54;
}

function productFitCap(product: PersonalProductProfile, opportunity: ProductOpportunity) {
  const explicitlyFits = product.opportunitySlugs?.includes(opportunity.id) ?? false;
  if (opportunity.id === "agent-evaluation" && product.slug !== "high-signal") {
    return product.stage === "watch" ? 64 : 74;
  }
  if (opportunity.id === "workflow-observability" && product.slug !== "high-signal") {
    return product.stage === "watch" ? 64 : 74;
  }
  if (opportunity.id === "complaint-to-spec" && product.slug !== "high-signal") {
    return product.stage === "watch" ? 64 : 78;
  }
  if (opportunity.id === "local-control" && product.slug !== "high-signal") {
    return product.stage === "watch" ? 64 : 74;
  }
  if (
    ["developer-workflow-friction", "launch-distribution", "source-provenance"].includes(opportunity.id) &&
    product.slug !== "high-signal"
  ) {
    return product.stage === "watch" ? 64 : 74;
  }
  if (
    ["small-business-ops", "public-consumer-shift", "regional-constraint-watch"].includes(opportunity.id) &&
    product.slug !== "high-signal"
  ) {
    return product.stage === "watch" ? 54 : 70;
  }
  if (opportunity.signalLayer === "market-watch" && product.slug !== "high-signal") return 44;
  if (!explicitlyFits && product.stage === "watch") return 44;
  return 100;
}

function feedbackAdjustmentFor(input: {
  productSlug: string;
  opportunityId: string;
  action: PersonalActionKind;
  feedback: PersonalRecommendationFeedback[];
}) {
  return input.feedback.reduce((sum, item) => {
    const productMatch = item.productSlug === input.productSlug;
    const opportunityMatch = item.opportunityId === input.opportunityId;
    const actionMatch = item.action === input.action;
    if (!productMatch && !opportunityMatch) return sum;
    const strength = productMatch && opportunityMatch ? 1 : 0.35;
    const actionStrength = actionMatch ? 1 : 0.5;
    const weight = strength * actionStrength;
    if (item.label === "build") return sum + 24 * weight;
    if (item.label === "useful") return sum + 14 * weight;
    if (item.label === "obvious") return sum - 8 * weight;
    if (item.label === "ignore") return sum - 18 * weight;
    if (item.label === "wrong") return sum - 32 * weight;
    return sum;
  }, 0);
}

function actionFrom(product: PersonalProductProfile, opportunity: ProductOpportunity, score: number): PersonalActionKind {
  if (score >= 75 && product.stage === "active" && opportunity.horizon === "now") return "build";
  if (score >= 55 && product.stage !== "watch") return "change";
  if (score >= 30) return "watch";
  return "pause";
}

function usefulnessAuditFrom(input: {
  recommendations: PersonalProductRecommendation[];
  actionTasks: PersonalActionTask[];
  freshness: PersonalBriefFreshness;
  changeSummary: PersonalBriefChangeSummary;
  complaintClusters: PersonalComplaintCluster[];
  reelBriefs: PersonalReelBrief[];
  evidenceBreakdown: PersonalCommandBrief["evidenceBreakdown"];
  qualityGate: PersonalBriefQualityGate;
}): PersonalUsefulnessAudit {
  const acceptedTodoTasks = input.actionTasks.filter((task) => task.status === "todo");
  const syncedAcceptedTasks = acceptedTodoTasks.filter((task) => task.syncStatus === "created");
  const highSignalTopCount = input.recommendations.filter(
    (item) => item.productSlug === "high-signal" && (item.action === "build" || item.action === "change"),
  ).length;
  const nonHighSignalCriticalBuilds = input.recommendations.filter(
    (item) => item.productSlug !== "high-signal" && item.action === "build" && item.priority === "critical",
  ).length;
  const highConfidenceClusters = input.complaintClusters.filter((cluster) => cluster.confidence !== "low").length;
  const evidenceBackedReelBriefs = input.reelBriefs.filter((brief) => brief.evidenceUrls.length >= 2).length;
  const hasRecentEvidence = input.freshness.evidenceAgeDays !== null && input.freshness.evidenceAgeDays <= 1;
  const hasLayerCoverage =
    input.evidenceBreakdown.worldChange > 0 &&
    input.evidenceBreakdown.appComplaint > 0 &&
    input.evidenceBreakdown.marketWatch > 0;
  const hasChangeTracking =
    Boolean(input.changeSummary.previousGeneratedAt) ||
    input.changeSummary.newRecommendations.length > 0 ||
    input.changeSummary.actionChanged.length > 0 ||
    input.changeSummary.scoreMoved.length > 0;
  const qualityGateReady = input.qualityGate.status === "ready";

  const score = Math.max(
    0,
    (
    (hasRecentEvidence ? 15 : 0) +
    (hasLayerCoverage ? 15 : 0) +
    Math.min(20, highSignalTopCount * 7) +
    Math.min(15, acceptedTodoTasks.length * 5) +
    (acceptedTodoTasks.length > 0 && syncedAcceptedTasks.length === acceptedTodoTasks.length ? 10 : 0) +
    (hasChangeTracking ? 10 : 0) +
    Math.min(10, highConfidenceClusters * 6) +
    (evidenceBackedReelBriefs >= 3 ? 10 : 0) +
      (input.freshness.noisyEvidenceCount <= 2 ? 5 : 0) +
      (qualityGateReady ? 10 : 0)
    ) - nonHighSignalCriticalBuilds * 8 - (qualityGateReady ? 0 : 10),
  );

  const gaps = [
    !hasRecentEvidence ? "Refresh evidence before using the brief for today's build decisions." : null,
    !hasLayerCoverage ? "Keep world-change, app-complaint, and market-watch evidence all populated." : null,
    highSignalTopCount < 2 ? "High Signal needs at least two top build/change actions it clearly owns." : null,
    nonHighSignalCriticalBuilds > 0
      ? "Some non-High Signal products are still being treated as critical builders of umbrella intelligence layers."
      : null,
    acceptedTodoTasks.length === 0 ? "No accepted action queue exists yet." : null,
    acceptedTodoTasks.length > 0 && syncedAcceptedTasks.length < acceptedTodoTasks.length
      ? "Some accepted actions are not synced into the durable task system."
      : null,
    !hasChangeTracking ? "No changed-since-last-brief baseline exists yet." : null,
    highConfidenceClusters === 0 ? "Complaint clusters are still low confidence; require repeated evidence before building." : null,
    evidenceBackedReelBriefs < 3 ? "Need at least three evidence-backed reel briefs tied to High Signal recommendations." : null,
    input.freshness.noisyEvidenceCount > 2 ? "Too much noisy community evidence is entering the brief." : null,
    !qualityGateReady ? `Daily quality gate is ${input.qualityGate.status}: ${input.qualityGate.reasons.join(" / ")}` : null,
  ].filter((item): item is string => Boolean(item));

  const strengths = [
    hasRecentEvidence ? "Fresh evidence is available." : null,
    hasLayerCoverage ? "World, app-complaint, and market context are all represented." : null,
    highSignalTopCount >= 2 ? "High Signal owns multiple top recommendations." : null,
    acceptedTodoTasks.length > 0 ? "Accepted actions exist." : null,
    acceptedTodoTasks.length > 0 && syncedAcceptedTasks.length === acceptedTodoTasks.length
      ? "Accepted actions are synced into SaaS Maker tasks."
      : null,
    hasChangeTracking ? "Changed-since-last-brief tracking is active." : null,
    highConfidenceClusters > 0 ? "At least one complaint cluster has repeated evidence." : null,
    evidenceBackedReelBriefs >= 3 ? "Evidence-backed reel briefs translate top recommendations into human-attention hooks." : null,
    qualityGateReady ? "Daily quality gate has enough unique evidence and source-family coverage." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    score: Math.min(100, score),
    readiness:
      score >= 92
        ? "personal-command"
        : score >= 80
          ? "strong"
          : score >= 65
            ? "usable"
            : "rough",
    strengths,
    gaps,
  };
}

function suggestionFor(product: PersonalProductProfile, opportunity: ProductOpportunity, action: PersonalActionKind) {
  if (action === "build") {
    return `Build a focused ${opportunity.title.toLowerCase()} slice inside ${product.name}, not a new broad product.`;
  }
  if (action === "change") {
    return `Change ${product.name}'s next iteration to reflect this opportunity: ${opportunity.productToBuild}`;
  }
  if (action === "watch") {
    return `Keep ${product.name} on watch until the complaint pattern repeats with stronger evidence.`;
  }
  return `Do not invest in ${product.name} from this signal yet; the match is too weak.`;
}

function latestDecisions(decisions: PersonalRecommendationDecision[]) {
  return new Map(
    decisions
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => [item.recommendationId, item]),
  );
}

function taskStatusFromDecision(status: PersonalDecisionStatus): PersonalActionTask["status"] {
  if (status === "accepted") return "todo";
  if (status === "deferred") return "later";
  if (status === "done") return "done";
  return "rejected";
}

function clusterTermHits(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

function buildComplaintClusters(evidence: IdeaFlowEvidence[]): PersonalComplaintCluster[] {
  const communityEvidence = evidence.filter(
    (item) => item.source === "community" && item.quality?.genericRisk !== "high",
  );
  return COMPLAINT_CLUSTER_DEFS.map((definition) => {
    const matched = communityEvidence
      .map((item) => ({
        item,
        hits: clusterTermHits(`${item.title} ${item.summary}`, definition.terms),
      }))
      .filter(({ hits }) => hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 6)
      .map(({ item }) => item);
    const repeatedSignalCount = matched.reduce((sum, item) => sum + (item.quality?.repeatedSignalCount ?? 1), 0);
    const sourceCount = matched.reduce((sum, item) => sum + (item.quality?.sourceCount ?? 1), 0);
    const confidence: PersonalComplaintCluster["confidence"] =
      matched.length >= 3 && repeatedSignalCount >= 8
        ? "high"
        : matched.length >= 2 && repeatedSignalCount >= 4
          ? "medium"
          : "low";
    return {
      id: definition.id,
      title: definition.title,
      confidence,
      sourceCount,
      repeatedSignalCount,
      evidenceIds: matched.map((item) => item.id),
      sourceUrls: Array.from(new Set(matched.map((item) => item.href))),
      sampleTitles: matched.map((item) => item.title).slice(0, 3),
      productImplication: definition.productImplication,
    };
  })
    .filter((cluster) => cluster.evidenceIds.length > 0)
    .sort((a, b) => {
      const confidenceRank = { high: 0, medium: 1, low: 2 };
      return (
        confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
        b.repeatedSignalCount - a.repeatedSignalCount ||
        b.sourceCount - a.sourceCount
      );
    })
    .slice(0, 5);
}

function compactText(value: string, maxLength = 170) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function opportunityIdFromRecommendation(item: PersonalProductRecommendation) {
  return item.id.startsWith(`${item.productSlug}-`) ? item.id.slice(item.productSlug.length + 1) : item.id;
}

function uniqueEvidenceUrls(item: PersonalProductRecommendation) {
  return Array.from(new Set(item.evidence.map((evidence) => evidence.canonicalHref ?? canonicalEvidenceHref(evidence.href)).filter(Boolean)));
}

function reelHookFor(item: PersonalProductRecommendation) {
  const opportunityId = opportunityIdFromRecommendation(item);
  if (opportunityId === "agent-evaluation") {
    return "Your reel gets attention. The agent decides if you are worth trusting.";
  }
  if (opportunityId === "workflow-observability") {
    return "The AI app did not fail because the model was bad. It failed because nobody could see the workflow.";
  }
  if (opportunityId === "market-regime-watch") {
    return "A stock move is not a product idea. But it can tell you when the story changed.";
  }
  if (opportunityId === "complaint-to-spec") {
    return "The feature request usually appears as a complaint before it looks like a market.";
  }
  if (opportunityId === "local-control") {
    return "People do not always want more AI. Sometimes they want control.";
  }
  return `${item.opportunityTitle} matters only if it changes what you build next.`;
}

function reelCtaFor(item: PersonalProductRecommendation) {
  const opportunityId = opportunityIdFromRecommendation(item);
  if (opportunityId === "agent-evaluation") return "Run the audit, then fix the first missing proof surface.";
  if (opportunityId === "market-regime-watch") return "Use this as positioning context, not a stock recommendation.";
  if (opportunityId === "complaint-to-spec") return "Turn the repeated complaint into one validation artifact.";
  return item.nextStep;
}

function buildPersonalReelBriefs(recommendations: PersonalProductRecommendation[]): PersonalReelBrief[] {
  return recommendations
    .filter(
      (item) =>
        item.productSlug === "high-signal" &&
        (item.action === "build" || item.action === "change") &&
        uniqueEvidenceUrls(item).length >= 2,
    )
    .slice(0, 5)
    .map((item) => {
      const firstEvidence = item.evidence[0];
      const secondEvidence = item.evidence[1] ?? firstEvidence;
      const evidenceUrls = uniqueEvidenceUrls(item);
      const proofBeat = firstEvidence
        ? `${firstEvidence.title}: ${compactText(firstEvidence.summary, 150)}`
        : compactText(item.whyNow, 150);
      return {
        id: `reel-${item.id}`,
        recommendationId: item.id,
        productSlug: item.productSlug,
        productName: item.productName,
        title: `${item.productName}: ${item.opportunityTitle}`,
        hook: reelHookFor(item),
        humanTension: compactText(item.whyNow),
        proofBeat,
        visualBeats: [
          "Open on the uncomfortable decision the builder or buyer is trying to make.",
          `Show the world shift: ${compactText(item.whyNow, 120)}`,
          `Cut to proof: ${compactText(firstEvidence?.title ?? item.opportunityTitle, 100)}`,
          `Add second receipt: ${compactText(secondEvidence?.title ?? item.nextStep, 100)}`,
          `Close with the exact next action: ${compactText(reelCtaFor(item), 120)}`,
        ],
        caption: compactText(`${item.opportunityTitle}: ${item.suggestedChange}`, 220),
        cta: reelCtaFor(item),
        claimBoundary:
          item.signalLayer === "market-watch"
            ? "Treat this as product and positioning context, not financial advice or a stock call."
            : "Only use claims backed by the linked evidence; do not turn a weak signal into certainty.",
        evidenceUrls,
      };
    });
}

function acceptanceCriteriaFor(item: PersonalProductRecommendation) {
  if (item.action === "build") {
    return [
      "A focused slice exists in the product, not a broad platform rewrite.",
      "The slice is backed by at least two source-linked evidence items.",
      "The next decision is explicit: keep building, test manually, watch, or kill.",
    ];
  }
  if (item.action === "change") {
    return [
      "The next product iteration reflects the cited world change or complaint pattern.",
      "The change has a one-week validation artifact or user-facing proof point.",
      "The result updates the personal feedback ledger as useful, obvious, wrong, build, or ignore.",
    ];
  }
  return [
    "The product stays on watch until stronger evidence appears.",
    "A trigger is written down for when the recommendation should be revisited.",
    "No build time is spent before the trigger fires.",
  ];
}

function actionTaskFrom(
  item: PersonalProductRecommendation,
  decision: PersonalRecommendationDecision,
  syncRecord?: PersonalTaskSyncRecord,
): PersonalActionTask {
  const action = decision.action;
  return {
    id: `personal-task-${item.id}`,
    recommendationId: item.id,
    productSlug: item.productSlug,
    productName: item.productName,
    title: `[High Signal] ${action.toUpperCase()} ${item.productName}: ${item.opportunityTitle}`,
    status: taskStatusFromDecision(decision.status),
    priority: item.priority,
    action,
    rationale: item.whyNow,
    nextStep: decision.note ? `${item.nextStep} Note: ${decision.note}` : item.nextStep,
    acceptanceCriteria: acceptanceCriteriaFor({ ...item, action }),
    evidenceUrls: Array.from(new Set(item.evidence.map((evidence) => evidence.href))),
    saasMakerProjectSlug: item.productSlug,
    syncStatus: syncRecord?.status ?? "pending",
    syncedTaskId: syncRecord?.externalTaskId,
    syncedAt: syncRecord?.createdAt,
  };
}

function ageDays(now: Date, timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function freshnessFor(input: {
  now: Date;
  evidence: IdeaFlowEvidence[];
  decisions: PersonalRecommendationDecision[];
}): PersonalBriefFreshness {
  const evidenceAges = input.evidence
    .map((item) => ({ item, age: ageDays(input.now, item.observedAt) }))
    .filter((item): item is { item: IdeaFlowEvidence; age: number } => item.age !== null);
  const latestEvidence = evidenceAges
    .slice()
    .sort((a, b) => new Date(b.item.observedAt).getTime() - new Date(a.item.observedAt).getTime())[0];
  const acceptedDecisions = input.decisions.filter((item) => item.status === "accepted");
  const staleAcceptedDecisionCount = acceptedDecisions.filter((item) => {
    const age = ageDays(input.now, item.createdAt);
    return age !== null && age >= 7;
  }).length;
  const staleEvidenceCount = evidenceAges.filter((item) => item.age >= 7).length;
  const noisyEvidenceCount = input.evidence.filter((item) => item.quality?.genericRisk === "high").length;
  const thinEvidenceCount = input.evidence.filter(
    (item) => item.quality && item.quality.repeatedSignalCount < 2,
  ).length;
  const duplicateEvidenceCount = duplicateEvidenceUrlCount(input.evidence);
  const evidenceAgeDays = latestEvidence?.age ?? null;
  const warnings = [
    evidenceAgeDays === null ? "No dated evidence is available for this brief." : null,
    evidenceAgeDays !== null && evidenceAgeDays >= 3 ? "Latest evidence is more than three days old." : null,
    staleEvidenceCount > 0 ? `${staleEvidenceCount} evidence item(s) are at least seven days old.` : null,
    staleAcceptedDecisionCount > 0 ? `${staleAcceptedDecisionCount} accepted decision(s) need review.` : null,
    noisyEvidenceCount > 0 ? `${noisyEvidenceCount} evidence item(s) were filtered or downranked for generic/noisy community patterns.` : null,
    thinEvidenceCount > 0 ? `${thinEvidenceCount} evidence item(s) have weak repeated-product-intent support.` : null,
    duplicateEvidenceCount > 0 ? `${duplicateEvidenceCount} evidence item(s) repeat an already-counted URL.` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    latestEvidenceAt: latestEvidence?.item.observedAt ?? null,
    evidenceAgeDays,
    staleEvidenceCount,
    staleAcceptedDecisionCount,
    noisyEvidenceCount,
    thinEvidenceCount,
    duplicateEvidenceCount,
    warnings,
  };
}

function qualityGateFor(evidence: IdeaFlowEvidence[], recommendations: PersonalProductRecommendation[]): PersonalBriefQualityGate {
  const uniqueEvidenceUrls = uniqueEvidenceUrlCount(evidence);
  const sourceFamilies = new Set(evidence.map(evidenceFamily)).size;
  const highConfidenceDuplicateSignals = recommendations.filter(
    (item) => item.priority === "critical" && item.duplicateEvidenceUrls > 0 && item.uniqueEvidenceUrls < 2,
  ).length;
  const reasons = [
    uniqueEvidenceUrls < 12 ? `unique evidence URLs below target (${uniqueEvidenceUrls}/12)` : null,
    sourceFamilies < 4 ? `source families below target (${sourceFamilies}/4)` : null,
    highConfidenceDuplicateSignals > 0
      ? `${highConfidenceDuplicateSignals} high-confidence recommendation(s) rely on duplicate evidence`
      : null,
  ].filter((item): item is string => Boolean(item));
  const score = Math.max(
    0,
    Math.min(100, uniqueEvidenceUrls * 4 + sourceFamilies * 10 - highConfidenceDuplicateSignals * 18),
  );
  return {
    status:
      highConfidenceDuplicateSignals > 0 || uniqueEvidenceUrls < 4 || sourceFamilies < 2
        ? "blocked"
        : reasons.length > 0
          ? "thin-day"
          : "ready",
    score,
    uniqueEvidenceUrls,
    sourceFamilies,
    highConfidenceDuplicateSignals,
    reasons: reasons.length ? reasons : ["quality gate passed"],
  };
}

function laneScoresFor(recommendations: PersonalProductRecommendation[]): PersonalInsightLaneScore[] {
  return INSIGHT_LANE_DEFS.map((lane) => {
    const matching = recommendations.filter((item) => {
      const opportunityId = opportunityIdFromRecommendation(item);
      const text = `${item.title} ${item.whyNow} ${item.suggestedChange} ${item.evidence
        .map((evidence) => `${evidence.title} ${evidence.summary}`)
        .join(" ")}`;
      return lane.opportunityIds.includes(opportunityId) || termHits(text, lane.terms) > 0;
    });
    const evidence = matching.flatMap((item) => item.evidence);
    const uniqueUrls = uniqueEvidenceUrlCount(evidence);
    const families = new Set(evidence.map(evidenceFamily)).size;
    const score = Math.max(
      0,
      Math.min(
        100,
        matching.reduce((max, item) => Math.max(max, item.score), 0) * 0.55 +
          Math.min(uniqueUrls, 6) * 7 +
          Math.min(families, 4) * 6,
      ),
    );
    const confidence: PersonalInsightLaneScore["confidence"] =
      uniqueUrls >= 4 && families >= 2 ? "high" : uniqueUrls >= 2 ? "medium" : "low";
    return {
      id: lane.id,
      title: lane.title,
      score: Math.round(score),
      confidence,
      evidenceCount: evidence.length,
      uniqueEvidenceUrls: uniqueUrls,
      sourceDiversity: families,
      topRecommendationIds: matching
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((item) => item.id),
      whyNow: matching[0]?.whyNow ?? "No strong matching recommendation yet.",
      nextStep: lane.nextStep,
    };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function snapshotFromPersonalBrief(brief: PersonalCommandBrief): PersonalBriefSnapshot {
  return {
    generatedAt: brief.generatedAt,
    latestEvidenceAt: brief.freshness.latestEvidenceAt,
    changeSummary: brief.changeSummary,
    complaintClusters: brief.complaintClusters,
    recommendations: brief.recommendations.map((item) => ({
      id: item.id,
      action: item.action,
      priority: item.priority,
      score: item.score,
      decisionStatus: item.decisionStatus,
    })),
  };
}

function changeSummaryFrom(input: {
  recommendations: PersonalProductRecommendation[];
  previousSnapshot?: PersonalBriefSnapshot | null;
}): PersonalBriefChangeSummary {
  const previous = input.previousSnapshot ?? null;
  if (!previous) {
    return {
      previousGeneratedAt: null,
      newRecommendations: input.recommendations.slice(0, 8).map((item) => ({
        id: item.id,
        action: item.action,
        priority: item.priority,
        score: item.score,
        decisionStatus: item.decisionStatus,
      })),
      removedRecommendationIds: [],
      actionChanged: [],
      priorityChanged: [],
      scoreMoved: [],
    };
  }
  const previousById = new Map(previous.recommendations.map((item) => [item.id, item]));
  const currentById = new Map(input.recommendations.map((item) => [item.id, item]));
  const newRecommendations = input.recommendations
    .filter((item) => !previousById.has(item.id))
    .map((item) => ({
      id: item.id,
      action: item.action,
      priority: item.priority,
      score: item.score,
      decisionStatus: item.decisionStatus,
    }));
  const removedRecommendationIds = previous.recommendations
    .filter((item) => !currentById.has(item.id))
    .map((item) => item.id);
  const actionChanged = input.recommendations.flatMap((item) => {
    const before = previousById.get(item.id);
    if (!before || before.action === item.action) return [];
    return [{ id: item.id, before: before.action, after: item.action }];
  });
  const priorityChanged = input.recommendations.flatMap((item) => {
    const before = previousById.get(item.id);
    if (!before || before.priority === item.priority) return [];
    return [{ id: item.id, before: before.priority, after: item.priority }];
  });
  const scoreMoved = input.recommendations
    .flatMap((item) => {
      const before = previousById.get(item.id);
      if (!before || Math.abs(before.score - item.score) < 10) return [];
      return [{ id: item.id, before: before.score, after: item.score }];
    })
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 8);
  return {
    previousGeneratedAt: previous.generatedAt,
    newRecommendations,
    removedRecommendationIds,
    actionChanged,
    priorityChanged,
    scoreMoved,
  };
}

export function buildPersonalCommandBrief(input: {
  products: PersonalProductProfile[];
  opportunities: ProductOpportunity[];
  evidence: IdeaFlowEvidence[];
  feedback?: PersonalRecommendationFeedback[];
  decisions?: PersonalRecommendationDecision[];
  taskSync?: PersonalTaskSyncRecord[];
  previousSnapshot?: PersonalBriefSnapshot | null;
  now?: Date;
}): PersonalCommandBrief {
  const now = input.now ?? new Date();
  const feedback = input.feedback ?? [];
  const decisions = input.decisions ?? [];
  const taskSync = input.taskSync ?? [];
  const decisionByRecommendation = latestDecisions(decisions);
  const syncByTask = new Map(
    taskSync
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => [item.taskId, item]),
  );
  const recommendations = input.products.flatMap((product) => {
    return input.opportunities.map((opportunity) => {
      const opportunityText = productOpportunityText(opportunity);
      const directHits = termHits(opportunityText, product.terms);
      const focusHits = termHits(`${product.description} ${product.focus}`, [
        ...opportunity.title.split(/\s+/),
        ...opportunity.productToBuild.split(/\s+/),
      ]);
      const hasExplicitFits = Boolean(product.opportunitySlugs?.length);
      const affinityBoost = product.opportunitySlugs?.includes(opportunity.id) ? 36 : 0;
      const mismatchPenalty = hasExplicitFits && !product.opportunitySlugs?.includes(opportunity.id) ? 28 : 0;
      const layerMismatchPenalty =
        opportunity.signalLayer === "market-watch" && !product.opportunitySlugs?.includes(opportunity.id) ? 80 : 0;
      const qualityWeightedEvidence = opportunity.evidence.reduce((sum, evidenceItem) => {
        if (evidenceItem.quality?.genericRisk === "medium") return sum + 0.5;
        if (evidenceItem.quality?.genericRisk === "high") return sum;
        return sum + 1;
      }, 0);
      const evidenceBoost = Math.min(qualityWeightedEvidence * 8, 24);
      const horizonBoost = opportunity.horizon === "now" ? 20 : opportunity.horizon === "next" ? 10 : 0;
      const stageBoost = product.stage === "active" ? 12 : product.stage === "exploratory" ? 6 : 0;
      const baseScore = Math.max(
        0,
        Math.min(
          100,
          directHits * 14 +
            focusHits * 4 +
            affinityBoost +
            evidenceBoost +
            horizonBoost +
            stageBoost -
            mismatchPenalty -
            layerMismatchPenalty,
        ),
      );
      const provisionalAction = actionFrom(product, opportunity, baseScore);
      const feedbackAdjustment = feedbackAdjustmentFor({
        productSlug: product.slug,
        opportunityId: opportunity.id,
        action: provisionalAction,
        feedback,
      });
      const score = Math.max(
        0,
        Math.min(scoreCapFor(opportunity), productFitCap(product, opportunity), Math.round(baseScore + feedbackAdjustment)),
      );
      const action = actionFrom(product, opportunity, score);
      const decision = decisionByRecommendation.get(`${product.slug}-${opportunity.id}`);
      const uniqueUrls = uniqueEvidenceUrlCount(opportunity.evidence);
      return {
        id: `${product.slug}-${opportunity.id}`,
        productSlug: product.slug,
        productName: product.name,
        action,
        priority: priorityFrom(score, action),
        title: `${product.name}: ${opportunity.title}`,
        whyNow: opportunity.whyNow,
        suggestedChange: suggestionFor(product, opportunity, action),
        nextStep: action === "pause" ? product.defaultAction : opportunity.nextStep,
        opportunityTitle: opportunity.title,
        signalLayer: opportunity.signalLayer,
        evidence: opportunity.evidence,
        sourceDiversity: opportunity.sourceDiversity,
        uniqueEvidenceUrls: uniqueUrls,
        duplicateEvidenceUrls: duplicateEvidenceUrlCount(opportunity.evidence),
        score,
        feedbackAdjustment: Math.round(feedbackAdjustment),
        decisionStatus: decision?.status,
      };
    });
  });

  const ranked = recommendations
    .filter((item) => item.action !== "pause")
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const topBuilds = ranked.filter((item) => item.action === "build" || item.action === "change").slice(0, 6);
  const watchItems = ranked.filter((item) => item.action === "watch").slice(0, 6);
  const actionTasks = recommendations
    .flatMap((item) => {
      const decision = decisionByRecommendation.get(item.id);
      if (!decision || decision.status === "rejected") return [];
      const taskId = `personal-task-${item.id}`;
      return [actionTaskFrom(item, decision, syncByTask.get(taskId))];
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "todo" ? -1 : 1;
      return priorityRank(a.priority) - priorityRank(b.priority);
    })
    .slice(0, 12);

  const evidenceBreakdown = {
    worldChange: input.evidence.filter((item) => item.source === "market" || item.source === "mention" || item.source === "news").length,
    appComplaint: input.evidence.filter((item) => item.source === "community").length,
    marketWatch: input.evidence.filter((item) => item.source === "market").length,
  };
  const freshness = freshnessFor({ now, evidence: input.evidence, decisions });
  const changeSummary = changeSummaryFrom({ recommendations: ranked, previousSnapshot: input.previousSnapshot });
  const complaintClusters = buildComplaintClusters(input.evidence);
  const qualityGate = qualityGateFor(input.evidence, ranked);
  const laneScores = laneScoresFor(ranked);
  const reelBriefs = buildPersonalReelBriefs(ranked);
  return {
    generatedAt: now.toISOString(),
    productsTracked: input.products.length,
    evidenceBreakdown,
    recommendations: ranked,
    topBuilds,
    watchItems,
    actionTasks,
    feedbackCount: feedback.length,
    decisionCount: decisions.length,
    freshness,
    changeSummary,
    complaintClusters,
    laneScores,
    qualityGate,
    reelBriefs,
    usefulnessAudit: usefulnessAuditFrom({
      recommendations: ranked,
      actionTasks,
      freshness,
      changeSummary,
      complaintClusters,
      reelBriefs,
      evidenceBreakdown,
      qualityGate,
    }),
    operatingQuestions: [
      "Which recommendation would change what I build this week?",
      "Which signal is generic and should be killed?",
      "Which world-level change actually changes what I build?",
      "Which market move is only context, and which one changes positioning or urgency?",
      "Which product should receive the next small validation artifact?",
      "Which existing product should be paused because no signal is pulling it?",
    ],
  };
}
