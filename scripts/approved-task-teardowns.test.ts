import assert from "node:assert/strict";
import { buildApprovedTaskTeardowns } from "@high-signal/shared";
import type { PersonalComplaintCluster, PersonalReelBrief } from "@high-signal/shared";

const clusters: PersonalComplaintCluster[] = [
  {
    id: "agentic-launch-trust",
    title: "Launch trust and agent-readiness anxiety",
    confidence: "high",
    sourceCount: 5,
    repeatedSignalCount: 3,
    evidenceIds: ["agent-source"],
    sourceUrls: ["/communities/LocalLLaMA/week", "https://example.com/agent"],
    sampleTitles: ["Agent-readiness complaint"],
    productImplication: "Turn vague launch anxiety into proof-page tasks.",
  },
  {
    id: "workflow-reliability",
    title: "AI workflow reliability",
    confidence: "high",
    sourceCount: 8,
    repeatedSignalCount: 5,
    evidenceIds: ["workflow-source"],
    sourceUrls: ["https://example.com/workflow", "/communities/SaaS/week"],
    sampleTitles: ["Workflow tracing complaint"],
    productImplication: "Ship a manual teardown before tooling.",
  },
  {
    id: "validation-before-build",
    title: "Validation before build",
    confidence: "medium",
    sourceCount: 4,
    repeatedSignalCount: 2,
    evidenceIds: ["validation-source"],
    sourceUrls: ["https://example.com/validation"],
    sampleTitles: ["Validation complaint"],
    productImplication: "Promote only complaints with a named user.",
  },
];

const reelBriefs: PersonalReelBrief[] = [
  {
    id: "reel-agent",
    recommendationId: "high-signal-agent-evaluation",
    productSlug: "high-signal",
    productName: "High Signal",
    title: "High Signal: Agent-readiness audit layer",
    hook: "Agents choose what they can verify.",
    humanTension: "Products need proof that agents can cite.",
    proofBeat: "Agent-readiness complaint.",
    visualBeats: ["Audit proof"],
    caption: "Agent readiness.",
    cta: "Run the audit.",
    claimBoundary: "Only use backed claims.",
    evidenceUrls: ["https://example.com/agent"],
  },
  {
    id: "reel-workflow",
    recommendationId: "high-signal-workflow-observability",
    productSlug: "high-signal",
    productName: "High Signal",
    title: "High Signal: Workflow observability for AI apps",
    hook: "The workflow failed invisibly.",
    humanTension: "Builders need workflow traces before dashboards.",
    proofBeat: "Workflow tracing complaint.",
    visualBeats: ["Teardown trace"],
    caption: "Workflow teardown.",
    cta: "Ship the teardown.",
    claimBoundary: "Only use backed claims.",
    evidenceUrls: ["https://example.com/trace"],
  },
  {
    id: "reel-complaint",
    recommendationId: "high-signal-complaint-to-spec",
    productSlug: "high-signal",
    productName: "High Signal",
    title: "High Signal: Complaint-to-spec miner",
    hook: "Complaints become specs.",
    humanTension: "Feature requests appear as repeated complaints first.",
    proofBeat: "Validation complaint.",
    visualBeats: ["Complaint card"],
    caption: "Complaint-to-spec.",
    cta: "Write the validation artifact.",
    claimBoundary: "Only use backed claims.",
    evidenceUrls: ["https://example.com/spec"],
  },
];

const teardowns = buildApprovedTaskTeardowns({
  clusters,
  reelBriefs,
  generatedAt: "2026-05-22T10:34:39.154Z",
});

assert.equal(teardowns.length, 3);
assert.deepEqual(
  teardowns.map((item) => item.taskId.slice(0, 8)),
  ["d94ad9b8", "09cb694f", "e68a0286"],
);
assert.equal(teardowns[0]?.status, "ready-for-manual-output");
assert.equal(teardowns[1]?.mode, "workflow-observability-teardown");
assert.equal(teardowns[2]?.status, "needs-source-check");
assert.match(teardowns[2]?.validationArtifact ?? "", /Complaint-to-spec card/);
assert.ok(teardowns.every((item) => item.evidenceUrls.length >= 2));
assert.ok(new Set(teardowns[0]?.evidenceUrls).size === teardowns[0]?.evidenceUrls.length);

console.log("approved-task-teardowns.test.ts: ok");
