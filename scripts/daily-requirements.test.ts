#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { buildDailyRequirementQueue } from "../apps/web/src/lib/daily-requirements";
import { buildDailyRequirementTaskExports } from "../apps/web/src/lib/daily-task-export";
import type { DailyBroadInsight } from "../apps/web/src/lib/daily-intelligence";
import productGraph from "../data/personal-product-graph.json";
import type { LightweightNlpAnnotation, PersonalProductProfile } from "@high-signal/shared";

function annotation(overrides: Partial<LightweightNlpAnnotation>): LightweightNlpAnnotation {
  return {
    intent: "feature-request",
    sentiment: "negative",
    urgency: "medium",
    method: "semantic-rules-v2",
    model: "none",
    llm: false,
    intentScore: 1,
    sentimentScore: 1,
    positiveHits: [],
    negativeHits: ["broken"],
    intentHits: ["need", "workflow"],
    signalLayer: "app-complaint",
    domains: ["developer"],
    productSignals: ["github", "ci", "deploy", "workflow", "bug", "review"],
    painScore: 0.5,
    buyerIntentScore: 0,
    actionabilityScore: 0.83,
    productRequirement: true,
    audience: "developers",
    requirementType: "fix-bug",
    decisionStage: "pain-discovery",
    opportunityScore: 0.71,
    qualityGate: {
      status: "strong",
      score: 71,
      reasons: ["product-requirement", "pain", "actionable", "domain-tagged", "medium-urgency"],
    },
    ...overrides,
  };
}

function insight(overrides: Partial<DailyBroadInsight>): DailyBroadInsight {
  const baseAnnotation = annotation({});
  return {
    id: "test",
    title: "GitHub CI deploy workflow is broken and needs review",
    summary: "Developers need clearer bug review and deploy workflow visibility.",
    href: "https://example.com/test",
    sourceLabel: "test source",
    sourceType: "reddit",
    contentCategory: "product-opportunity",
    intent: baseAnnotation.intent,
    sentiment: baseAnnotation.sentiment,
    urgency: baseAnnotation.urgency,
    annotation: baseAnnotation,
    confidence: "medium",
    qualityScore: 75,
    sourceCount: 4,
    repeatedSignalCount: 4,
    observedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

const products = productGraph.products as PersonalProductProfile[];

const developerQueue = buildDailyRequirementQueue([insight({})], 3, products);
assert.equal(developerQueue.length, 1);
assert.equal(developerQueue[0]?.fleetTarget?.productSlug, "CodeVetter");
assert.match(developerQueue[0]?.fleetTarget?.reason ?? "", /developer-workflow-friction|product term/);
assert.equal(developerQueue[0]?.taskDraft?.saasMakerProjectSlug, "CodeVetter");
assert.equal(developerQueue[0]?.taskDraft?.status, "todo");
assert.equal(developerQueue[0]?.taskDraft?.syncStatus, "pending");
assert.match(developerQueue[0]?.taskDraft?.title ?? "", /CodeVetter/);
const developerTaskExports = buildDailyRequirementTaskExports(developerQueue);
assert.equal(developerTaskExports.length, 1);
assert.equal(developerTaskExports[0]?.projectSlug, "CodeVetter");
assert.equal(developerTaskExports[0]?.priority, "medium");
assert.match(developerTaskExports[0]?.description ?? "", /Generated from High Signal daily requirement/);

const regionalQueue = buildDailyRequirementQueue(
  [
    insight({
      title: "Local permit delays and rent pressure are hurting shops",
      summary: "Regional operators need a tracker for city constraints and local business impact.",
      contentCategory: "regional-issue",
      annotation: annotation({
        intent: "regional-pressure",
        domains: ["regional", "small-business"],
        productSignals: ["local", "permit", "rent", "city", "small business"],
      }),
    }),
  ],
  3,
  products,
);
assert.equal(regionalQueue[0]?.fleetTarget?.productSlug, "high-signal");
assert.equal(regionalQueue[0]?.fleetTarget?.action, "change");
assert.equal(regionalQueue[0]?.taskDraft?.saasMakerProjectSlug, "high-signal");

const weakQueue = buildDailyRequirementQueue(
  [
    insight({
      id: "weak",
      title: "General discussion about a possible workflow",
      sourceCount: 2,
      repeatedSignalCount: 1,
      qualityScore: 40,
      annotation: annotation({
        painScore: 0.17,
        buyerIntentScore: 0,
        actionabilityScore: 0.34,
        productRequirement: true,
        qualityGate: {
          status: "review",
          score: 31,
          reasons: ["product-requirement", "actionable"],
        },
      }),
    }),
  ],
  3,
  products,
);
assert.equal(weakQueue.length, 0);

const watchOnlyQueue = buildDailyRequirementQueue(
  [
    insight({
      id: "watch-only",
      title: "Local control preference repeats but has no immediate product action",
      sourceCount: 8,
      repeatedSignalCount: 4,
      qualityScore: 100,
      annotation: annotation({
        domains: ["consumer"],
        productSignals: ["local", "privacy", "cost"],
        painScore: 0.34,
        buyerIntentScore: 0,
        actionabilityScore: 0.34,
        qualityGate: {
          status: "review",
          score: 44,
          reasons: ["product-requirement", "pain", "actionable", "domain-tagged"],
        },
      }),
    }),
  ],
  3,
  products,
);
assert.equal(watchOnlyQueue.length, 0);

console.log("daily-requirements.test.ts: ok");
