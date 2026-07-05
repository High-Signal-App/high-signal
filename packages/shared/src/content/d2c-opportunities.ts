/**
 * India D2C Opportunity Pipeline (plan 0013, Slices 1 + 2).
 *
 * 20 hand-curated India D2C niches → deterministic 0–100 opportunity score →
 * `test / watch / avoid` verdict → `OpportunityBriefPayload` rendered in the
 * Daily Brief section 02 and `/opportunities`.
 *
 * The niche seed is static (slug, category, target user, problem, first SKU,
 * risks, next validation step, default scores). The weekly Python collector
 * (`python/ingest/.../d2c_opportunities.py`) refreshes the *evidence mix*
 * (demand / competition / pricing / ad-saturation / momentum) into a dated
 * JSON artifact under `data/d2c-opportunities/`. This module reads the latest
 * artifact when present and falls back to seed-only briefs otherwise.
 *
 * No D1 migration in this slice — JSON artifacts first (PRD option). No
 * impuls8 data is read or redistributed. No paid source dependency.
 */

import type {
  BriefIdeaItem,
  OpportunityBriefPayload,
  OpportunityEvidenceMixItem,
  OpportunityVerdict,
} from "../core/brief";
import type { Region } from "../primitives/region";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Source class for an evidence item — drives the "source diversity" score. */
export type D2CSourceClass =
  | "community" // Reddit / HN / forums
  | "search" // Google Trends (deferred → null)
  | "product" // brand / marketplace / Shopify pages (deferred → null)
  | "review" // public reviews (deferred → null)
  | "ad-library" // Meta Ad Library (deferred → null)
  | "launch" // Product Hunt / news / RSS
  | "agent-visibility"; // ChatGPT/Gemini/Perplexity (Slice 4)

export interface D2CEvidenceItem {
  sourceClass: D2CSourceClass;
  url: string;
  source?: string | null;
  snippet: string;
  observedAt: string; // ISO date
}

/**
 * Per-niche weekly evidence collected by the Python collector. Any field may
 * be `null` when the source is fragile/unavailable — the renderer labels
 * staleness via `freshnessDate`.
 */
export interface D2CNicheEvidence {
  nicheSlug: string;
  /** 0–1 demand momentum from community/search signals. */
  demandScore: number | null;
  /** 0–1 competition gap (1 = wide open, 0 = saturated). */
  competitionScore: number | null;
  /** 0–1 pricing gap (1 = clear opening, 0 = crowded price band). */
  pricingScore: number | null;
  /** 0–1 ad saturation (1 = unsaturated, 0 = saturated). null = unknown. */
  adSaturationScore: number | null;
  /** 0–1 agent-visibility gap (1 = agents silent/generic, 0 = incumbents own). */
  agentVisibilityScore: number | null;
  /** Cited evidence items per source class. */
  evidence: D2CEvidenceItem[];
  /** ISO date when the collector ran. */
  freshnessDate: string;
  /** Free-form notes (compliance flags, observer notes). */
  notes?: string;
}

export interface D2COpportunityArtifact {
  /** ISO date of the run (matches the filename `<YYYY-MM-DD>.json`). */
  generatedAt: string;
  /** "IN" — reserved for future region expansion. */
  region: string;
  niches: D2CNicheEvidence[];
}

export interface D2CNicheSeed {
  slug: string;
  name: string;
  category: string;
  region: Region;
  targetUser: string;
  problem: string;
  firstSku: string;
  risks: string[];
  nextValidationStep: string;
  /** Seed scores used when no weekly artifact exists (conservative). */
  defaultScores: {
    demand: number;
    competition: number;
    pricing: number;
    adSaturation: number | null;
    agentVisibility: number | null;
  };
  /** Reddit subs + keywords the collector queries for this niche. */
  query: {
    subs: string[];
    keywords: string[];
    /** Optional HN keywords (only when a niche has a tech angle). */
    hackernews?: string[];
  };
}

// ---------------------------------------------------------------------------
// Seed: 20 India D2C niches (plan 0013)
// ---------------------------------------------------------------------------

export const D2C_REGION: Region = "south-asia";

