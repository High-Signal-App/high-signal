import type { PersonalComplaintCluster, PersonalReelBrief } from "./personal-usefulness";

export type ApprovedTaskId =
  | "d94ad9b8-acd9-4afb-807c-0954f5a9a5df"
  | "09cb694f-4abf-4cbe-879e-b695e9e43eba"
  | "e68a0286-6000-4a13-a86a-f7403ce5c46a";

export type ApprovedTaskTeardownMode =
  | "agent-readiness-audit"
  | "workflow-observability-teardown"
  | "complaint-to-spec-validation";

export type ApprovedTaskTeardownStatus =
  | "ready-for-manual-output"
  | "needs-source-check"
  | "blocked";

export interface ApprovedTaskTeardown {
  taskId: ApprovedTaskId;
  title: string;
  mode: ApprovedTaskTeardownMode;
  status: ApprovedTaskTeardownStatus;
  recommendationId: string;
  clusterId: string;
  clusterTitle: string;
  confidence: PersonalComplaintCluster["confidence"] | "missing";
  repeatedSignalCount: number;
  sourceCount: number;
  sampleTitles: string[];
  evidenceUrls: string[];
  humanTension: string;
  validationArtifact: string;
  teardownQuestions: string[];
  nextManualOutput: string;
  claimBoundary: string;
  generatedAt: string | null;
}

interface TaskSpec {
  taskId: ApprovedTaskId;
  title: string;
  mode: ApprovedTaskTeardownMode;
  recommendationId: string;
  clusterId: string;
  fallbackTension: string;
  validationArtifact: string;
  teardownQuestions: string[];
  nextManualOutput: string;
}

const TASK_SPECS: TaskSpec[] = [
  {
    taskId: "d94ad9b8-acd9-4afb-807c-0954f5a9a5df",
    title: "Agent-readiness audit layer",
    mode: "agent-readiness-audit",
    recommendationId: "high-signal-agent-evaluation",
    clusterId: "agentic-launch-trust",
    fallbackTension:
      "Products need public proof surfaces that agents can retrieve, compare, and cite.",
    validationArtifact:
      "Owned-product agent-readiness audit: score the product page, proof, pricing, docs, policies, reviews, comparisons, and next action.",
    teardownQuestions: [
      "Would an assistant correctly identify the buyer mission?",
      "What proof page or policy would the assistant cite?",
      "Which missing evidence task blocks a recommendation?",
    ],
    nextManualOutput:
      "Run the audit for High Signal and one owned product, then create the first missing-proof task.",
  },
  {
    taskId: "09cb694f-4abf-4cbe-879e-b695e9e43eba",
    title: "Workflow observability for AI apps",
    mode: "workflow-observability-teardown",
    recommendationId: "high-signal-workflow-observability",
    clusterId: "workflow-reliability",
    fallbackTension:
      "AI app builders need to see where a workflow failed before buying another model or framework.",
    validationArtifact:
      "Manual weekly workflow teardown: source complaint, failed workflow, missing trace, provenance gap, cost/routing signal, and smallest fix.",
    teardownQuestions: [
      "Which input, tool call, retrieval step, or handoff was invisible?",
      "What would the builder need to reproduce the failure next week?",
      "Is this observability pain repeated across at least two source types?",
    ],
    nextManualOutput:
      "Ship one source-linked weekly teardown before building instrumentation or dashboards.",
  },
  {
    taskId: "e68a0286-6000-4a13-a86a-f7403ce5c46a",
    title: "Complaint-to-spec miner",
    mode: "complaint-to-spec-validation",
    recommendationId: "high-signal-complaint-to-spec",
    clusterId: "validation-before-build",
    fallbackTension:
      "Useful requirements appear as repeated complaints before they become an obvious category.",
    validationArtifact:
      "Complaint-to-spec card: repeated complaint, named user, current workaround, edge case, smallest spec, and validation task.",
    teardownQuestions: [
      "Is there a clear user or buyer behind the complaint?",
      "What current workaround proves the pain is real?",
      "What is the smallest validation artifact before product code?",
    ],
    nextManualOutput:
      "Turn the strongest repeated complaint into one source-linked validation artifact.",
  },
];

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function teardownStatus(
  cluster: PersonalComplaintCluster | undefined,
  evidenceUrls: string[],
): ApprovedTaskTeardownStatus {
  if (!cluster || evidenceUrls.length < 2) return "blocked";
  if (cluster.confidence === "high") return "ready-for-manual-output";
  return "needs-source-check";
}

export function approvedTaskSpecs() {
  return TASK_SPECS.slice();
}

export function buildApprovedTaskTeardowns({
  clusters,
  reelBriefs,
  generatedAt = null,
}: {
  clusters: PersonalComplaintCluster[];
  reelBriefs: PersonalReelBrief[];
  generatedAt?: string | null;
}): ApprovedTaskTeardown[] {
  return TASK_SPECS.map((spec) => {
    const cluster = clusters.find((item) => item.id === spec.clusterId);
    const reel = reelBriefs.find((item) => item.recommendationId === spec.recommendationId);
    const evidenceUrls = uniqueNonEmpty([
      ...(cluster?.sourceUrls ?? []),
      ...(reel?.evidenceUrls ?? []),
    ]).slice(0, 8);

    return {
      taskId: spec.taskId,
      title: spec.title,
      mode: spec.mode,
      status: teardownStatus(cluster, evidenceUrls),
      recommendationId: spec.recommendationId,
      clusterId: spec.clusterId,
      clusterTitle: cluster?.title ?? spec.title,
      confidence: cluster?.confidence ?? "missing",
      repeatedSignalCount: cluster?.repeatedSignalCount ?? 0,
      sourceCount: cluster?.sourceCount ?? 0,
      sampleTitles: cluster?.sampleTitles.slice(0, 3) ?? [],
      evidenceUrls,
      humanTension: reel?.humanTension || spec.fallbackTension,
      validationArtifact: spec.validationArtifact,
      teardownQuestions: spec.teardownQuestions,
      nextManualOutput: spec.nextManualOutput,
      claimBoundary:
        reel?.claimBoundary ??
        "Only promote a task when the source links show repeated pain and a concrete user.",
      generatedAt,
    };
  });
}
