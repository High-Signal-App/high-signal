/**
 * Sample prompt set for testing AI visibility against competitors.
 *
 * Five intent categories, 15 prompts total. Each prompt exposes a different
 * failure mode: invisible in category queries, displaced by alternatives,
 * missing proof, or unable to survive a direct comparison.
 *
 * Usage:
 *   const prompts = hydratePromptSet("Linear", "Jira");
 *   // → ready-to-run prompt strings for mention checks or manual testing
 *
 * These can be seeded directly into mention_prompts rows, run through the
 * /products/agent-eval execution path, or pasted into any AI chat for a
 * quick manual audit.
 */

export type VisibilityIntentCategory =
  | "category_discovery"
  | "direct_comparison"
  | "displacement_risk"
  | "trust_audit"
  | "decision_support";

export interface CompetitorPromptTemplate {
  key: string;
  category: VisibilityIntentCategory;
  /** One-sentence explanation of what this prompt reveals. */
  rationale: string;
  /** Template text. Use {brand} and {competitor} as placeholders. */
  template: string;
}

/** The canonical 15-prompt set covering all five visibility failure modes. */
export const COMPETITOR_PROMPT_TEMPLATES: CompetitorPromptTemplate[] = [
  // ── Category discovery ──────────────────────────────────────────────────
  // Tests whether the brand appears when a buyer searches generically.
  // Absence here means the brand is invisible before the comparison stage.
  {
    key: "cat_best_for_segment",
    category: "category_discovery",
    rationale: "Reveals whether the brand surfaces without being named.",
    template: "What are the best tools for teams using {brand} for project management?",
  },
  {
    key: "cat_top_in_category",
    category: "category_discovery",
    rationale: "Shows whether the brand appears in category-level rankings.",
    template: "What are the top-rated {brand} alternatives for software teams?",
  },
  {
    key: "cat_recommended_by_role",
    category: "category_discovery",
    rationale: "Tests visibility when a specific buyer role is named.",
    template: "What tools do engineering leaders recommend for issue tracking instead of {competitor}?",
  },

  // ── Direct comparison ───────────────────────────────────────────────────
  // Tests whether the brand wins, loses, or goes unmentioned head-to-head.
  {
    key: "cmp_vs_competitor",
    category: "direct_comparison",
    rationale: "The most common buyer query before a final decision.",
    template: "{brand} vs {competitor}: which is better for fast-moving product teams?",
  },
  {
    key: "cmp_compare_feature",
    category: "direct_comparison",
    rationale: "Reveals whether feature-level comparisons favour the brand.",
    template: "Compare {brand} and {competitor} on workflow automation and reporting.",
  },
  {
    key: "cmp_switching_cost",
    category: "direct_comparison",
    rationale: "Probes whether the agent treats migration pain as a reason to stay or leave.",
    template: "How hard is it to switch from {competitor} to {brand}?",
  },

  // ── Displacement risk ───────────────────────────────────────────────────
  // Tests whether competitors crowd out the brand on 'alternatives' queries.
  {
    key: "dis_alternatives_to_brand",
    category: "displacement_risk",
    rationale: "Shows which competitors agents surface when the brand is named as the problem.",
    template: "What are the best alternatives to {brand}?",
  },
  {
    key: "dis_why_leave",
    category: "displacement_risk",
    rationale: "Surfaces competitor names in the context of switching away.",
    template: "Why do teams leave {brand} and what do they move to?",
  },
  {
    key: "dis_cheaper_option",
    category: "displacement_risk",
    rationale: "Tests price-sensitive displacement — a common B2B objection.",
    template: "Is there a cheaper option than {brand} that still handles {competitor}'s core use case?",
  },

  // ── Trust audit ─────────────────────────────────────────────────────────
  // Tests whether the agent can find public proof, reviews, and policies.
  {
    key: "trust_complaints",
    category: "trust_audit",
    rationale: "Agents surface complaints when proof is thin — this shows the risk.",
    template: "What are the most common complaints about {brand}?",
  },
  {
    key: "trust_reviews",
    category: "trust_audit",
    rationale: "Reveals whether third-party review sources are crawlable and cited.",
    template: "What do G2 and Reddit say about {brand} compared to {competitor}?",
  },
  {
    key: "trust_pricing_policy",
    category: "trust_audit",
    rationale: "Pricing opacity is the single most common reason agents decline to recommend.",
    template: "What is {brand}'s pricing, refund policy, and support SLA?",
  },

  // ── Decision support ────────────────────────────────────────────────────
  // Tests final-mile queries a buyer asks when they are close to committing.
  {
    key: "dec_is_it_worth_it",
    category: "decision_support",
    rationale: "Mimics a buyer's last sanity-check before purchase.",
    template: "Is {brand} worth paying for in 2025 or should I stick with {competitor}?",
  },
  {
    key: "dec_who_not_for",
    category: "decision_support",
    rationale: "Agents that can answer this clearly signal the brand has strong positioning.",
    template: "Who should NOT use {brand} and would be better served by {competitor}?",
  },
  {
    key: "dec_implementation_time",
    category: "decision_support",
    rationale: "Implementation time is an agent-readable signal of docs and onboarding quality.",
    template: "How long does it take to fully implement {brand} versus {competitor}?",
  },
];

