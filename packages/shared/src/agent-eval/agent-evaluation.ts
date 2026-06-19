export type EvidenceScoreStatus = "missing" | "weak" | "clear" | "strong";
export type AgentAuditStatus = "completed" | "failed";
export type AgentTaskPriority = "high" | "medium" | "low";
export type AgentTaskStatus = "open" | "done";

export interface AgentEvaluationCompetitor {
  name: string;
  url?: string;
}

export interface AgentEvaluationInput {
  ownerId: string;
  brandName: string;
  brandUrl: string;
  buyerMission: string;
  targetSegment?: string | null;
  competitors?: AgentEvaluationCompetitor[];
  evidenceText?: string | null;
  evidenceUrls?: string[];
}

export interface AgentPromptResult {
  promptKey: string;
  promptText: string;
  surface: string;
  responseText: string;
  brandMentioned: boolean;
  brandRecommended: boolean;
  competitorsMentioned: AgentEvaluationCompetitor[];
  citations: string[];
}

export interface EvidenceLayerScore {
  area: string;
  status: EvidenceScoreStatus;
  score: number;
  evidenceUrls: string[];
  notes: string;
}

export interface MissingEvidenceTask {
  area: string;
  title: string;
  priority: AgentTaskPriority;
  status: AgentTaskStatus;
  sourceUrl?: string | null;
}

export interface ReelBrief {
  title: string;
  hook: string;
  buyerMission: string;
  proofPoints: string[];
  visualBeats: string[];
  caption: string;
  cta: string;
  claimBoundary: string;
  evidenceUrls: string[];
}

export interface AgentEvaluationAuditResult {
  overallScore: number;
  recommendationSummary: string;
  prompts: AgentPromptResult[];
  scores: EvidenceLayerScore[];
  tasks: MissingEvidenceTask[];
  reelBriefs: ReelBrief[];
}

