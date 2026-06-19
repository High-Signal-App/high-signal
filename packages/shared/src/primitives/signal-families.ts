/**
 * Signal-type → family mapping for the hit-rate fallback.
 *
 * The brief's stocks section shows inline hit-rate per signal_type. Fresh
 * signal types start with zero scored predictions and would render empty —
 * the moat invisible.
 *
 * Families group conceptually-related signal types so a new type can borrow
 * confidence from sibling types' historical accuracy. e.g. a fresh
 * `cohere_model_release` call falls back to the `ai-adoption` family rate
 * (which includes `ai_deal_velocity`, `cloud_recovery`, etc.).
 *
 * Unknown types map to the `other` family — never silently fail.
 */

export type SignalFamily =
  | "supply-demand"
  | "ai-adoption"
  | "macro-demand"
  | "capital-allocation"
  | "consumer-behavior"
  | "platform-momentum"
  | "regulatory-shift"
  | "other";

const FAMILY_BY_PREFIX: Array<{ family: SignalFamily; prefixes: string[] }> = [
  {
    family: "supply-demand",
    prefixes: [
      "capex",
      "order_book",
      "lead_time",
      "supply_warning",
      "supplier",
      "inventory",
      "shortage",
      "gpu_lead",
      "hbm",
      "ald",
      "manufacturing",
    ],
  },
  {
    family: "ai-adoption",
    prefixes: [
      "ai_deal",
      "ai_visibility",
      "model_release",
      "cohere",
      "anthropic",
      "openai_adoption",
      "agent_adoption",
      "cloud_recovery",
      "compute_consumption",
      "ai_pipeline",
      "genai",
      "llm",
      "ai_edge",
      "ai_pricing",
      "industrial_ai",
      "physical_ai",
    ],
  },
  {
    family: "macro-demand",
    prefixes: [
      "demand_softening",
      "demand_acceleration",
      "deliveries",
      "consumer_spend",
      "discretionary",
      "macro",
      "rates",
    ],
  },
  {
    family: "capital-allocation",
    prefixes: [
      "buyback",
      "dividend",
      "issuance",
      "guidance",
      "earnings_revision",
      "capital_return",
      "spin",
      "merger",
      "acquisition",
    ],
  },
  {
    family: "consumer-behavior",
    prefixes: [
      "social_sentiment",
      "search_trend",
      "subscriber_growth",
      "churn",
      "arpu",
      "monthly_active",
      "wallet_share",
    ],
  },
  {
    family: "platform-momentum",
    prefixes: [
      "gmv",
      "platform",
      "marketplace",
      "two_sided",
      "developer_engagement",
      "github_stars",
      "downloads",
      "active_devs",
      "developer_ecosystem",
      "devtool",
    ],
  },
  {
    family: "regulatory-shift",
    prefixes: [
      "antitrust",
      "regulation",
      "compliance",
      "tariff",
      "export_control",
      "sanctions",
      "ftc",
      "sec_enforcement",
      "security",
      "policy_competition",
      "regional_compute",
    ],
  },
];

export function familyForSignalType(signalType: string): SignalFamily {
  const lowered = signalType.toLowerCase();
  for (const entry of FAMILY_BY_PREFIX) {
    if (entry.prefixes.some((prefix) => lowered.includes(prefix))) {
      return entry.family;
    }
  }
  return "other";
}

export function familyLabel(family: SignalFamily): string {
  switch (family) {
    case "supply-demand":
      return "supply & demand";
    case "ai-adoption":
      return "AI adoption";
    case "macro-demand":
      return "macro demand";
    case "capital-allocation":
      return "capital allocation";
    case "consumer-behavior":
      return "consumer behavior";
    case "platform-momentum":
      return "platform momentum";
    case "regulatory-shift":
      return "regulatory shift";
    case "other":
      return "other";
  }
}
