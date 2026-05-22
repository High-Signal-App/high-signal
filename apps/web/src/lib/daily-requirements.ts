import type { DailyBroadInsight } from "@/lib/daily-intelligence";
import type { LightweightDomain, LightweightSignalLayer, SignalContentCategory } from "@high-signal/shared";

export type DailyRequirementPriority = "critical" | "high" | "medium" | "low";

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

const DOMAIN_BUILD: Partial<Record<LightweightDomain, string>> = {
  "agent-evaluation": "Agent-readiness evidence surface",
  consumer: "Consumer pressure radar",
  developer: "Developer workflow friction spec",
  market: "Market-regime watch note",
  operations: "Operations workflow requirement",
  regional: "Regional constraint tracker",
  "small-business": "Small-business operations artifact",
  startup: "Startup validation artifact",
};

function priorityFor(score: number): DailyRequirementPriority {
  if (score >= 78) return "critical";
  if (score >= 62) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function primaryDomain(item: DailyBroadInsight): LightweightDomain | null {
  return item.annotation.domains[0] ?? null;
}

function suggestedBuildFor(item: DailyBroadInsight) {
  const domain = primaryDomain(item);
  return domain ? DOMAIN_BUILD[domain] ?? "Source-linked validation artifact" : "Source-linked validation artifact";
}

function userLabelFor(item: DailyBroadInsight) {
  const domain = primaryDomain(item);
  if (domain === "small-business") return "small business operator";
  if (domain === "developer") return "developer or technical operator";
  if (domain === "regional") return "local operator";
  if (domain === "startup") return "startup builder";
  if (domain === "agent-evaluation") return "founder being evaluated by AI/search agents";
  if (domain === "operations") return "operations owner";
  if (domain === "consumer") return "consumer-facing product owner";
  if (domain === "market") return "market-aware product operator";
  return "product operator";
}

function nextStepFor(item: DailyBroadInsight) {
  if (item.annotation.buyerIntentScore >= 0.5) {
    return "Create a small offer or comparison page and validate whether the buyer intent repeats tomorrow.";
  }
  if (item.annotation.actionabilityScore >= 0.67) {
    return "Convert the repeated requirement into a one-page spec with acceptance criteria and a manual validation path.";
  }
  if (item.annotation.painScore >= 0.34) {
    return "Collect two more examples of the pain and identify the current workaround before building.";
  }
  return "Keep watching until the requirement repeats with stronger pain, buyer intent, or implementation detail.";
}

function validationArtifactFor(item: DailyBroadInsight) {
  if (item.annotation.buyerIntentScore >= 0.5) return "offer/comparison page";
  if (item.annotation.actionabilityScore >= 0.67) return "one-page requirement spec";
  if (item.annotation.painScore >= 0.34) return "pain teardown with current workaround";
  return "watch note with repeat evidence";
}

function acceptanceCriteriaFor(item: DailyBroadInsight) {
  const criteria = [
    `Cites ${Math.max(2, Math.min(item.sourceCount, 5))} source item(s) behind the requirement.`,
    `States the target user, current pain, and current workaround in one screen.`,
    `Defines one manual validation step that can be completed within 48 hours.`,
  ];
  if (item.annotation.buyerIntentScore >= 0.25) criteria.push("Includes an explicit price/alternative/comparison check.");
  if (item.annotation.actionabilityScore >= 0.34) criteria.push("Includes clear acceptance criteria for the smallest shippable version.");
  return criteria;
}

function scoreFor(item: DailyBroadInsight) {
  const annotation = item.annotation;
  const score =
    annotation.actionabilityScore * 34 +
    annotation.buyerIntentScore * 28 +
    annotation.painScore * 18 +
    item.qualityScore * 0.16 +
    Math.min(item.repeatedSignalCount, 5) * 2;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function buildDailyRequirementQueue(insights: DailyBroadInsight[], limit = 12): DailyRequirementItem[] {
  return insights
    .filter((item) => item.annotation.productRequirement)
    .map((item) => {
      const score = scoreFor(item);
      const suggestedBuild = suggestedBuildFor(item);
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
        priority: priorityFor(score),
        score,
        painScore: item.annotation.painScore,
        buyerIntentScore: item.annotation.buyerIntentScore,
        actionabilityScore: item.annotation.actionabilityScore,
        qualityScore: item.qualityScore,
        sourceCount: item.sourceCount,
        repeatedSignalCount: item.repeatedSignalCount,
        suggestedBuild,
        whyNow: `${item.sourceLabel} produced a ${item.annotation.signalLayer.replaceAll("-", " ")} signal with ${item.sourceCount} underlying item(s), ${item.repeatedSignalCount} repeated product cue(s), and ${item.annotation.domains.join("/") || "no"} domain tag(s).`,
        nextStep: nextStepFor(item),
        userStory: `As a ${userLabelFor(item)}, I need ${item.title.toLowerCase()} so I can decide what to change or validate next.`,
        acceptanceCriteria: acceptanceCriteriaFor(item),
        validationArtifact: validationArtifactFor(item),
        smallestTest: `Publish a ${validationArtifactFor(item)} for this requirement and check whether the same pain repeats in the next source refresh.`,
      };
    })
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore || a.title.localeCompare(b.title))
    .slice(0, limit);
}