export interface AgentEvaluationAudit {
  id: string;
  ownerId: string;
  brandName: string;
  brandUrl: string;
  buyerMission: string;
  targetSegment: string | null;
  competitors: AgentEvaluationCompetitor[];
  status: AgentAuditStatus;
  overallScore: number;
  recommendationSummary: string;
  evidenceText: string | null;
  evidenceUrls: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface PersistedAgentPromptResult extends AgentPromptResult {
  id: string;
  auditId: string;
  createdAt: string;
}

export interface PersistedEvidenceLayerScore extends EvidenceLayerScore {
  id: string;
  auditId: string;
  createdAt: string;
}

export interface PersistedMissingEvidenceTask extends MissingEvidenceTask {
  id: string;
  auditId: string;
  createdAt: string;
}

export interface PersistedReelBrief extends ReelBrief {
  id: string;
  auditId: string;
  createdAt: string;
}

export interface AgentEvaluationAuditDetail {
  audit: AgentEvaluationAudit;
  prompts: PersistedAgentPromptResult[];
  scores: PersistedEvidenceLayerScore[];
  tasks: PersistedMissingEvidenceTask[];
  reelBriefs: PersistedReelBrief[];
}

interface EvidenceArea {
  area: string;
  strong: RegExp[];
  clear: RegExp[];
  weak: RegExp[];
  task: string;
}

const EVIDENCE_AREAS: EvidenceArea[] = [
  {
    area: "positioning",
    strong: [/for\s+[^.]{8,80}\s+who/i, /built for/i, /not for/i],
    clear: [/platform/i, /product/i, /workflow/i, /teams?/i],
    weak: [/ai/i, /automate/i, /better/i],
    task: "Write the target buyer, painful job, promised outcome, and who should not use it.",
  },
  {
    area: "pricing",
    strong: [/\$\d+|\d+\s*\/\s*mo|pricing starts|starter|pro|enterprise/i],
    clear: [/pricing|plans?|free trial|subscription/i],
    weak: [/contact sales|request pricing/i],
    task: "Publish clear pricing, plan boundaries, implementation cost, or a reason pricing is custom.",
  },
  {
    area: "proof",
    strong: [/case stud(y|ies)|\d+%|saved|reduced|increased|customer result/i],
    clear: [/testimonial|customer|logo|result|proof/i],
    weak: [/trusted by|loved by/i],
    task: "Add specific proof with numbers, customer segment, timeline, and before/after outcome.",
  },
  {
    area: "comparisons",
    strong: [/ vs |versus|alternatives?|compare|why choose/i],
    clear: [/competitor|instead of|switch from/i],
    weak: [/better than/i],
    task: "Create comparison pages for the main alternatives and when not to choose this product.",
  },
  {
    area: "docs",
    strong: [/docs?|api|quickstart|implementation guide|integration guide/i],
    clear: [/guide|setup|integrations?|webhook|sdk/i],
    weak: [/learn more|how it works/i],
    task: "Publish implementation docs, integration list, setup timeline, and technical limits.",
  },
  {
    area: "policies",
    strong: [/refund|cancellation|support policy|security|privacy|sla|compliance/i],
    clear: [/support|privacy|terms|secure/i],
    weak: [/contact us|help/i],
    task: "Make support, refund/cancellation, security, and privacy terms agent-readable.",
  },
  {
    area: "reviews",
    strong: [/g2|capterra|product hunt|reddit|reviews?|rating|third-party/i],
    clear: [/testimonial|community|social proof/i],
    weak: [/people say|users love/i],
    task: "Collect review sources and third-party validation that agents can cite.",
  },
  {
    area: "transaction readiness",
    strong: [/checkout|sign up|book demo|api|feed|schema|structured data/i],
    clear: [/demo|waitlist|contact|onboarding/i],
    weak: [/coming soon|join/i],
    task: "Expose a clear next step plus structured data, product feed, or API where relevant.",
  },
];

const PROMPT_TEMPLATES = [
  {
    key: "best_tools",
    text: (input: AgentEvaluationInput) => `Best tools for ${input.buyerMission}`,
  },
  {
    key: "is_good",
    text: (input: AgentEvaluationInput) =>
      `Is ${input.brandName} good for ${input.targetSegment || input.buyerMission}?`,
  },
  {
    key: "alternatives",
    text: (input: AgentEvaluationInput) => `Alternatives to ${input.brandName}`,
  },
  {
    key: "complaints",
    text: (input: AgentEvaluationInput) => `Complaints about ${input.brandName}`,
  },
  {
    key: "who_not_for",
    text: (input: AgentEvaluationInput) => `Who should not use ${input.brandName}?`,
  },
  {
    key: "pricing_policy",
    text: (input: AgentEvaluationInput) =>
      `What is ${input.brandName}'s pricing, support policy, refund policy, and implementation time?`,
  },
  {
    key: "compare",
    text: (input: AgentEvaluationInput) =>
      `Compare ${input.brandName} vs ${(input.competitors?.[0]?.name ?? "the main alternative")}`,
  },
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeInput(input: AgentEvaluationInput): AgentEvaluationInput {
  return {
    ...input,
    brandName: input.brandName.trim(),
    brandUrl: input.brandUrl.trim(),
    buyerMission: input.buyerMission.trim(),
    targetSegment: input.targetSegment?.trim() || null,
    competitors: (input.competitors ?? [])
      .map((competitor) => ({ name: competitor.name.trim(), url: competitor.url?.trim() }))
      .filter((competitor) => competitor.name),
    evidenceText: input.evidenceText?.trim() || null,
    evidenceUrls: [...new Set([input.brandUrl, ...(input.evidenceUrls ?? [])].filter(Boolean))],
  };
}

function statusFor(area: EvidenceArea, corpus: string): EvidenceScoreStatus {
  if (area.strong.some((pattern) => pattern.test(corpus))) return "strong";
  if (area.clear.some((pattern) => pattern.test(corpus))) return "clear";
  if (area.weak.some((pattern) => pattern.test(corpus))) return "weak";
  return "missing";
}

function scoreFor(status: EvidenceScoreStatus) {
  if (status === "strong") return 90;
  if (status === "clear") return 70;
  if (status === "weak") return 40;
  return 0;
}

function scoreNote(area: string, status: EvidenceScoreStatus) {
  if (status === "strong") return `${area} is agent-readable and likely citeable.`;
  if (status === "clear") return `${area} is present, but needs stronger specificity or proof.`;
  if (status === "weak") return `${area} is hinted at, but agents would treat it as ambiguous.`;
  return `${area} is missing from the supplied evidence.`;
}

function buildScores(input: AgentEvaluationInput): EvidenceLayerScore[] {
  const corpus = [
    input.brandName,
    input.brandUrl,
    input.buyerMission,
    input.targetSegment,
    input.evidenceText,
    ...(input.competitors ?? []).flatMap((competitor) => [competitor.name, competitor.url]),
  ]
    .filter(Boolean)
    .join("\n");

  return EVIDENCE_AREAS.map((area) => {
    const status = statusFor(area, corpus);
    return {
      area: area.area,
      status,
      score: scoreFor(status),
      evidenceUrls: status === "missing" ? [] : (input.evidenceUrls ?? []),
      notes: scoreNote(area.area, status),
    };
  });
}

function buildTasks(scores: EvidenceLayerScore[]): MissingEvidenceTask[] {
  return scores
    .filter((score) => score.status === "missing" || score.status === "weak")
    .map((score) => {
      const area = EVIDENCE_AREAS.find((item) => item.area === score.area);
      return {
        area: score.area,
        title: area?.task ?? `Strengthen ${score.area}.`,
        priority: score.status === "missing" ? "high" : "medium",
        status: "open",
        sourceUrl: null,
      };
    });
}

function statusCount(scores: EvidenceLayerScore[], status: EvidenceScoreStatus) {
  return scores.filter((score) => score.status === status).length;
}

function buildPrompts(input: AgentEvaluationInput, scores: EvidenceLayerScore[]): AgentPromptResult[] {
  const overallScore = averageScore(scores);
  const missing = scores.filter((score) => score.status === "missing").map((score) => score.area);
  const strong = scores.filter((score) => score.status === "strong").map((score) => score.area);
  const competitors = input.competitors ?? [];
  const citations = input.evidenceUrls ?? [];
  const brandRecommended = overallScore >= 70 && missing.length <= 2;
  const competitorText = competitors.length
    ? ` Alternatives visible in the comparison set: ${competitors.map((item) => item.name).join(", ")}.`
    : " No explicit competitor set was supplied.";
  const evidenceText = strong.length
    ? ` Strongest public evidence areas: ${strong.join(", ")}.`
    : " No strong public evidence area was detected.";
  const gapText = missing.length
    ? ` Agent risk: missing ${missing.join(", ")}.`
    : " No critical evidence area is fully missing.";
  const recommendation = brandRecommended
    ? `${input.brandName} is recommendable for ${input.buyerMission} if the buyer matches the stated segment.`
    : `${input.brandName} is not safely recommendable yet without stronger public evidence.`;

  return PROMPT_TEMPLATES.map((template) => ({
    promptKey: template.key,
    promptText: template.text(input),
    surface: "local-agent-simulator",
    responseText: `${recommendation}${competitorText} ${evidenceText} ${gapText}`,
    brandMentioned: true,
    brandRecommended,
    competitorsMentioned: competitors,
    citations,
  }));
}

function averageScore(scores: EvidenceLayerScore[]) {
  if (scores.length === 0) return 0;
  return clampScore(scores.reduce((sum, score) => sum + score.score, 0) / scores.length);
}

function buildSummary(input: AgentEvaluationInput, scores: EvidenceLayerScore[]) {
  const overallScore = averageScore(scores);
  const strong = statusCount(scores, "strong");
  const clear = statusCount(scores, "clear");
  const missing = scores.filter((score) => score.status === "missing").map((score) => score.area);
  if (overallScore >= 75) {
    return `${input.brandName} is likely recommendable for ${input.buyerMission}. It has ${strong} strong and ${clear} clear evidence areas, with remaining gaps to tighten.`;
  }
  if (overallScore >= 50) {
    return `${input.brandName} is plausible but not yet easy for agents to recommend. The next work is to fix ${missing.slice(0, 3).join(", ") || "weak evidence areas"}.`;
  }
  return `${input.brandName} is weakly agent-readable right now. Agents would struggle to recommend it until public proof, pricing, comparisons, docs, and policies are clearer.`;
}

function buildReelBriefs(input: AgentEvaluationInput, scores: EvidenceLayerScore[]): ReelBrief[] {
  const proofScores = scores.filter((score) => score.status === "strong" || score.status === "clear");
  const proofAreas = proofScores.length ? proofScores.map((score) => score.area) : ["positioning"];
  const evidenceUrls = [...new Set(proofScores.flatMap((score) => score.evidenceUrls))];
  const mission = input.buyerMission;
  const segment = input.targetSegment || "operators comparing options";
  const firstProof = proofAreas[0] ?? "positioning";
  const secondProof = proofAreas[1] ?? "proof";
  const thirdProof = proofAreas[2] ?? "docs";

  return [
    {
      title: `${input.brandName}: the agent-check reel`,
      hook: `Before a buyer trusts ${input.brandName}, their agent will check the evidence.`,
      buyerMission: mission,
      proofPoints: [
        `${firstProof} is the strongest visible proof area.`,
        `${secondProof} supports the buyer mission.`,
        `The CTA should point to the source page, not a vague landing page.`,
      ],
      visualBeats: [
        "Open with the buyer asking an AI assistant for options.",
        `Show ${input.brandName} beside two alternatives.`,
        "Cut to the strongest public proof surface.",
        "End on the exact question the buyer should ask next.",
      ],
      caption: `${input.brandName} should win attention first, then survive the agent check for ${mission}.`,
      cta: `Ask an agent: "Is ${input.brandName} good for ${mission}?"`,
      claimBoundary: "Only claim strengths backed by the linked evidence areas.",
      evidenceUrls,
    },
    {
      title: `${input.brandName}: why not the obvious alternative`,
      hook: `The real comparison is not who sounds better. It is who is easier to verify.`,
      buyerMission: mission,
      proofPoints: [
        `${input.brandName} needs to be compared against ${input.competitors?.[0]?.name ?? "the default alternative"}.`,
        `${secondProof} should be made specific enough for agents to cite.`,
        "Weak or missing areas should become public evidence tasks.",
      ],
      visualBeats: [
        "Split screen: flashy claim vs verifiable evidence.",
        "Show the buyer mission in one sentence.",
        "Show the strongest proof object.",
        "Close with a comparison-page CTA.",
      ],
      caption: `Agents do not reward vague positioning. They reward clear proof for ${segment}.`,
      cta: `Compare ${input.brandName} against the main alternative before deciding.`,
      claimBoundary: "Do not claim superiority unless the comparison page exists.",
      evidenceUrls,
    },
    {
      title: `${input.brandName}: the missing-evidence teardown`,
      hook: `If an agent would not recommend you, the reason is probably public and fixable.`,
      buyerMission: mission,
      proofPoints: [
        `${thirdProof} is part of the recommendation surface.`,
        "Pricing, policies, docs, reviews, and proof are marketing now.",
        "The reel should drive to the evidence layer, not a generic signup page.",
      ],
      visualBeats: [
        "Show a checklist of agent evaluation criteria.",
        `Mark the strongest ${input.brandName} evidence area.`,
        "Mark one missing area as the next fix.",
        "End with a source-linked audit CTA.",
      ],
      caption: `Attention gets ${input.brandName} considered. Evidence gets it selected.`,
      cta: "Open the audit and fix the first missing evidence area.",
      claimBoundary: "Frame this as an audit finding, not a guaranteed recommendation.",
      evidenceUrls,
    },
  ];
}

export function buildAgentEvaluationAudit(input: AgentEvaluationInput): AgentEvaluationAuditResult {
  const normalized = normalizeInput(input);
  const scores = buildScores(normalized);
  return {
    overallScore: averageScore(scores),
    recommendationSummary: buildSummary(normalized, scores),
    prompts: buildPrompts(normalized, scores),
    scores,
    tasks: buildTasks(scores),
    reelBriefs: buildReelBriefs(normalized, scores),
  };
}
