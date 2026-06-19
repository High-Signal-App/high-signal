/**
 * Seed-product demo data.
 *
 * Sarthak's 2026-05-25 direction: "30-40 products and 5-7 regions, we can just
 * test those out. No sign up required for now." These products power the
 * Daily Brief's personal sections (4 + 5) when no signed-in brand is
 * available, so the demo always shows what the personalised experience
 * looks like.
 *
 * Each product spans one of the three knowledge domains (technology /
 * startups / finance) and carries:
 *
 * - brandName, brandUrl, region — how the brief addresses the product
 * - perception — section 4 metrics (mention rate, positive sentiment share,
 *   competitor presence) calibrated by hand to be plausible
 * - improvements — section 5 tasks the brief surfaces to "fix"
 *
 * Bias toward boring, recognisable names so users testing the demo can
 * sanity-check the metrics against intuition.
 */

import type { Region } from "../primitives/region";

export interface SeedProductImprovement {
  area: string;
  task: string;
  priority: "high" | "medium" | "low";
}

export interface SeedProduct {
  id: string;
  brandName: string;
  brandUrl: string;
  domain: "technology" | "startups" | "finance";
  region: Region;
  perception: {
    mentionRate: number;
    positiveShare: number;
    competitorPresence: number;
  };
  improvements: SeedProductImprovement[];
}