/** Hydrate a single template with a brand and competitor name. */
export function hydratePrompt(
  template: CompetitorPromptTemplate,
  brand: string,
  competitor: string,
): string {
  return template.template
    .replaceAll("{brand}", brand)
    .replaceAll("{competitor}", competitor);
}

/** Hydrate the full prompt set, returning plain strings ready to run. */
export function hydratePromptSet(brand: string, competitor: string): string[] {
  return COMPETITOR_PROMPT_TEMPLATES.map((t) => hydratePrompt(t, brand, competitor));
}

/**
 * Ready-to-run sample audit inputs covering three distinct competitive
 * landscapes. Pass any of these to buildAgentEvaluationAudit() or POST them
 * to /products/agent-eval/audits to see a real audit result.
 */
export const SAMPLE_AUDIT_INPUTS = [
  {
    label: "Project management — Linear vs Jira",
    input: {
      ownerId: "demo",
      brandName: "Linear",
      brandUrl: "https://linear.app",
      buyerMission: "track product issues and ship software faster",
      targetSegment: "fast-moving product and engineering teams",
      competitors: [
        { name: "Jira", url: "https://www.atlassian.com/software/jira" },
        { name: "Asana", url: "https://asana.com" },
        { name: "GitHub Issues", url: "https://github.com/features/issues" },
      ],
      evidenceUrls: [
        "https://linear.app/pricing",
        "https://linear.app/customers",
        "https://linear.app/docs",
      ],
    },
    hydrated: hydratePromptSet("Linear", "Jira"),
  },
  {
    label: "AI writing — Cursor vs GitHub Copilot",
    input: {
      ownerId: "demo",
      brandName: "Cursor",
      brandUrl: "https://cursor.com",
      buyerMission: "write and refactor code faster with AI assistance",
      targetSegment: "individual developers and small engineering teams",
      competitors: [
        { name: "GitHub Copilot", url: "https://github.com/features/copilot" },
        { name: "Codeium", url: "https://codeium.com" },
        { name: "Tabnine", url: "https://www.tabnine.com" },
      ],
      evidenceUrls: [
        "https://cursor.com/pricing",
        "https://docs.cursor.com",
        "https://cursor.com/features",
      ],
    },
    hydrated: hydratePromptSet("Cursor", "GitHub Copilot"),
  },
  {
    label: "Analytics — PostHog vs Mixpanel",
    input: {
      ownerId: "demo",
      brandName: "PostHog",
      brandUrl: "https://posthog.com",
      buyerMission: "understand how users interact with the product and improve retention",
      targetSegment: "product teams at B2B SaaS companies",
      competitors: [
        { name: "Mixpanel", url: "https://mixpanel.com" },
        { name: "Amplitude", url: "https://amplitude.com" },
        { name: "Heap", url: "https://heap.io" },
      ],
      evidenceUrls: [
        "https://posthog.com/pricing",
        "https://posthog.com/docs",
        "https://posthog.com/customers",
      ],
    },
    hydrated: hydratePromptSet("PostHog", "Mixpanel"),
  },
] as const;