export const D2C_NICHE_SEEDS: D2CNicheSeed[] = [
  {
    slug: "hair-growth-scalp-support",
    name: "Hair growth + scalp support",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian men 22-35 seeing early thinning or scalp irritation",
    problem:
      "People search for minoxidil compatibility and irritation support, not generic hair oil; existing ayurvedic oils make unverified claims.",
    firstSku: "A scalp serum with transparent actives (saw palmetto + niacinamide) and a clear minoxidil-compatibility note.",
    risks: [
      "Claims can drift into medical language; keep positioning cosmetic.",
      "Generic 'hair oil' positioning is crowded; the wedge is irritation support.",
      "Retention is uncertain without a subscription ritual.",
    ],
    nextValidationStep:
      "Ship a landing page naming the irritation-support wedge, run 10 interviews in r/IndianSkincare, and open a waitlist.",
    defaultScores: { demand: 0.6, competition: 0.55, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "tressless"],
      keywords: ["hair fall", "scalp irritation", "minoxidil", "dandruff scalp"],
    },
  },
  {
    slug: "lip-intimate-skincare-sensitive",
    name: "Lip + intimate skincare for sensitive skin",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian women 20-40 with sensitive skin avoiding fragrance and common irritants",
    problem:
      "Lip and intimate care products are either medicated (clinical) or heavily fragranced; a sensitive-skin middle ground is thin.",
    firstSku: "A fragrance-free intimate wash with a published ingredient panel and pH claim.",
    risks: [
      "Intimate-care claims attract regulatory scrutiny; wording must stay cosmetic.",
      "Distribution is sensitive; performance marketing channels restrict the category.",
    ],
    nextValidationStep:
      "Interview 10 users from r/IndianSkincare about current substitutes and test a waitlist page with the ingredient panel.",
    defaultScores: { demand: 0.5, competition: 0.6, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "SkincareAddiction"],
      keywords: ["sensitive skin", "intimate wash", "fragrance free", "lip care"],
    },
  },
  {
    slug: "hard-water-hair-care",
    name: "Hard-water hair care",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian urban renters in hard-water cities (Bengaluru, Hyderabad, Chennai)",
    problem:
      "Hard water causes hair fall and dullness complaints; most shampoos are not formulated for chelating calcium/magnesium.",
    firstSku: "A weekly chelating shampoo with a hard-water claim and a clarifying rinse.",
    risks: [
      "Claim needs to stay cosmetic, not medical.",
      "Municipal water data varies; the wedge is city-specific positioning.",
    ],
    nextValidationStep:
      "Run a Bengaluru + Hyderabad landing page test and interview 10 renters about their current routine.",
    defaultScores: { demand: 0.55, competition: 0.65, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "bengaluru"],
      keywords: ["hard water", "hair fall", "shampoo", "chlorine"],
      hackernews: ["hard water hair"],
    },
  },
  {
    slug: "beard-dandruff-beard-scalp",
    name: "Beard dandruff / beard scalp care",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian men 20-35 with beards experiencing flaking and itch",
    problem:
      "Beard dandruff is treated with anti-dandruff shampoo for the scalp, not the beard; beard-specific care is underbuilt.",
    firstSku: "A beard serum + wash duo with anti-flake actives and a beard-comfort claim.",
    risks: ["Cosmetic claim boundary; flaking can signal seborrheic dermatitis."],
    nextValidationStep:
      "Interview 10 bearded users from r/IndianGlowup and test a duo landing page.",
    defaultScores: { demand: 0.5, competition: 0.6, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianGlowup", "IndianSkincare", "beards"],
      keywords: ["beard dandruff", "beard itch", "beard flaking"],
    },
  },
  {
    slug: "post-gym-mens-skin-wipes",
    name: "Post-gym men's skin wipes / sweat care",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian men 20-35 who gym commute and need on-the-go refresh",
    problem:
      "Gym-goers want a sweat-friendly wipe that does not over-dry; existing wipes are baby or facial, not sport-formulated.",
    firstSku: "A individually-wrapped post-gym wipe with salicylic acid and a no-rinse claim.",
    risks: ["Single-use sustainability concern; packaging cost is high."],
    nextValidationStep:
      "Sample at 3 Bengaluru gyms and measure re-order intent via a waitlist.",
    defaultScores: { demand: 0.45, competition: 0.6, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFitness", "IndianGlowup", "fitness"],
      keywords: ["post gym", "sweat", "face wipe", "gym skincare"],
    },
  },
  {
    slug: "delivery-rider-phone-accessories",
    name: "Delivery-rider phone accessories",
    category: "accessories",
    region: D2C_REGION,
    targetUser: "Indian gig delivery riders (Zomato/Swiggy/Zepto) on 8-12 hour shifts",
    problem:
      "Riders kill phones from heat, rain, and mount vibration; existing mounts are car-focused, not gig-shift-rated.",
    firstSku: "A rugged phone mount + rain cover built for 12-hour two-wheeler shifts.",
    risks: ["B2B2C distribution; rider churn limits LTV."],
    nextValidationStep:
      "Pilot with 20 riders in one city and track retention + referral.",
    defaultScores: { demand: 0.55, competition: 0.55, pricing: 0.6, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianStartups", "bengaluru", "SwiggyZomato"],
      keywords: ["phone mount", "delivery rider", "rider phone", "bike mount"],
    },
  },
  {
    slug: "heat-resistant-phone-mounts",
    name: "Heat-resistant phone mounts / commuter accessories",
    category: "accessories",
    region: D2C_REGION,
    targetUser: "Indian two-wheeler commuters in high-heat cities",
    problem:
      "Phone mounts fail in Indian summer heat and monsoon humidity; adhesive and suction mounts melt or slip.",
    firstSku: "A heat-rated (60°C) mechanical clamp mount with a sun-shield lip.",
    risks: ["Hardware capex; returns from fit issues."],
    nextValidationStep:
      "Sell a 100-unit pilot batch in Hyderabad and track returns + reviews.",
    defaultScores: { demand: 0.5, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianStartups", "bengaluru", "motorcycles"],
      keywords: ["phone mount", "heat", "bike mount", "summer"],
      hackernews: ["phone mount heat"],
    },
  },
  {
    slug: "office-chai-healthy-snacks",
    name: "Office chai healthy snacks",
    category: "food",
    region: D2C_REGION,
    targetUser: "Indian office workers 25-40 replacing biscuit + chai with better-for-you",
    problem:
      "Chai-time snacking defaults to sugar-heavy biscuits; protein-fortified or low-GI chai snacks are sparse.",
    firstSku: "A 30g protein chai-biscuit pack with no refined sugar.",
    risks: ["Taste vs health tradeoff; shelf life in Indian humidity."],
    nextValidationStep:
      "Sample at 5 Bengaluru tech offices and measure repeat purchase.",
    defaultScores: { demand: 0.55, competition: 0.45, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFoodAddicts", "IndianFitness", "EatCheapAndHealthy"],
      keywords: ["chai snack", "office snack", "protein biscuit", "healthy snack"],
    },
  },
  {
    slug: "diabetic-friendly-travel-snacks",
    name: "Diabetic-friendly travel snacks",
    category: "food",
    region: D2C_REGION,
    targetUser: "Indian diabetics and pre-diabetics traveling for work",
    problem:
      "Travel snacks for diabetics are either clinical (glucose biscuits) or unavailable; low-GI portable options are thin.",
    firstSku: "A low-GI travel snack pack (roasted millet + nut) with a glycemic claim.",
    risks: ["Medical-adjacent claims; needs conservative wording and labeling."],
    nextValidationStep:
      "Interview 10 diabetic users from r/diabetes and test a travel-pack waitlist.",
    defaultScores: { demand: 0.5, competition: 0.55, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["diabetes", "IndianFoodAddicts", "IndianFitness"],
      keywords: ["diabetic snack", "low gi", "travel snack", "sugar free"],
    },
  },
  {
    slug: "high-protein-regional-snacks",
    name: "High-protein regional snacks",
    category: "food",
    region: D2C_REGION,
    targetUser: "Indian fitness-curious 20-35 wanting regional flavors with protein",
    problem:
      "Protein snacks are chocolate/vanilla imported formats; regional savory formats (khakhra, chivda) with protein are rare.",
    firstSku: "A protein khakhra pack (8g protein) in 2 regional flavors.",
    risks: ["Taste/texture tradeoff; regional flavor fragmentation."],
    nextValidationStep:
      "Launch 2 flavors, sample at 3 gyms, track repeat purchase.",
    defaultScores: { demand: 0.55, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFitness", "IndianFoodAddicts", "FitnessIndia"],
      keywords: ["protein snack", "khakhra", "chivda", "regional snack"],
    },
  },
  {
    slug: "affordable-home-gym-under-5000",
    name: "Affordable home-gym accessories under INR 5,000",
    category: "fitness",
    region: D2C_REGION,
    targetUser: "Indian 20-35 starting home workouts on a tight budget",
    problem:
      "Home-gym kits are either expensive (INR 20k+) or low-quality; a curated under-INR-5k kit is missing.",
    firstSku: "A resistance band + door anchor + ab roller kit under INR 3,000.",
    risks: ["Quality perception vs price; returns from band snap."],
    nextValidationStep:
      "Sell a 100-unit pilot, track returns + 30-day usage.",
    defaultScores: { demand: 0.55, competition: 0.45, pricing: 0.6, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFitness", "fitness", "homegym"],
      keywords: ["home gym", "resistance band", "budget gym", "under 5000"],
    },
  },
  {
    slug: "womens-gym-shorts-fit",
    name: "Women's gym shorts / support and fit",
    category: "apparel",
    region: D2C_REGION,
    targetUser: "Indian women 20-35 lifting or running, frustrated by fit and chafing",
    problem:
      "Women's gym shorts are either imported expensive brands or low-quality local; fit for Indian body shapes + chafe-free is underbuilt.",
    firstSku: "A mid-length compression short with a chafe-free seam and inclusive sizing.",
    risks: ["Sizing/returns complexity; apparel capex."],
    nextValidationStep:
      "Run a fit-survey with 50 women in 3 cities and a pre-order batch.",
    defaultScores: { demand: 0.55, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFitness", "xxfitness", "IndianGlowup"],
      keywords: ["gym shorts", "women fitness", "chafing", "leggings fit"],
    },
  },
  {
    slug: "baby-lotions-transparent-ingredients",
    name: "Baby lotions/oils with transparent ingredients",
    category: "baby-care",
    region: D2C_REGION,
    targetUser: "Indian new parents 25-35 reading ingredient panels",
    problem:
      "Parents want baby lotions without mineral oil, fragrance, and parabens; incumbents still lead with old formulations.",
    firstSku: "A fragrance-free baby lotion with a published ingredient panel and a no-mineral-oil claim.",
    risks: ["Claim boundary; baby-care regulatory scrutiny."],
    nextValidationStep:
      "Interview 10 new parents from r/IndianParents and test a subscription waitlist.",
    defaultScores: { demand: 0.5, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianParents", "NewParents", "IndianSkincare"],
      keywords: ["baby lotion", "mineral oil", "fragrance free", "baby skincare"],
    },
  },
  {
    slug: "ayurvedic-face-care-proof-first",
    name: "Ayurvedic face care with proof-first positioning",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian 22-40 open to ayurveda but skeptical of unverified claims",
    problem:
      "Ayurvedic skincare makes traditional claims without evidence; a proof-first (patch test, panel results) brand is missing.",
    firstSku: "A kumkumadi serum with published patch-test + 28-day panel results.",
    risks: ["Claim boundary; 'ayurvedic' positioning can attract compliance review."],
    nextValidationStep:
      "Publish a panel study and run a waitlist with the proof page.",
    defaultScores: { demand: 0.5, competition: 0.45, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "Ayurveda"],
      keywords: ["ayurvedic skincare", "kumkumadi", "herbal face", "proof"],
    },
  },
  {
    slug: "sustainable-cleaning-laundry-refills",
    name: "Sustainable cleaning/laundry refills",
    category: "home",
    region: D2C_REGION,
    targetUser: "Indian urban renters 25-40 reducing plastic and chemical load",
    problem:
      "Refill-based, low-plastic cleaning products are niche in India; most cleaning is single-use plastic bottles.",
    firstSku: "A laundry refill concentrate (dissolve-at-home) with a refill pouch system.",
    risks: ["Behavior change required; unit economics on refill pouches."],
    nextValidationStep:
      "Pilot a refill subscription in 1 Bengaluru apartment complex.",
    defaultScores: { demand: 0.45, competition: 0.6, pricing: 0.5, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianStartups", "environment", "IndianParents"],
      keywords: ["refill", "sustainable cleaning", "laundry", "plastic free"],
    },
  },
  {
    slug: "pet-health-supplements",
    name: "Pet health supplements",
    category: "pet-care",
    region: D2C_REGION,
    targetUser: "Indian urban pet owners 25-45 spending on pet wellness",
    problem:
      "Pet supplements (joint, coat, gut) are imported and expensive; affordable India-made supplements with vetted formulations are thin.",
    firstSku: "A joint-support supplement for medium dogs with a published ingredient panel.",
    risks: ["Vet endorsement needed; regulatory boundary on health claims."],
    nextValidationStep:
      "Interview 10 pet owners from r/IndianPetFood and pilot with a vet partner.",
    defaultScores: { demand: 0.5, competition: 0.55, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianPetFood", "dogs", "pets"],
      keywords: ["pet supplement", "dog joint", "coat health", "gut"],
    },
  },
  {
    slug: "oral-care-sub-niches",
    name: "Oral care sub-niches",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian 20-40 looking for specific oral care (sensitivity, whitening, gum)",
    problem:
      "Oral care is dominated by Colgate/Pepsodent; sub-niche products (gum care, sensitivity serum) are underbuilt.",
    firstSku: "A gum-care serum (hydroxyapatite + niacinamide) with a sensitivity claim.",
    risks: ["Medical-adjacent claims; dentist endorsement needed."],
    nextValidationStep:
      "Interview 10 users from r/IndianSkincare and test a gum-care waitlist.",
    defaultScores: { demand: 0.45, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "Dentistry"],
      keywords: ["gum care", "sensitivity", "whitening", "oral care"],
    },
  },
  {
    slug: "sleep-stress-support-products",
    name: "Sleep/stress support products",
    category: "wellness",
    region: D2C_REGION,
    targetUser: "Indian 25-45 with sleep/stress issues avoiding pharmaceuticals",
    problem:
      "Sleep products are either pharmaceuticals or unverified herbal; a middle ground (mag glycinate + ashwagandha) with dosing transparency is missing.",
    firstSku: "A sleep-support supplement (magnesium glycenate + ashwagandha) with published doses.",
    risks: ["Supplement regulatory boundary; claims must stay structural, not medical."],
    nextValidationStep:
      "Interview 10 users from r/IndianFitness and test a sleep-diary waitlist.",
    defaultScores: { demand: 0.5, competition: 0.5, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFitness", "sleep", "IndianGlowup"],
      keywords: ["sleep", "ashwagandha", "magnesium", "stress"],
    },
  },
  {
    slug: "intimate-hygiene",
    name: "Intimate hygiene",
    category: "personal-care",
    region: D2C_REGION,
    targetUser: "Indian women 20-40 seeking pH-balanced intimate care without fragrance",
    problem:
      "Intimate hygiene products are either clinical or heavily marketed; a transparent, pH-balanced, fragrance-free line is thin.",
    firstSku: "A daily intimate wash with a published pH and ingredient panel.",
    risks: ["Category advertising restrictions; claim boundary."],
    nextValidationStep:
      "Interview 10 users from r/IndianSkincare and test a subscription waitlist.",
    defaultScores: { demand: 0.5, competition: 0.55, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianSkincare", "IndianGlowup", "TwoXChromosomes"],
      keywords: ["intimate hygiene", "ph balanced", "fragrance free"],
    },
  },
  {
    slug: "condiments-sauces-regional-identity",
    name: "Condiments/sauces with regional identity",
    category: "food",
    region: D2C_REGION,
    targetUser: "Indian 25-45 cooking regional cuisine, frustrated by generic sauces",
    problem:
      "Sauces are either generic (Maggi, Ching's) or imported expensive; region-specific (Chettinad, Naga, Kashmiri) D2C sauces are emerging.",
    firstSku: "A Chettinad curry paste with a regional story and clean ingredient panel.",
    risks: ["Shelf life; regional flavor fragmentation."],
    nextValidationStep:
      "Launch 2 regional sauces, sample at 3 Bengaluru pop-ups, track repeat.",
    defaultScores: { demand: 0.5, competition: 0.55, pricing: 0.55, adSaturation: null, agentVisibility: null },
    query: {
      subs: ["IndianFoodAddicts", "cooking", "IndianCuisine"],
      keywords: ["regional sauce", "chettinad", "naga", "kashmiri", "curry paste"],
    },
  },
];