export const SEED_PRODUCTS: SeedProduct[] = [
  // --- Technology --------------------------------------------------------
  {
    id: "linear",
    brandName: "Linear",
    brandUrl: "https://linear.app",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.78, positiveShare: 0.82, competitorPresence: 0.62 },
    improvements: [
      { area: "comparisons", task: "Publish a 'Linear vs Jira' comparison page with structured data.", priority: "high" },
      { area: "pricing", task: "Add enterprise pricing tier breakdown with seat economics.", priority: "medium" },
    ],
  },
  {
    id: "vercel",
    brandName: "Vercel",
    brandUrl: "https://vercel.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.91, positiveShare: 0.74, competitorPresence: 0.71 },
    improvements: [
      { area: "comparisons", task: "Document the 'when not to use Vercel' negative-case page.", priority: "medium" },
      { area: "policies", task: "Surface SOC-2 / GDPR posture in an agent-readable schema.", priority: "high" },
    ],
  },
  {
    id: "supabase",
    brandName: "Supabase",
    brandUrl: "https://supabase.com",
    domain: "technology",
    region: "europe",
    perception: { mentionRate: 0.69, positiveShare: 0.77, competitorPresence: 0.58 },
    improvements: [
      { area: "proof", task: "Add named customer case studies with quantified outcomes.", priority: "high" },
      { area: "docs", task: "Publish a clear migration guide from Firebase.", priority: "medium" },
    ],
  },
  {
    id: "modal",
    brandName: "Modal",
    brandUrl: "https://modal.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.41, positiveShare: 0.83, competitorPresence: 0.45 },
    improvements: [
      { area: "positioning", task: "Lead with 'for whom' on the homepage — currently feature-led.", priority: "high" },
      { area: "reviews", task: "Collect third-party reviews on G2 / Reddit threads.", priority: "medium" },
    ],
  },
  {
    id: "neon",
    brandName: "Neon",
    brandUrl: "https://neon.tech",
    domain: "technology",
    region: "europe",
    perception: { mentionRate: 0.54, positiveShare: 0.71, competitorPresence: 0.62 },
    improvements: [
      { area: "comparisons", task: "Comparison page vs Supabase, RDS, and PlanetScale.", priority: "high" },
      { area: "transaction readiness", task: "Make pricing self-serve up to 50 GB without contact-sales.", priority: "low" },
    ],
  },
  {
    id: "fly",
    brandName: "Fly.io",
    brandUrl: "https://fly.io",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.52, positiveShare: 0.61, competitorPresence: 0.55 },
    improvements: [
      { area: "policies", task: "Public SLA + uptime history (incidents page is too quiet).", priority: "high" },
      { area: "proof", task: "Case studies for the 'edge compute beats us-east-1' positioning.", priority: "medium" },
    ],
  },
  {
    id: "anthropic",
    brandName: "Anthropic",
    brandUrl: "https://anthropic.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.86, positiveShare: 0.79, competitorPresence: 0.88 },
    improvements: [
      { area: "policies", task: "Make data-retention & training-data posture more agent-readable.", priority: "high" },
      { area: "pricing", task: "Publish predictable per-1M-tokens pricing comparison vs OpenAI.", priority: "medium" },
    ],
  },
  {
    id: "deepmind-research",
    brandName: "DeepMind",
    brandUrl: "https://deepmind.com",
    domain: "technology",
    region: "europe",
    perception: { mentionRate: 0.81, positiveShare: 0.83, competitorPresence: 0.74 },
    improvements: [
      { area: "transaction readiness", task: "Clarify productisation path for the Gemini API line.", priority: "high" },
    ],
  },
  {
    id: "huggingface",
    brandName: "Hugging Face",
    brandUrl: "https://huggingface.co",
    domain: "technology",
    region: "europe",
    perception: { mentionRate: 0.88, positiveShare: 0.81, competitorPresence: 0.61 },
    improvements: [
      { area: "comparisons", task: "Inference Endpoints vs Modal / Replicate / Fireworks comparison.", priority: "medium" },
      { area: "policies", task: "Surface enterprise security tier requirements in self-serve flow.", priority: "low" },
    ],
  },
  {
    id: "perplexity",
    brandName: "Perplexity",
    brandUrl: "https://perplexity.ai",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.74, positiveShare: 0.67, competitorPresence: 0.72 },
    improvements: [
      { area: "comparisons", task: "Perplexity vs ChatGPT Search agent-readable comparison.", priority: "high" },
      { area: "pricing", task: "Clarify Enterprise vs Pro feature delta.", priority: "medium" },
    ],
  },
  {
    id: "razorpay",
    brandName: "Razorpay",
    brandUrl: "https://razorpay.com",
    domain: "technology",
    region: "south-asia",
    perception: { mentionRate: 0.66, positiveShare: 0.69, competitorPresence: 0.58 },
    improvements: [
      { area: "comparisons", task: "Razorpay vs Stripe-India / Cashfree decision tree.", priority: "high" },
      { area: "docs", task: "Integration time-to-first-payment in the docs hero.", priority: "medium" },
    ],
  },
  {
    id: "zerodha",
    brandName: "Zerodha",
    brandUrl: "https://zerodha.com",
    domain: "finance",
    region: "south-asia",
    perception: { mentionRate: 0.71, positiveShare: 0.78, competitorPresence: 0.52 },
    improvements: [
      { area: "comparisons", task: "Compare Zerodha vs Groww / Upstox / Dhan with fees explicit.", priority: "high" },
      { area: "policies", task: "Surface SEBI compliance + support SLA on the help-center hero.", priority: "low" },
    ],
  },
  {
    id: "shopify",
    brandName: "Shopify",
    brandUrl: "https://shopify.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.93, positiveShare: 0.72, competitorPresence: 0.84 },
    improvements: [
      { area: "comparisons", task: "Plus vs Standard plan side-by-side, with revenue thresholds.", priority: "medium" },
    ],
  },
  {
    id: "datadog",
    brandName: "Datadog",
    brandUrl: "https://datadoghq.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.83, positiveShare: 0.64, competitorPresence: 0.81 },
    improvements: [
      { area: "pricing", task: "Datadog billing surprises are notorious — publish predictable-spend guidance.", priority: "high" },
      { area: "comparisons", task: "Datadog vs Grafana Cloud + Cloudflare Workers observability.", priority: "medium" },
    ],
  },
  {
    id: "cloudflare",
    brandName: "Cloudflare",
    brandUrl: "https://cloudflare.com",
    domain: "technology",
    region: "north-america",
    perception: { mentionRate: 0.92, positiveShare: 0.83, competitorPresence: 0.76 },
    improvements: [
      { area: "docs", task: "Consolidate Workers vs Pages vs OpenNext guidance.", priority: "high" },
    ],
  },
  // --- Startups ----------------------------------------------------------
  {
    id: "ramp",
    brandName: "Ramp",
    brandUrl: "https://ramp.com",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.74, positiveShare: 0.81, competitorPresence: 0.68 },
    improvements: [
      { area: "comparisons", task: "Ramp vs Brex vs Mercury vs Rho comparison page.", priority: "high" },
    ],
  },
  {
    id: "mercury",
    brandName: "Mercury",
    brandUrl: "https://mercury.com",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.71, positiveShare: 0.76, competitorPresence: 0.74 },
    improvements: [
      { area: "policies", task: "Make the partner-bank deposit insurance posture obviously cited.", priority: "high" },
      { area: "transaction readiness", task: "Self-serve flow for non-US founders.", priority: "medium" },
    ],
  },
  {
    id: "clay",
    brandName: "Clay",
    brandUrl: "https://clay.com",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.62, positiveShare: 0.79, competitorPresence: 0.51 },
    improvements: [
      { area: "proof", task: "Customer revenue / pipeline outcomes with numbers, not logos alone.", priority: "high" },
    ],
  },
  {
    id: "attio",
    brandName: "Attio",
    brandUrl: "https://attio.com",
    domain: "startups",
    region: "europe",
    perception: { mentionRate: 0.48, positiveShare: 0.75, competitorPresence: 0.62 },
    improvements: [
      { area: "comparisons", task: "Attio vs HubSpot vs Pipedrive with switching-cost honesty.", priority: "high" },
      { area: "docs", task: "Pre-built workflow library landing page.", priority: "low" },
    ],
  },
  {
    id: "stackblitz",
    brandName: "StackBlitz",
    brandUrl: "https://stackblitz.com",
    domain: "startups",
    region: "europe",
    perception: { mentionRate: 0.45, positiveShare: 0.71, competitorPresence: 0.66 },
    improvements: [
      { area: "comparisons", task: "StackBlitz vs CodeSandbox vs Replit + WebContainers explainer.", priority: "high" },
    ],
  },
  {
    id: "raycast",
    brandName: "Raycast",
    brandUrl: "https://raycast.com",
    domain: "startups",
    region: "europe",
    perception: { mentionRate: 0.61, positiveShare: 0.86, competitorPresence: 0.42 },
    improvements: [
      { area: "policies", task: "Enterprise security posture for team rollouts.", priority: "medium" },
    ],
  },
  {
    id: "warp",
    brandName: "Warp",
    brandUrl: "https://warp.dev",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.56, positiveShare: 0.62, competitorPresence: 0.58 },
    improvements: [
      { area: "policies", task: "Telemetry & data posture is the #1 critique — make it citeable.", priority: "high" },
      { area: "comparisons", task: "Warp vs iTerm2 + Oh-My-Zsh feature comparison.", priority: "medium" },
    ],
  },
  {
    id: "browserbase",
    brandName: "Browserbase",
    brandUrl: "https://browserbase.com",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.39, positiveShare: 0.77, competitorPresence: 0.61 },
    improvements: [
      { area: "comparisons", task: "Browserbase vs Apify vs Playwright cloud comparison.", priority: "high" },
    ],
  },
  {
    id: "instabase",
    brandName: "Instabase",
    brandUrl: "https://instabase.com",
    domain: "startups",
    region: "north-america",
    perception: { mentionRate: 0.31, positiveShare: 0.69, competitorPresence: 0.71 },
    improvements: [
      { area: "positioning", task: "Hero is feature-led; lead with the doc-AI buyer mission.", priority: "high" },
      { area: "proof", task: "Replace logos-only social proof with customer outcomes.", priority: "medium" },
    ],
  },
  {
    id: "rappi",
    brandName: "Rappi",
    brandUrl: "https://rappi.com",
    domain: "startups",
    region: "latam",
    perception: { mentionRate: 0.78, positiveShare: 0.61, competitorPresence: 0.72 },
    improvements: [
      { area: "policies", task: "Driver pay / commission transparency is the recurring complaint.", priority: "high" },
    ],
  },
  {
    id: "nubank",
    brandName: "Nubank",
    brandUrl: "https://nubank.com.br",
    domain: "finance",
    region: "latam",
    perception: { mentionRate: 0.83, positiveShare: 0.79, competitorPresence: 0.66 },
    improvements: [
      { area: "comparisons", task: "Nubank vs Inter vs Itaú decision tree for tech buyers.", priority: "medium" },
    ],
  },
  {
    id: "grab",
    brandName: "Grab",
    brandUrl: "https://grab.com",
    domain: "startups",
    region: "southeast-asia",
    perception: { mentionRate: 0.76, positiveShare: 0.63, competitorPresence: 0.81 },
    improvements: [
      { area: "comparisons", task: "Grab vs Gojek line-by-line, not corporate-speak.", priority: "high" },
    ],
  },
  {
    id: "sea-group",
    brandName: "Sea Group (Shopee)",
    brandUrl: "https://seagroup.com",
    domain: "startups",
    region: "southeast-asia",
    perception: { mentionRate: 0.72, positiveShare: 0.68, competitorPresence: 0.77 },
    improvements: [
      { area: "transaction readiness", task: "Seller-onboarding cost transparency in English.", priority: "medium" },
    ],
  },
  // --- Finance ----------------------------------------------------------
  {
    id: "stripe",
    brandName: "Stripe",
    brandUrl: "https://stripe.com",
    domain: "finance",
    region: "north-america",
    perception: { mentionRate: 0.96, positiveShare: 0.84, competitorPresence: 0.79 },
    improvements: [
      { area: "policies", task: "Make dispute / chargeback policy more agent-readable.", priority: "low" },
    ],
  },
  {
    id: "robinhood",
    brandName: "Robinhood",
    brandUrl: "https://robinhood.com",
    domain: "finance",
    region: "north-america",
    perception: { mentionRate: 0.84, positiveShare: 0.51, competitorPresence: 0.83 },
    improvements: [
      { area: "comparisons", task: "Robinhood vs Fidelity vs Schwab side-by-side on fees + tools.", priority: "high" },
      { area: "policies", task: "Order-flow practices need a clear public explainer.", priority: "high" },
    ],
  },
  {
    id: "wise",
    brandName: "Wise",
    brandUrl: "https://wise.com",
    domain: "finance",
    region: "europe",
    perception: { mentionRate: 0.81, positiveShare: 0.83, competitorPresence: 0.72 },
    improvements: [
      { area: "comparisons", task: "Wise Business vs Revolut Business vs Mercury.", priority: "medium" },
    ],
  },
  {
    id: "revolut",
    brandName: "Revolut",
    brandUrl: "https://revolut.com",
    domain: "finance",
    region: "europe",
    perception: { mentionRate: 0.86, positiveShare: 0.66, competitorPresence: 0.81 },
    improvements: [
      { area: "policies", task: "Account-freeze incident postings are still the recurring critique.", priority: "high" },
    ],
  },
  {
    id: "monzo",
    brandName: "Monzo",
    brandUrl: "https://monzo.com",
    domain: "finance",
    region: "europe",
    perception: { mentionRate: 0.74, positiveShare: 0.81, competitorPresence: 0.69 },
    improvements: [
      { area: "comparisons", task: "Monzo Business vs Starling vs Tide.", priority: "medium" },
    ],
  },
  {
    id: "paytm",
    brandName: "Paytm",
    brandUrl: "https://paytm.com",
    domain: "finance",
    region: "south-asia",
    perception: { mentionRate: 0.76, positiveShare: 0.49, competitorPresence: 0.87 },
    improvements: [
      { area: "policies", task: "RBI compliance posture should be the trust-page lead.", priority: "high" },
      { area: "comparisons", task: "Paytm vs PhonePe vs GooglePay fee + KYC comparison.", priority: "medium" },
    ],
  },
  // --- East Asia ---------------------------------------------------------
  {
    id: "tencent",
    brandName: "Tencent",
    brandUrl: "https://tencent.com",
    domain: "technology",
    region: "east-asia",
    perception: { mentionRate: 0.88, positiveShare: 0.62, competitorPresence: 0.79 },
    improvements: [
      { area: "transaction readiness", task: "Make WeChat Pay onboarding for non-CN merchants legible to agents.", priority: "high" },
    ],
  },
  {
    id: "bytedance",
    brandName: "ByteDance",
    brandUrl: "https://bytedance.com",
    domain: "technology",
    region: "east-asia",
    perception: { mentionRate: 0.92, positiveShare: 0.54, competitorPresence: 0.83 },
    improvements: [
      { area: "policies", task: "Data-localisation posture per market is the recurring question.", priority: "high" },
      { area: "comparisons", task: "TikTok-for-Business vs Meta ads decision tree for SMBs.", priority: "medium" },
    ],
  },
  {
    id: "alibaba-cloud",
    brandName: "Alibaba Cloud",
    brandUrl: "https://www.alibabacloud.com",
    domain: "technology",
    region: "east-asia",
    perception: { mentionRate: 0.71, positiveShare: 0.58, competitorPresence: 0.84 },
    improvements: [
      { area: "comparisons", task: "Alibaba Cloud vs AWS / GCP in SEA market head-to-heads.", priority: "high" },
    ],
  },
  {
    id: "sk-hynix",
    brandName: "SK Hynix",
    brandUrl: "https://www.skhynix.com",
    domain: "technology",
    region: "east-asia",
    perception: { mentionRate: 0.77, positiveShare: 0.74, competitorPresence: 0.71 },
    improvements: [
      { area: "proof", task: "HBM3E customer wins + ramp data deserve a public dashboard.", priority: "medium" },
    ],
  },
  {
    id: "rakuten",
    brandName: "Rakuten",
    brandUrl: "https://global.rakuten.com",
    domain: "startups",
    region: "east-asia",
    perception: { mentionRate: 0.62, positiveShare: 0.61, competitorPresence: 0.68 },
    improvements: [
      { area: "positioning", task: "English-language positioning is unclear vs the JP-market story.", priority: "high" },
    ],
  },
  // --- MENA --------------------------------------------------------------
  {
    id: "careem",
    brandName: "Careem",
    brandUrl: "https://careem.com",
    domain: "startups",
    region: "mena",
    perception: { mentionRate: 0.68, positiveShare: 0.66, competitorPresence: 0.62 },
    improvements: [
      { area: "comparisons", task: "Careem Pay vs STC Pay vs Tabby for UAE/KSA merchants.", priority: "high" },
    ],
  },
  {
    id: "tamara",
    brandName: "Tamara",
    brandUrl: "https://tamara.co",
    domain: "finance",
    region: "mena",
    perception: { mentionRate: 0.41, positiveShare: 0.73, competitorPresence: 0.79 },
    improvements: [
      { area: "proof", task: "Repayment-quality numbers vs Tabby would close the trust gap.", priority: "high" },
    ],
  },
  {
    id: "anghami",
    brandName: "Anghami",
    brandUrl: "https://anghami.com",
    domain: "startups",
    region: "mena",
    perception: { mentionRate: 0.39, positiveShare: 0.69, competitorPresence: 0.81 },
    improvements: [
      { area: "comparisons", task: "Anghami vs Spotify catalogue + artist-payout transparency.", priority: "medium" },
    ],
  },
  // --- Africa ------------------------------------------------------------
  {
    id: "flutterwave",
    brandName: "Flutterwave",
    brandUrl: "https://flutterwave.com",
    domain: "finance",
    region: "africa",
    perception: { mentionRate: 0.64, positiveShare: 0.58, competitorPresence: 0.74 },
    improvements: [
      { area: "policies", task: "Regulator-action history needs an authoritative, dated public log.", priority: "high" },
      { area: "comparisons", task: "Flutterwave vs Paystack vs Cellulant for cross-border SMB merchants.", priority: "medium" },
    ],
  },
  {
    id: "mpesa",
    brandName: "M-Pesa",
    brandUrl: "https://www.safaricom.co.ke/personal/m-pesa",
    domain: "finance",
    region: "africa",
    perception: { mentionRate: 0.79, positiveShare: 0.81, competitorPresence: 0.51 },
    improvements: [
      { area: "docs", task: "Daraja API quickstart could be much friendlier for indie devs.", priority: "medium" },
    ],
  },
  {
    id: "chipper-cash",
    brandName: "Chipper Cash",
    brandUrl: "https://chippercash.com",
    domain: "finance",
    region: "africa",
    perception: { mentionRate: 0.43, positiveShare: 0.61, competitorPresence: 0.72 },
    improvements: [
      { area: "transaction readiness", task: "Self-serve flow for business accounts across NG/KE/UG/RW.", priority: "high" },
    ],
  },
  // --- Oceania -----------------------------------------------------------
  {
    id: "atlassian",
    brandName: "Atlassian",
    brandUrl: "https://atlassian.com",
    domain: "technology",
    region: "oceania",
    perception: { mentionRate: 0.86, positiveShare: 0.58, competitorPresence: 0.82 },
    improvements: [
      { area: "comparisons", task: "Cloud-tier pricing post-Data-Center deprecation needs a clear calculator.", priority: "high" },
    ],
  },
  {
    id: "canva",
    brandName: "Canva",
    brandUrl: "https://canva.com",
    domain: "technology",
    region: "oceania",
    perception: { mentionRate: 0.94, positiveShare: 0.84, competitorPresence: 0.68 },
    improvements: [
      { area: "comparisons", task: "Canva Enterprise vs Figma Slides vs Adobe Express side-by-side.", priority: "medium" },
    ],
  },
  {
    id: "airwallex",
    brandName: "Airwallex",
    brandUrl: "https://airwallex.com",
    domain: "finance",
    region: "oceania",
    perception: { mentionRate: 0.58, positiveShare: 0.74, competitorPresence: 0.71 },
    improvements: [
      { area: "comparisons", task: "Airwallex vs Wise Business vs Mercury for global startups.", priority: "high" },
    ],
  },
];

export function listSeedProducts(filter: { region?: Region } = {}): SeedProduct[] {
  if (!filter.region || filter.region === "global") return SEED_PRODUCTS;
  return SEED_PRODUCTS.filter((p) => p.region === filter.region);
}

export function findSeedProduct(id: string): SeedProduct | undefined {
  return SEED_PRODUCTS.find((p) => p.id === id);
}

/**
 * Curated subset of regions surfaced in the picker (the data model still
 * supports all 10). Sarthak's 2026-05-25 spec: "5-7 regions."
 */
export const DEMO_REGIONS: Region[] = [
  "global",
  "north-america",
  "europe",
  "south-asia",
  "east-asia",
  "southeast-asia",
  "latam",
];