// ---------------------------------------------------------------------------
// Scoring (deterministic, pure)
// ---------------------------------------------------------------------------

export interface D2CScoreWeights {
  demand: number;
  sourceDiversity: number;
  competition: number;
  pricing: number;
  adSaturation: number;
  agentVisibility: number;
}

export const D2C_SCORE_WEIGHTS: D2CScoreWeights = {
  demand: 30,
  sourceDiversity: 15,
  competition: 20,
  pricing: 15,
  adSaturation: 10,
  agentVisibility: 10,
};

export interface D2CScoreInputs {
  demand: number; // 0–1
  sourceDiversity: number; // 0–1 (fraction of 7 source classes with evidence)
  competition: number; // 0–1 gap (1 = open)
  pricing: number; // 0–1 gap
  adSaturation: number | null; // 0–1 (1 = unsaturated)
  agentVisibility: number | null; // 0–1 gap
}

export interface D2CScoreResult {
  score: number; // 0–100
  inputs: D2CScoreInputs;
  /** True when adSaturation/agentVisibility were null and defaulted to neutral. */
  usedDefaults: boolean;
}

/** Neutral default for null optional scores — keeps the scale comparable. */
const NEUTRAL_OPTIONAL = 0.5;

export function normalizeOptional(value: number | null): number {
  if (value == null || Number.isNaN(value)) return NEUTRAL_OPTIONAL;
  return clamp01(value);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Compute the 0–100 opportunity score from per-dimension inputs.
 * Optional (nullable) inputs default to a neutral 0.5 so the score stays
 * comparable across niches with/without ad-library or agent-visibility data.
 */
export function scoreD2CNiche(inputs: D2CScoreInputs): D2CScoreResult {
  const ad = normalizeOptional(inputs.adSaturation);
  const agent = normalizeOptional(inputs.agentVisibility);
  const usedDefaults =
    inputs.adSaturation == null || inputs.agentVisibility == null;
  const w = D2C_SCORE_WEIGHTS;
  const score = Math.round(
    clamp01(inputs.demand) * w.demand +
      clamp01(inputs.sourceDiversity) * w.sourceDiversity +
      clamp01(inputs.competition) * w.competition +
      clamp01(inputs.pricing) * w.pricing +
      ad * w.adSaturation +
      agent * w.agentVisibility,
  );
  return { score, inputs, usedDefaults };
}

/**
 * Verdict mapping (PRD). `enter` is reserved and never emitted in Slice 1/2.
 *
 * - `test`: demand ≥ 0.5 AND competition gap ≥ 0.4 AND a first SKU exists
 *   AND (source diversity ≥ 0.34 OR agent-visibility gap ≥ 0.5).
 *   The agent-visibility overlay counts as independent corroboration —
 *   a high gap means AI assistants can't name incumbents, which is a
 *   strong wedge signal on its own.
 * - `watch`: demand ≥ 0.3 but missing corroboration.
 * - `avoid`: demand < 0.3 OR competition gap < 0.2.
 * - otherwise `watch`.
 */
export function verdictForScore(inputs: D2CScoreInputs, hasFirstSku: boolean): OpportunityVerdict {
  const demand = clamp01(inputs.demand);
  const competition = clamp01(inputs.competition);
  const diversity = clamp01(inputs.sourceDiversity);
  const agentGap = normalizeOptional(inputs.agentVisibility);
  if (demand < 0.3 || competition < 0.2) return "avoid";
  const hasCorroboration = diversity >= 0.34 || agentGap >= 0.5;
  if (demand >= 0.5 && competition >= 0.4 && hasFirstSku && hasCorroboration) {
    return "test";
  }
  return "watch";
}

/**
 * Confidence band. The agent-visibility overlay counts as one source class
 * — if it has run (gap score is non-null), it's an independent corroboration
 * signal that upgrades confidence from `low` to `medium` even when community
 * evidence is thin.
 */
export function confidenceForDiversity(sourceClassCount: number): "low" | "medium" | "high" {
  if (sourceClassCount >= 4) return "high";
  if (sourceClassCount >= 2) return "medium";
  return "low";
}

/**
 * Confidence band that accounts for the agent-visibility overlay. If the
 * overlay has run (agentVisibilityGap is non-null), it counts as one
 * independent source class, upgrading `low` → `medium`.
 */
export function confidenceForDiversityWithOverlay(
  sourceClassCount: number,
  agentVisibilityGap: number | null,
): "low" | "medium" | "high" {
  const effective = sourceClassCount + (agentVisibilityGap != null ? 1 : 0);
  return confidenceForDiversity(effective);
}

// ---------------------------------------------------------------------------
// Composing Opportunity Brief payloads
// ---------------------------------------------------------------------------

const ALL_SOURCE_CLASSES: D2CSourceClass[] = [
  "community",
  "search",
  "product",
  "review",
  "ad-library",
  "launch",
  "agent-visibility",
];

/** Distinct source classes present in the evidence list (drives diversity score). */
export function distinctSourceClasses(evidence: D2CEvidenceItem[]): number {
  const present = new Set<D2CSourceClass>();
  for (const item of evidence) present.add(item.sourceClass);
  return present.size;
}

/** Fraction of the 7 evidence-bearing source classes with at least one item. */
export function sourceDiversityFraction(evidence: D2CEvidenceItem[]): number {
  if (evidence.length === 0) return 0;
  return distinctSourceClasses(evidence) / ALL_SOURCE_CLASSES.length;
}

function evidenceMixFromNiche(
  seed: D2CNicheSeed,
  evidence: D2CEvidenceItem[],
): OpportunityEvidenceMixItem[] {
  const byClass = new Map<D2CSourceClass, D2CEvidenceItem[]>();
  for (const item of evidence) {
    const list = byClass.get(item.sourceClass) ?? [];
    list.push(item);
    byClass.set(item.sourceClass, list);
  }
  const items: OpportunityEvidenceMixItem[] = [];
  const demandItems = byClass.get("community") ?? byClass.get("search") ?? [];
  if (demandItems.length) {
    items.push({
      kind: "demand",
      label: "community / search demand",
      summary: demandItems[0]?.snippet?.slice(0, 160) ?? "Cited community demand.",
      strength: demandItems.length >= 3 ? "high" : demandItems.length >= 1 ? "medium" : "low",
      sourceCount: demandItems.length,
    });
  }
  const launchItems = byClass.get("launch") ?? [];
  if (launchItems.length) {
    items.push({
      kind: "momentum",
      label: "new entrants / launches",
      summary: launchItems[0]?.snippet?.slice(0, 160) ?? "Recent launches observed.",
      strength: launchItems.length >= 2 ? "medium" : "low",
      sourceCount: launchItems.length,
    });
  }
  // Always include competition/pricing/agent-visibility placeholders so the
  // renderer shows the full decision shape even before the collector fills
  // them in. They are clearly labelled as "not yet extracted".
  items.push({
    kind: "competition",
    label: "competition gap",
    summary: byClass.has("product")
      ? "Substitute density sampled from public product pages."
      : "Substitute density not yet extracted; validate manually before entering.",
    strength: byClass.has("product") ? "medium" : "low",
    sourceCount: (byClass.get("product") ?? []).length,
  });
  items.push({
    kind: "pricing",
    label: "pricing gap",
    summary: byClass.has("product")
      ? "Visible price band sampled from public product pages."
      : "Price band not yet extracted; test willingness to pay before sizing.",
    strength: byClass.has("product") ? "medium" : "low",
    sourceCount: (byClass.get("product") ?? []).length,
  });
  items.push({
    kind: "agent-visibility",
    label: "agent visibility gap",
    summary: byClass.has("agent-visibility")
      ? "AI assistants sampled for category recommendations."
      : "Run an agent-answer snapshot for this category (Slice 4).",
    strength: byClass.has("agent-visibility") ? "medium" : "low",
    sourceCount: (byClass.get("agent-visibility") ?? []).length,
  });
  void seed;
  return items;
}

function evidenceUrlsFromNiche(evidence: D2CEvidenceItem[]): { url: string; source?: string }[] {
  return evidence.slice(0, 5).map((item) => ({
    url: item.url,
    source: item.source ?? undefined,
  }));
}

/**
 * Compose a single India D2C Opportunity Brief payload from a niche seed and
 * optional weekly evidence. When `evidence` is missing, conservative seed
 * defaults are used and the verdict leans `watch`.
 */
export function composeD2COpportunityBrief(
  seed: D2CNicheSeed,
  evidence?: D2CNicheEvidence | null,
  agentVisibilityGap?: number | null,
): OpportunityBriefPayload {
  const evList = evidence?.evidence ?? [];
  const diversity = sourceDiversityFraction(evList);
  const avGap = agentVisibilityGap ?? evidence?.agentVisibilityScore ?? seed.defaultScores.agentVisibility;
  const inputs: D2CScoreInputs = {
    demand: evidence?.demandScore ?? seed.defaultScores.demand,
    sourceDiversity: diversity,
    competition: evidence?.competitionScore ?? seed.defaultScores.competition,
    pricing: evidence?.pricingScore ?? seed.defaultScores.pricing,
    adSaturation: evidence?.adSaturationScore ?? seed.defaultScores.adSaturation,
    agentVisibility: avGap,
  };
  const verdict = verdictForScore(inputs, Boolean(seed.firstSku));
  const confidence = confidenceForDiversityWithOverlay(distinctSourceClasses(evList), avGap);
  const score = scoreD2CNiche(inputs).score;
  const marketTimingReasons = [
    evidence
      ? `Weekly collector ran on ${evidence.freshnessDate.slice(0, 10)}; ${evList.length} cited items across ${distinctSourceClasses(evList)} source class(es).`
      : "No weekly artifact yet — brief uses conservative seed scores; treat as a watchlist item until corroborated.",
    "India D2C: validate with region-specific interviews and a landing page before sizing inventory or ads.",
  ];
  const evidenceMix = evidenceMixFromNiche(seed, evList);
  const competitorNotes = [
    evidence?.competitionScore != null
      ? `Competition gap: ${(evidence.competitionScore * 100).toFixed(0)}/100 (1 = open, 0 = saturated).`
      : "Competition gap not yet measured; map 3-5 substitutes before building.",
  ];
  const pricingNotes = [
    evidence?.pricingScore != null
      ? `Pricing gap: ${(evidence.pricingScore * 100).toFixed(0)}/100.`
      : "Pricing gap not yet measured; test willingness to pay with a landing page.",
  ];
  const agentVisibilityNotes = [
    avGap != null
      ? `Agent visibility gap: ${(avGap * 100).toFixed(0)}/100 — ${avGap >= 0.5 ? "AI assistants can't name incumbents; wide-open for brand-building." : avGap >= 0.2 ? "AI assistants name a few brands but the field is not locked." : "AI assistants recommend established incumbents; differentiation needed."}`
      : "Run an agent-answer snapshot for this category (Slice 4) to see whether recommendations are generic or incumbent-led.",
  ];
  const risks = seed.risks.slice();
  if (evidence == null) {
    risks.push("No weekly artifact yet — evidence is seed-only; corroborate before acting.");
  }
  return {
    verdict,
    confidence,
    targetUser: seed.targetUser,
    problem: seed.problem,
    marketTimingReasons,
    evidenceMix,
    competitorNotes,
    pricingNotes,
    agentVisibilityNotes,
    risks,
    nextValidationStep: seed.nextValidationStep,
    priorHitRate: {
      label: "india-d2c-opportunity family",
      hitRate: null,
      sample: 0,
      band: "none",
    },
  };
  void score; // score is exposed via the artifact, not the brief payload
}

// ---------------------------------------------------------------------------
// BriefIdeaItem[] builder (used by the worker + /opportunities)
// ---------------------------------------------------------------------------

function findEvidenceForNiche(
  artifact: D2COpportunityArtifact | null,
  slug: string,
): D2CNicheEvidence | null {
  if (!artifact) return null;
  return artifact.niches.find((n) => n.nicheSlug === slug) ?? null;
}

/**
 * Build `BriefIdeaItem[]` for the India D2C pipeline. The caller decides how
 * many to take and which region to scope to.
 *
 * @param region  Only `south-asia` (full list) and `global` (rotating 1) are
 *                supported in Slice 1/2. Other regions return `[]`.
 * @param limit   Max items to return.
 * @param artifact  Optional weekly collector artifact. When null, seed-only
 *                  briefs are emitted.
 * @param rotateFor  (global only) which index to surface — typically the day
 *                   of week so the global brief rotates through niches.
 */
export function d2cBriefItems(
  region: Region,
  limit: number,
  artifact: D2COpportunityArtifact | null = null,
  rotateFor = 0,
): BriefIdeaItem[] {
  if (region !== "south-asia" && region !== "global") return [];
  if (D2C_NICHE_SEEDS.length === 0) return [];
  let pool = D2C_NICHE_SEEDS;
  if (region === "global") {
    // Rotate one niche per day so the global brief shows variety without
    // flooding section 02 with India-only items.
    const idx = ((rotateFor % D2C_NICHE_SEEDS.length) + D2C_NICHE_SEEDS.length) % D2C_NICHE_SEEDS.length;
    pool = [D2C_NICHE_SEEDS[idx]!];
  }
  const surfacedAt = artifact?.generatedAt ?? new Date().toISOString();
  return pool.slice(0, limit).map((seed) => {
    const evidence = findEvidenceForNiche(artifact, seed.slug);
    return {
      title: `India D2C: ${seed.name}`,
      description: seed.problem,
      source: "opportunity" as const,
      region: seed.region,
      subreddit: seed.query.subs[0] ?? null,
      surfacedAt,
      evidenceUrls: evidenceUrlsFromNiche(evidence?.evidence ?? []),
      opportunity: composeD2COpportunityBrief(seed, evidence),
    };
  });
}

// ---------------------------------------------------------------------------
// Artifact loader (build-time bundle for the worker; fs read for scripts)
// ---------------------------------------------------------------------------

/**
 * Load the latest dated `data/d2c-opportunities/<YYYY-MM-DD>.json` artifact.
 * Returns `null` when the directory is empty or missing — the caller falls
 * back to seed-only briefs.
 *
 * This function is intended to run at build time (worker bundle) or in Node
 * scripts. It is not invoked inside the Worker runtime.
 */
export async function loadLatestD2CArtifact(
  dir: string,
  fsImpl: {
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
  },
): Promise<D2COpportunityArtifact | null> {
  let names: string[];
  try {
    names = await fsImpl.readdir(dir);
  } catch {
    return null;
  }
  const dated = names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  if (dated.length === 0) return null;
  try {
    const raw = await fsImpl.readFile(`${dir}/${dated[0]}`);
    return JSON.parse(raw) as D2COpportunityArtifact;
  } catch {
    return null;
  }
}

/**
 * Load the latest agent-visibility overlay artifact from a directory of
 * dated JSON files (`data/d2c-agent-visibility/<YYYY-MM-DD>.json`).
 * Returns `null` if the directory doesn't exist or no dated file is found.
 */
export async function loadLatestAgentVisibilityArtifact(
  dir: string,
  fsImpl: {
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
  },
): Promise<D2CAgentVisibilityArtifact | null> {
  let names: string[];
  try {
    names = await fsImpl.readdir(dir);
  } catch {
    return null;
  }
  const dated = names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  if (dated.length === 0) return null;
  try {
    const raw = await fsImpl.readFile(`${dir}/${dated[0]}`);
    return JSON.parse(raw) as D2CAgentVisibilityArtifact;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slice 3 — history: score deltas, verdict changes, aging
// ---------------------------------------------------------------------------

/**
 * A stored weekly snapshot (mirrors a `d2c_niche_snapshots` row). The sync
 * script produces these from JSON artifacts; the renderer reads them back to
 * show score deltas, verdict changes, and whether prior calls aged well.
 */
export interface D2CNicheSnapshotRecord {
  nicheSlug: string;
  snapshotDate: string; // ISO date (YYYY-MM-DD)
  opportunityScore: number;
  demandScore: number | null;
  competitionScore: number | null;
  pricingScore: number | null;
  adSaturationScore: number | null;
  agentVisibilityScore: number | null;
  sourceDiversity: number;
  verdict: OpportunityVerdict;
  confidence: "low" | "medium" | "high";
  freshnessDate: string;
}

/** Comparison of two consecutive snapshots for one niche. */
export interface D2CNicheDelta {
  nicheSlug: string;
  /** Previous snapshot date (null when this is the first run). */
  previousDate: string | null;
  currentDate: string;
  scoreDelta: number | null; // current - previous (null when no previous)
  verdictChanged: boolean;
  previousVerdict: OpportunityVerdict | null;
  currentVerdict: OpportunityVerdict;
  /** "improved" | "degraded" | "stable" | "new" — for the renderer's tone. */
  trend: "improved" | "degraded" | "stable" | "new";
}

/**
 * Compute the delta between two consecutive snapshots. Pure function — the
 * caller sorts the snapshot list by date and passes adjacent pairs.
 */
export function computeD2CDelta(
  current: D2CNicheSnapshotRecord,
  previous: D2CNicheSnapshotRecord | null,
): D2CNicheDelta {
  if (!previous) {
    return {
      nicheSlug: current.nicheSlug,
      previousDate: null,
      currentDate: current.snapshotDate,
      scoreDelta: null,
      verdictChanged: false,
      previousVerdict: null,
      currentVerdict: current.verdict,
      trend: "new",
    };
  }
  const scoreDelta = current.opportunityScore - previous.opportunityScore;
  const verdictChanged = current.verdict !== previous.verdict;
  let trend: D2CNicheDelta["trend"] = "stable";
  if (verdictChanged) {
    trend = verdictImproved(current.verdict, previous.verdict) ? "improved" : "degraded";
  } else if (scoreDelta > 0) {
    trend = "improved";
  } else if (scoreDelta < 0) {
    trend = "degraded";
  }
  return {
    nicheSlug: current.nicheSlug,
    previousDate: previous.snapshotDate,
    currentDate: current.snapshotDate,
    scoreDelta,
    verdictChanged,
    previousVerdict: previous.verdict,
    currentVerdict: current.verdict,
    trend,
  };
}

/** Verdict ranking for "did this niche improve?" — enter > test > watch > avoid. */
const VERDICT_RANK: Record<OpportunityVerdict, number> = {
  enter: 4,
  test: 3,
  watch: 2,
  avoid: 1,
};

export function verdictImproved(
  current: OpportunityVerdict,
  previous: OpportunityVerdict,
): boolean {
  return VERDICT_RANK[current] > VERDICT_RANK[previous];
}

/**
 * Aging check — did a prior `test`/`watch`/`avoid` call age well? Compares
 * the verdict at `priorDate` against the current verdict. A `test` that
 * stayed `test` or moved to `enter` aged well; a `test` that dropped to
 * `avoid` aged poorly. Returns one of `aged-well` / `aged-poorly` / `stable`
 * / `insufficient-history`.
 */
export type D2CAgingVerdict = "aged-well" | "aged-poorly" | "stable" | "insufficient-history";

export function assessAging(
  current: D2CNicheSnapshotRecord,
  history: D2CNicheSnapshotRecord[],
): D2CAgingVerdict {
  if (history.length < 2) return "insufficient-history";
  // Find the earliest snapshot for this niche (the "prior call").
  const prior = history
    .filter((s) => s.nicheSlug === current.nicheSlug)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))[0];
  if (!prior || prior.snapshotDate === current.snapshotDate) {
    return "insufficient-history";
  }
  if (prior.verdict === current.verdict) return "stable";
  return verdictImproved(current.verdict, prior.verdict) ? "aged-well" : "aged-poorly";
}

/**
 * Build a snapshot record from a niche seed + weekly evidence (the sync
 * script uses this before inserting into `d2c_niche_snapshots`).
 */
export function buildSnapshotRecord(
  seed: D2CNicheSeed,
  evidence: D2CNicheEvidence | null,
  snapshotDate: string,
  agentVisibilityGap?: number | null,
): D2CNicheSnapshotRecord {
  const evList = evidence?.evidence ?? [];
  const diversity = sourceDiversityFraction(evList);
  // The agent-visibility overlay runs separately from the weekly collector.
  // If the caller passes a gap score (from the overlay), use it instead of
  // the evidence's agentVisibilityScore (which is usually null on first run).
  const avGap = agentVisibilityGap ?? evidence?.agentVisibilityScore ?? seed.defaultScores.agentVisibility;
  const inputs: D2CScoreInputs = {
    demand: evidence?.demandScore ?? seed.defaultScores.demand,
    sourceDiversity: diversity,
    competition: evidence?.competitionScore ?? seed.defaultScores.competition,
    pricing: evidence?.pricingScore ?? seed.defaultScores.pricing,
    adSaturation: evidence?.adSaturationScore ?? seed.defaultScores.adSaturation,
    agentVisibility: avGap,
  };
  const score = scoreD2CNiche(inputs).score;
  const verdict = verdictForScore(inputs, Boolean(seed.firstSku));
  const confidence = confidenceForDiversityWithOverlay(distinctSourceClasses(evList), avGap);
  return {
    nicheSlug: seed.slug,
    snapshotDate,
    opportunityScore: score,
    demandScore: evidence?.demandScore ?? seed.defaultScores.demand,
    competitionScore: evidence?.competitionScore ?? seed.defaultScores.competition,
    pricingScore: evidence?.pricingScore ?? seed.defaultScores.pricing,
    adSaturationScore: evidence?.adSaturationScore ?? seed.defaultScores.adSaturation,
    agentVisibilityScore: avGap,
    sourceDiversity: diversity,
    verdict,
    confidence,
    freshnessDate: evidence?.freshnessDate ?? snapshotDate,
  };
}

/**
 * Compute deltas for a full snapshot history. Returns one delta per niche
 * (the most recent change). Pure function — used by the renderer and tests.
 */
export function computeD2CDeltas(
  history: D2CNicheSnapshotRecord[],
): D2CNicheDelta[] {
  // Group by niche, sort each group ascending by date, take the last pair.
  const byNiche = new Map<string, D2CNicheSnapshotRecord[]>();
  for (const snap of history) {
    const list = byNiche.get(snap.nicheSlug) ?? [];
    list.push(snap);
    byNiche.set(snap.nicheSlug, list);
  }
  const deltas: D2CNicheDelta[] = [];
  for (const [slug, snaps] of byNiche) {
    snaps.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    const current = snaps[snaps.length - 1]!;
    const previous = snaps.length >= 2 ? snaps[snaps.length - 2]! : null;
    deltas.push(computeD2CDelta(current, previous));
    void slug;
  }
  return deltas;
}

// ---------------------------------------------------------------------------
// Slice 4 — agent-visibility overlay
// ---------------------------------------------------------------------------

/**
 * A single AI-assistant answer for a niche's category prompt. The runner
 * asks each configured platform "What are the best <category> brands in India
 * for <target user>?" and records which brands are recommended + cited.
 */
export interface D2CAgentVisibilityEntry {
  nicheSlug: string;
  platform: string;
  model: string;
  promptText: string;
  responseText: string;
  recommendedBrands: string[];
  citedUrls: string[];
  brandMentioned: boolean;
  /** 0–1 gap: 1 = no brand recommended (wide-open opportunity), 0 = saturated. */
  gapScore: number;
  runDate: string; // ISO date
}

export interface D2CAgentVisibilityArtifact {
  generatedAt: string;
  region: string;
  entries: D2CAgentVisibilityEntry[];
}

/**
 * Build the category prompt for a niche. The prompt is deliberately
 * open-ended ("What are the best…?") so we measure what AI assistants
 * *volunteer*, not what they recall when primed with a brand name.
 */
export function buildAgentVisibilityPrompt(seed: D2CNicheSeed): string {
  return (
    `What are the best ${seed.category} brands in India for ${seed.targetUser}? ` +
    `List the top 3-5 options with a one-line reason for each, and cite any ` +
    `sources you rely on. Focus on products that solve: ${seed.problem}`
  );
}

/**
 * Naively extract brand names from an AI answer. Looks for numbered-list
 * patterns ("1. BrandName —"), bold headers, or the first capitalized
 * phrase on each line. Conservative — better to miss a brand than invent one.
 */
export function extractRecommendedBrands(responseText: string): string[] {
  const brands = new Set<string>();
  const lines = responseText.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Numbered list: "1. BrandName — reason" or "1) BrandName: reason"
    const numbered = trimmed.match(/^\d+[\.\)]\s*\*{0,2}([A-Z][\w&\- ]{1,40}?)\*{0,2}\s*[—:\-–]/);
    if (numbered) {
      brands.add(numbered[1]!.trim());
      continue;
    }
    // Bold header: "**BrandName**: reason" or "**BrandName** — reason"
    const bold = trimmed.match(/^\*{2}([A-Z][\w&\- ]{1,40}?)\*{2}\s*[—:\-–]/);
    if (bold) {
      brands.add(bold[1]!.trim());
      continue;
    }
    // Bullet with a capitalized lead phrase ending in a dash/colon
    const bullet = trimmed.match(/^[-•]\s*\*{0,2}([A-Z][\w&\- ]{1,40}?)\*{0,2}\s*[—:\-–]/);
    if (bullet) {
      brands.add(bullet[1]!.trim());
    }
  }
  return Array.from(brands).slice(0, 8);
}

/** Extract URLs from an AI answer (citations). */
export function extractCitedUrls(responseText: string): string[] {
  const urls = new Set<string>();
  const urlRegex = /https?:\/\/[^\s\)"'<>\]]+/g;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(responseText)) !== null) {
    // Strip trailing punctuation that's not part of the URL.
    const url = match[0]!.replace(/[.,;:!?]+$/, "");
    urls.add(url);
  }
  return Array.from(urls);
}

/**
 * Compute the agent-visibility gap score for a niche. 1 = no brand
 * recommended (wide-open opportunity — AI assistants have no answer), 0 =
 * saturated (multiple well-known brands recommended). The intuition: if AI
 * assistants can't name a single brand in a category, a new D2C brand that
 * gets cited has an outsized moat.
 */
export function agentVisibilityGapScore(recommendedBrands: string[]): number {
  if (recommendedBrands.length === 0) return 1; // wide open
  if (recommendedBrands.length === 1) return 0.7;
  if (recommendedBrands.length === 2) return 0.4;
  if (recommendedBrands.length === 3) return 0.2;
  return 0; // saturated (4+ brands recommended)
}
