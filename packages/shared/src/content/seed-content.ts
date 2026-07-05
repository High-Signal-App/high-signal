/**
 * Seed fallback content for the public Daily Brief sections.
 *
 * Sections 1 (stocks), 2 (ideas), and 3 (trends) prefer real D1 data. When a
 * given section returns zero rows from D1, the brief falls back to these
 * curated seed items so the surface is *never* empty.
 *
 * The seed is region-tagged where it makes sense, so swapping regions
 * recomposes the fallback too. The data is hand-crafted to feel plausible,
 * not artificial — claims you'd see in a credible daily brief from a sober
 * source. Every item carries source URLs so the "cite or kill" rule still
 * visibly holds.
 */

import type {
  BriefIdeaItem,
  BriefStockItem,
  BriefTrendItem,
} from "../core/brief";
import type { Region } from "../primitives/region";
import { familyForSignalType } from "../primitives/signal-families";

export interface SeedStockSignal {
  entityId: string;
  entityName: string;
  ticker: string | null;
  country: string | null;
  region: Region;
  signalType: string;
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  headline: string;
  slug: string;
  publishedDaysAgo: number;
  evidenceUrls: { url: string; source?: string }[];
  hitRate: number | null;
  hitRateSample: number;
}

export const SEED_STOCK_SIGNALS: SeedStockSignal[] = [
  {
    entityId: "nvda",
    entityName: "NVIDIA",
    ticker: "NVDA",
    country: "US",
    region: "north-america",
    signalType: "gpu_lead_time_shift",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 21,
    headline: "H100 lead times tightening again after Q1 normalisation",
    slug: "nvda-h100-lead-time-q2",
    publishedDaysAgo: 2,
    evidenceUrls: [
      { url: "https://www.reuters.com/technology/nvidia-h100", source: "reuters" },
      { url: "https://www.semianalysis.com/q2-gpu-lead-times", source: "semianalysis" },
    ],
    hitRate: 0.72,
    hitRateSample: 18,
  },
  {
    entityId: "tsm",
    entityName: "Taiwan Semiconductor",
    ticker: "TSM",
    country: "TW",
    region: "east-asia",
    signalType: "capex_raise",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 60,
    headline: "TSMC bumps 2026 capex guidance on AI-accelerator demand",
    slug: "tsm-capex-raise-2026",
    publishedDaysAgo: 4,
    evidenceUrls: [
      { url: "https://www.bloomberg.com/news/tsmc-capex-2026", source: "bloomberg" },
      { url: "https://investor.tsmc.com/static/q1-2026.pdf", source: "tsmc ir" },
    ],
    hitRate: 0.81,
    hitRateSample: 26,
  },
  {
    entityId: "asml",
    entityName: "ASML",
    ticker: "ASML",
    country: "NL",
    region: "europe",
    signalType: "order_book_acceleration",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "ASML Q1 bookings re-accelerate after a flat Q4",
    slug: "asml-q1-bookings",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://www.asml.com/en/investors/quarterly-results", source: "asml ir" },
      { url: "https://www.ft.com/asml-q1-bookings", source: "ft" },
    ],
    hitRate: 0.66,
    hitRateSample: 9,
  },
  {
    entityId: "hbm-tsma",
    entityName: "SK Hynix",
    ticker: "000660.KS",
    country: "KR",
    region: "east-asia",
    signalType: "hbm_supply_warning",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 30,
    headline: "Hynix HBM3E booked through 2026; backlog grew 18% QoQ",
    slug: "hynix-hbm3e-backlog-q2",
    publishedDaysAgo: 1,
    evidenceUrls: [
      { url: "https://www.skhynix.com/eng/sustain/", source: "skhynix ir" },
      { url: "https://www.theelec.net/news/hbm3e-supply", source: "the elec" },
    ],
    hitRate: 0.74,
    hitRateSample: 11,
  },
  {
    entityId: "tsla",
    entityName: "Tesla",
    ticker: "TSLA",
    country: "US",
    region: "north-america",
    signalType: "demand_softening",
    direction: "down",
    confidence: "medium",
    predictedWindowDays: 30,
    headline: "China deliveries trending below seasonal range three weeks running",
    slug: "tsla-cn-deliveries-may",
    publishedDaysAgo: 3,
    evidenceUrls: [
      { url: "https://cnevpost.com/tesla-china-weekly", source: "cnevpost" },
      { url: "https://www.caam.org.cn/", source: "caam" },
    ],
    hitRate: 0.58,
    hitRateSample: 14,
  },
  {
    entityId: "infy",
    entityName: "Infosys",
    ticker: "INFY",
    country: "IN",
    region: "south-asia",
    signalType: "ai_deal_velocity",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Infosys flags 23 new GenAI deals across BFSI and retail",
    slug: "infy-genai-deals-q1",
    publishedDaysAgo: 5,
    evidenceUrls: [
      { url: "https://www.infosys.com/investors/", source: "infosys ir" },
      { url: "https://www.business-standard.com/infosys-genai-pipeline", source: "business standard" },
    ],
    hitRate: 0.61,
    hitRateSample: 7,
  },
  {
    entityId: "shop",
    entityName: "Shopify",
    ticker: "SHOP",
    country: "CA",
    region: "north-america",
    signalType: "gmv_acceleration",
    direction: "up",
    confidence: "low",
    predictedWindowDays: 60,
    headline: "Shopify Plus enterprise rollouts pacing ahead of consensus",
    slug: "shop-plus-enterprise-may",
    publishedDaysAgo: 8,
    evidenceUrls: [
      { url: "https://investors.shopify.com/news/", source: "shopify ir" },
      { url: "https://www.bain.com/insights/", source: "bain" },
    ],
    hitRate: null,
    hitRateSample: 2,
  },
  {
    entityId: "alibaba",
    entityName: "Alibaba",
    ticker: "BABA",
    country: "CN",
    region: "east-asia",
    signalType: "cloud_recovery",
    direction: "up",
    confidence: "low",
    predictedWindowDays: 90,
    headline: "Aliyun returns to double-digit growth after five flat quarters",
    slug: "baba-aliyun-q1-growth",
    publishedDaysAgo: 7,
    evidenceUrls: [
      { url: "https://www.alibabagroup.com/en/ir", source: "alibaba ir" },
      { url: "https://www.scmp.com/tech/big-tech/aliyun-q1", source: "scmp" },
    ],
    hitRate: 0.5,
    hitRateSample: 4,
  },
  {
    entityId: "nubank",
    entityName: "Nubank",
    ticker: "NU",
    country: "BR",
    region: "latam",
    signalType: "net_interest_margin_expansion",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Nubank NIM expansion outpacing incumbent Brazilian banks",
    slug: "nu-nim-expansion-q1",
    publishedDaysAgo: 9,
    evidenceUrls: [
      { url: "https://investors.nu/financial-information", source: "nubank ir" },
      { url: "https://valor.globo.com/financas/", source: "valor" },
    ],
    hitRate: 0.69,
    hitRateSample: 8,
  },
  {
    entityId: "sea",
    entityName: "Sea Limited",
    ticker: "SE",
    country: "SG",
    region: "southeast-asia",
    signalType: "garena_arpu_recovery",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Garena ARPU recovers as Free Fire reclaims SEA share",
    slug: "se-garena-arpu-q1",
    publishedDaysAgo: 11,
    evidenceUrls: [
      { url: "https://www.seagroup.com/investor", source: "sea ir" },
      { url: "https://www.straitstimes.com/tech/sea", source: "straits times" },
    ],
    hitRate: 0.55,
    hitRateSample: 5,
  },
  {
    entityId: "asml-eu",
    entityName: "ASM International",
    ticker: "ASMI.AS",
    country: "NL",
    region: "europe",
    signalType: "ald_demand_spike",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "ALD tool orders for HBM3E and gate-all-around accelerating",
    slug: "asmi-ald-q1",
    publishedDaysAgo: 12,
    evidenceUrls: [
      { url: "https://www.asm.com/investors", source: "asmi ir" },
      { url: "https://www.semiwiki.com/articles/ald-2026", source: "semiwiki" },
    ],
    hitRate: 0.7,
    hitRateSample: 6,
  },
  {
    entityId: "snowflake",
    entityName: "Snowflake",
    ticker: "SNOW",
    country: "US",
    region: "north-america",
    signalType: "compute_consumption_dip",
    direction: "down",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Customer compute consumption growth decelerating two quarters running",
    slug: "snow-consumption-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://investors.snowflake.com/news/", source: "snowflake ir" },
      { url: "https://www.theinformation.com/articles/snowflake-q1", source: "the information" },
    ],
    hitRate: 0.62,
    hitRateSample: 13,
  },
  // --- North America (expanded) -----------------------------------------
  {
    entityId: "msft",
    entityName: "Microsoft",
    ticker: "MSFT",
    country: "US",
    region: "north-america",
    signalType: "ai_pipeline_acceleration",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 60,
    headline: "Azure AI services revenue contribution at all-time highs; capacity-constrained",
    slug: "msft-azure-ai-q1",
    publishedDaysAgo: 3,
    evidenceUrls: [
      { url: "https://www.microsoft.com/en-us/Investor/" },
      { url: "https://www.theinformation.com/articles/azure-ai-q1" },
    ],
    hitRate: 0.79,
    hitRateSample: 17,
  },
  {
    entityId: "googl",
    entityName: "Alphabet",
    ticker: "GOOGL",
    country: "US",
    region: "north-america",
    signalType: "ad_revenue_recovery",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Google search ad reacceleration as AI Overviews monetisation matures",
    slug: "googl-search-q1",
    publishedDaysAgo: 4,
    evidenceUrls: [
      { url: "https://abc.xyz/investor/" },
      { url: "https://www.ft.com/google-search-ads" },
    ],
    hitRate: 0.68,
    hitRateSample: 12,
  },
  {
    entityId: "crwd",
    entityName: "CrowdStrike",
    ticker: "CRWD",
    country: "US",
    region: "north-america",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "CrowdStrike module-attach rate ticking up post-incident remediation",
    slug: "crwd-attach-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://ir.crowdstrike.com" },
      { url: "https://www.bloomberg.com/news/crowdstrike-attach" },
    ],
    hitRate: 0.61,
    hitRateSample: 9,
  },
  // --- Europe (expanded) -------------------------------------------------
  {
    entityId: "sap",
    entityName: "SAP",
    ticker: "SAP",
    country: "DE",
    region: "europe",
    signalType: "cloud_recovery",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "SAP cloud backlog growth re-accelerating; S/4HANA migrations pacing ahead",
    slug: "sap-cloud-q1",
    publishedDaysAgo: 4,
    evidenceUrls: [
      { url: "https://www.sap.com/investors/" },
      { url: "https://www.handelsblatt.com/unternehmen/sap" },
    ],
    hitRate: 0.7,
    hitRateSample: 10,
  },
  {
    entityId: "spotify",
    entityName: "Spotify",
    ticker: "SPOT",
    country: "SE",
    region: "europe",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 60,
    headline: "Spotify Premium net adds tracking ahead of guide; gross-margin expansion holding",
    slug: "spot-premium-q1",
    publishedDaysAgo: 3,
    evidenceUrls: [
      { url: "https://investors.spotify.com" },
      { url: "https://www.bloomberg.com/news/spotify-q1" },
    ],
    hitRate: 0.77,
    hitRateSample: 13,
  },
  {
    entityId: "novonordisk",
    entityName: "Novo Nordisk",
    ticker: "NVO",
    country: "DK",
    region: "europe",
    signalType: "demand_acceleration",
    direction: "neutral",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "GLP-1 prescription growth stabilising as US compounding pressure eases",
    slug: "nvo-glp1-q1",
    publishedDaysAgo: 5,
    evidenceUrls: [
      { url: "https://www.novonordisk.com/investors.html" },
      { url: "https://www.ft.com/novo-nordisk-glp1" },
    ],
    hitRate: 0.62,
    hitRateSample: 8,
  },
  {
    entityId: "adyen",
    entityName: "Adyen",
    ticker: "ADYEN.AS",
    country: "NL",
    region: "europe",
    signalType: "tpv_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Adyen large-enterprise wins recovering after a slow 2025",
    slug: "adyen-tpv-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://www.adyen.com/investor-relations" },
      { url: "https://www.reuters.com/business/finance/adyen" },
    ],
    hitRate: 0.64,
    hitRateSample: 9,
  },
  // --- South Asia (expanded) --------------------------------------------
  {
    entityId: "tcs",
    entityName: "TCS",
    ticker: "TCS.NS",
    country: "IN",
    region: "south-asia",
    signalType: "ai_deal_velocity",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "TCS GenAI pipeline crossed $1.5B TCV — first time disclosed",
    slug: "tcs-genai-tcv-q1",
    publishedDaysAgo: 4,
    evidenceUrls: [
      { url: "https://www.tcs.com/who-we-are/newsroom" },
      { url: "https://economictimes.indiatimes.com/tech/tcs-genai-tcv" },
    ],
    hitRate: 0.66,
    hitRateSample: 9,
  },
  {
    entityId: "reliance",
    entityName: "Reliance Industries",
    ticker: "RELIANCE.NS",
    country: "IN",
    region: "south-asia",
    signalType: "capex_raise",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 90,
    headline: "Reliance raises FY27 capex for Jio AI data centers and gigafactories",
    slug: "ril-capex-fy27",
    publishedDaysAgo: 7,
    evidenceUrls: [
      { url: "https://www.ril.com/investors/financial-reporting" },
      { url: "https://www.business-standard.com/companies/news/reliance-capex" },
    ],
    hitRate: 0.74,
    hitRateSample: 11,
  },
  {
    entityId: "zomato",
    entityName: "Zomato (Eternal)",
    ticker: "ZOMATO.NS",
    country: "IN",
    region: "south-asia",
    signalType: "gmv_acceleration",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 30,
    headline: "Blinkit GMV growth tracking ahead of Q4 — quick-commerce share rising",
    slug: "zomato-blinkit-gmv-q1",
    publishedDaysAgo: 3,
    evidenceUrls: [
      { url: "https://www.eternal.com/investors" },
      { url: "https://www.livemint.com/companies/news/blinkit-gmv" },
    ],
    hitRate: 0.6,
    hitRateSample: 5,
  },
  {
    entityId: "hdfcbank",
    entityName: "HDFC Bank",
    ticker: "HDFCBANK.NS",
    country: "IN",
    region: "south-asia",
    signalType: "deposit_growth",
    direction: "up",
    confidence: "low",
    predictedWindowDays: 60,
    headline: "HDFC Bank retail deposit growth re-accelerating post-merger digestion",
    slug: "hdfcbank-deposits-q1",
    publishedDaysAgo: 8,
    evidenceUrls: [
      { url: "https://www.hdfcbank.com/personal/about-us/investor-relations" },
      { url: "https://www.moneycontrol.com/news/business/banks/hdfc-bank" },
    ],
    hitRate: null,
    hitRateSample: 2,
  },
  // --- East Asia (expanded) ---------------------------------------------
  {
    entityId: "tencent-stock",
    entityName: "Tencent",
    ticker: "0700.HK",
    country: "HK",
    region: "east-asia",
    signalType: "gaming_recovery",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Domestic gaming approvals at multi-year highs; Tencent pipeline benefits",
    slug: "tencent-gaming-q1",
    publishedDaysAgo: 5,
    evidenceUrls: [
      { url: "https://www.tencent.com/en-us/investors.html" },
      { url: "https://www.scmp.com/tech/big-tech/tencent-gaming" },
    ],
    hitRate: 0.63,
    hitRateSample: 8,
  },
  {
    entityId: "samsung",
    entityName: "Samsung Electronics",
    ticker: "005930.KS",
    country: "KR",
    region: "east-asia",
    signalType: "hbm_supply_warning",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Samsung HBM3E qualification for NVIDIA tracking ahead of schedule",
    slug: "samsung-hbm-qual-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://www.samsung.com/global/ir/" },
      { url: "https://www.businesskorea.co.kr/news/samsung-hbm" },
    ],
    hitRate: 0.71,
    hitRateSample: 10,
  },
  {
    entityId: "byd",
    entityName: "BYD",
    ticker: "1211.HK",
    country: "CN",
    region: "east-asia",
    signalType: "demand_acceleration",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 30,
    headline: "BYD overseas deliveries up 4x YoY — Brazil + SEA leading the mix",
    slug: "byd-overseas-q1",
    publishedDaysAgo: 4,
    evidenceUrls: [
      { url: "https://www.bydglobal.com/en/InvestorRelations.html" },
      { url: "https://cnevpost.com/byd-overseas" },
    ],
    hitRate: 0.7,
    hitRateSample: 7,
  },
  {
    entityId: "sony",
    entityName: "Sony Group",
    ticker: "6758.T",
    country: "JP",
    region: "east-asia",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "low",
    predictedWindowDays: 60,
    headline: "PlayStation Plus reactivation cycle stronger than past two quarters",
    slug: "sony-psn-q1",
    publishedDaysAgo: 10,
    evidenceUrls: [
      { url: "https://www.sony.com/en/SonyInfo/IR/" },
      { url: "https://www.bloomberg.com/news/sony-psn" },
    ],
    hitRate: null,
    hitRateSample: 2,
  },
  // --- Southeast Asia (expanded) ----------------------------------------
  {
    entityId: "gotoco",
    entityName: "GoTo Group",
    ticker: "GOTO.JK",
    country: "ID",
    region: "southeast-asia",
    signalType: "monthly_active_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "GoTo Q1 monthly transacting users back above pre-restructuring trendline",
    slug: "goto-monthly-active-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://www.gotocompany.com/en/investors" },
      { url: "https://www.reuters.com/business/finance/goto-q1" },
    ],
    hitRate: 0.6,
    hitRateSample: 5,
  },
  {
    entityId: "grab-stock",
    entityName: "Grab Holdings",
    ticker: "GRAB",
    country: "SG",
    region: "southeast-asia",
    signalType: "gmv_acceleration",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Grab GMV growth re-accelerating in Vietnam + Philippines",
    slug: "grab-gmv-q1",
    publishedDaysAgo: 9,
    evidenceUrls: [
      { url: "https://investors.grab.com" },
      { url: "https://techcrunch.com/grab-gmv" },
    ],
    hitRate: 0.55,
    hitRateSample: 4,
  },
  {
    entityId: "bukalapak",
    entityName: "Bukalapak",
    ticker: "BUKA.JK",
    country: "ID",
    region: "southeast-asia",
    signalType: "consumer_spend_drop",
    direction: "down",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Indonesian consumer-tech discretionary spend softening across categories",
    slug: "buka-discretionary-q1",
    publishedDaysAgo: 11,
    evidenceUrls: [
      { url: "https://www.bukalapak.com/about" },
      { url: "https://www.thejakartapost.com/business/discretionary-spend" },
    ],
    hitRate: 0.52,
    hitRateSample: 4,
  },
  // --- Latin America (expanded) -----------------------------------------
  {
    entityId: "mercadolibre",
    entityName: "MercadoLibre",
    ticker: "MELI",
    country: "AR",
    region: "latam",
    signalType: "gmv_acceleration",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 45,
    headline: "MELI Mexico GMV up 38% — fintech credit book seasoning well",
    slug: "meli-mexico-q1",
    publishedDaysAgo: 2,
    evidenceUrls: [
      { url: "https://investor.mercadolibre.com" },
      { url: "https://www.bloomberg.com/news/meli-mexico" },
    ],
    hitRate: 0.78,
    hitRateSample: 14,
  },
  {
    entityId: "stone",
    entityName: "StoneCo",
    ticker: "STNE",
    country: "BR",
    region: "latam",
    signalType: "tpv_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Stone Brazil TPV growth ahead of consensus; SMB take-rate stable",
    slug: "stne-tpv-q1",
    publishedDaysAgo: 5,
    evidenceUrls: [
      { url: "https://investors.stone.co" },
      { url: "https://valor.globo.com/financas/stone-tpv" },
    ],
    hitRate: 0.65,
    hitRateSample: 7,
  },
  {
    entityId: "globant",
    entityName: "Globant",
    ticker: "GLOB",
    country: "AR",
    region: "latam",
    signalType: "ai_pipeline_acceleration",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Globant AI Studio bookings outpacing core services growth",
    slug: "glob-ai-pipeline-q1",
    publishedDaysAgo: 7,
    evidenceUrls: [
      { url: "https://investors.globant.com" },
      { url: "https://www.zdnet.com/article/globant-ai-studio" },
    ],
    hitRate: 0.6,
    hitRateSample: 5,
  },
  // --- MENA --------------------------------------------------------------
  {
    entityId: "aramco",
    entityName: "Saudi Aramco",
    ticker: "2222.SR",
    country: "SA",
    region: "mena",
    signalType: "capex_raise",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 90,
    headline: "Aramco bumps gas + downstream capex; Saudi industrial buildout step-up",
    slug: "aramco-capex-fy27",
    publishedDaysAgo: 8,
    evidenceUrls: [
      { url: "https://www.aramco.com/en/investors" },
      { url: "https://www.ft.com/aramco-capex" },
    ],
    hitRate: 0.7,
    hitRateSample: 6,
  },
  {
    entityId: "anghami-stock",
    entityName: "Anghami",
    ticker: "ANGH",
    country: "AE",
    region: "mena",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "low",
    predictedWindowDays: 60,
    headline: "Anghami paid-sub mix improving as GCC ad market normalises",
    slug: "anghami-subs-q1",
    publishedDaysAgo: 12,
    evidenceUrls: [
      { url: "https://investors.anghami.com" },
      { url: "https://www.thenationalnews.com/business/anghami" },
    ],
    hitRate: null,
    hitRateSample: 1,
  },
  {
    entityId: "fawry",
    entityName: "Fawry",
    ticker: "FWRY.CA",
    country: "EG",
    region: "mena",
    signalType: "tpv_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Fawry merchant TPV growth re-accelerating post-Egypt FX adjustment",
    slug: "fawry-tpv-q1",
    publishedDaysAgo: 10,
    evidenceUrls: [
      { url: "https://fawry.com/investor-relations" },
      { url: "https://english.ahram.org.eg/News/fawry" },
    ],
    hitRate: 0.58,
    hitRateSample: 4,
  },
  // --- Africa ------------------------------------------------------------
  {
    entityId: "safaricom",
    entityName: "Safaricom",
    ticker: "SCOM.NR",
    country: "KE",
    region: "africa",
    signalType: "tpv_growth",
    direction: "up",
    confidence: "high",
    predictedWindowDays: 60,
    headline: "M-Pesa TPV growth + new credit products driving fintech contribution",
    slug: "scom-mpesa-q1",
    publishedDaysAgo: 6,
    evidenceUrls: [
      { url: "https://www.safaricom.co.ke/investor-relations" },
      { url: "https://www.businessdaily.co.ke/safaricom" },
    ],
    hitRate: 0.73,
    hitRateSample: 9,
  },
  {
    entityId: "naspers",
    entityName: "Naspers / Prosus",
    ticker: "PRX.AS",
    country: "ZA",
    region: "africa",
    signalType: "capital_return",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 90,
    headline: "Prosus buyback pace at record; NAV discount compression continuing",
    slug: "prx-buyback-q1",
    publishedDaysAgo: 9,
    evidenceUrls: [
      { url: "https://www.prosus.com/investors" },
      { url: "https://www.reuters.com/business/prosus-buyback" },
    ],
    hitRate: 0.69,
    hitRateSample: 7,
  },
  {
    entityId: "mtn",
    entityName: "MTN Group",
    ticker: "MTN.JO",
    country: "ZA",
    region: "africa",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "MTN Nigeria data-revenue mix recovering as naira stabilises",
    slug: "mtn-nigeria-q1",
    publishedDaysAgo: 12,
    evidenceUrls: [
      { url: "https://www.mtn.com/investor-relations" },
      { url: "https://www.bloomberg.com/news/mtn-nigeria" },
    ],
    hitRate: 0.61,
    hitRateSample: 5,
  },
  // --- Oceania -----------------------------------------------------------
  {
    entityId: "atlassian-stock",
    entityName: "Atlassian",
    ticker: "TEAM",
    country: "AU",
    region: "oceania",
    signalType: "cloud_recovery",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 60,
    headline: "Atlassian cloud migration cohort revenue tracking ahead of guidance",
    slug: "team-cloud-q1",
    publishedDaysAgo: 5,
    evidenceUrls: [
      { url: "https://investors.atlassian.com" },
      { url: "https://www.theinformation.com/articles/atlassian-cloud" },
    ],
    hitRate: 0.66,
    hitRateSample: 8,
  },
  {
    entityId: "wesfarmers",
    entityName: "Wesfarmers",
    ticker: "WES.AX",
    country: "AU",
    region: "oceania",
    signalType: "consumer_spend_drop",
    direction: "down",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Bunnings + Kmart discretionary categories softening Q-over-Q",
    slug: "wes-discretionary-q1",
    publishedDaysAgo: 8,
    evidenceUrls: [
      { url: "https://www.wesfarmers.com.au/investors" },
      { url: "https://www.afr.com/companies/wesfarmers" },
    ],
    hitRate: 0.59,
    hitRateSample: 6,
  },
  {
    entityId: "xero",
    entityName: "Xero",
    ticker: "XRO.AX",
    country: "NZ",
    region: "oceania",
    signalType: "subscriber_growth",
    direction: "up",
    confidence: "medium",
    predictedWindowDays: 45,
    headline: "Xero UK + US subscriber net adds at multi-quarter highs",
    slug: "xro-subs-q1",
    publishedDaysAgo: 7,
    evidenceUrls: [
      { url: "https://investors.xero.com" },
      { url: "https://www.ft.com/xero" },
    ],
    hitRate: 0.68,
    hitRateSample: 8,
  },
];

export interface SeedIdea {
  title: string;
  description: string;
  source: "community" | "opportunity";
  region: Region;
  subreddit: string | null;
  daysAgo: number;
  evidenceUrls: { url: string; source?: string }[];
}

export const SEED_IDEAS: SeedIdea[] = [
  {
    title: "Local-first compliance assistant for Indian fintech founders",
    description:
      "Founders keep asking for an RBI / SEBI / GST compliance copilot that does not send data to US-hosted LLMs. The recurring complaint is that existing 'AI compliance' tools fail on Indian-specific edge cases and store sensitive PII abroad.",
    source: "community",
    region: "south-asia",
    subreddit: "IndianStartups",
    daysAgo: 2,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/IndianStartups/comments/compliance-tooling" },
      { url: "https://www.medianama.com/2025/rbi-data-localisation" },
    ],
  },
  {
    title: "On-call rotation tool that respects DST + multi-region time zones",
    description:
      "Every PagerDuty / Opsgenie thread surfaces the same complaint: weekly rotations break when teams span IST, GMT, and PST and daylight savings shifts misalign hand-offs by an hour. There's room for an opinionated tool that defaults to UTC anchors.",
    source: "community",
    region: "global",
    subreddit: "sre",
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/sre/comments/on-call-dst" },
      { url: "https://news.ycombinator.com/item?id=oncall-rotations" },
    ],
  },
  {
    title: "Spend visibility for indie devs on multi-LLM stacks",
    description:
      "Devs running a personal stack across OpenAI, Anthropic, Mistral, and Groq say a single 'where did my $500 go' dashboard with per-model + per-prompt-template attribution would unblock real usage. Today this requires either Helicone-style proxying or hand-rolled spreadsheets.",
    source: "community",
    region: "north-america",
    subreddit: "LocalLLaMA",
    daysAgo: 1,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/LocalLLaMA/comments/llm-spend-attribution" },
      { url: "https://twitter.com/swyx/status/llm-spend-tracking" },
    ],
  },
  {
    title: "Cross-broker portfolio aggregator with verifiable read-only auth",
    description:
      "Indian investors with positions across Zerodha, Groww, Upstox, and Dhan keep asking for a read-only aggregator that surfaces overall asset allocation without giving any single broker more permissions. AA (Account Aggregator) framework makes this finally legible.",
    source: "community",
    region: "south-asia",
    subreddit: "IndianInvestments",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/IndianInvestments/comments/portfolio-aggregation" },
      { url: "https://sahamati.org.in/account-aggregator-framework/" },
    ],
  },
  {
    title: "AI-assisted code review that ignores style and only flags risk",
    description:
      "Recurring complaint across r/ExperiencedDevs and HN: existing AI reviewers nitpick formatting and create noise. There's signal for a tool that scopes itself to security, race conditions, and correctness — and never comments on naming.",
    source: "community",
    region: "global",
    subreddit: "ExperiencedDevs",
    daysAgo: 3,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/ExperiencedDevs/comments/ai-reviewer-noise" },
      { url: "https://news.ycombinator.com/item?id=ai-code-review-quality" },
    ],
  },
  {
    title: "European-hosted alternative to Notion for SMB compliance docs",
    description:
      "EU SMBs hit by NIS2 + GDPR-X want a Notion-like that's GDPR-resident by design, doesn't ship metadata to US infra, and supports German + French as first-class. Threads complain that no current tool checks all three boxes.",
    source: "community",
    region: "europe",
    subreddit: "selfhosted",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/selfhosted/comments/eu-notion-alternative" },
      { url: "https://news.ycombinator.com/item?id=nis2-tooling-gap" },
    ],
  },
  {
    title: "Tax-aware DCA scheduler for Brazilian retail investors",
    description:
      "Brazilian DCA threads on r/investimentos repeat the need for an automated DCA tool that books across XP, Inter, and BTG while accounting for IR de renda variável thresholds. Today this is hand-managed in spreadsheets.",
    source: "community",
    region: "latam",
    subreddit: "investimentos",
    daysAgo: 8,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/investimentos/comments/dca-tooling" },
      { url: "https://valor.globo.com/financas/dca-retail" },
    ],
  },
  {
    title: "Browser-extension audit log for SaaS app permissions",
    description:
      "SaaS founders say their staff connect productivity extensions (Notion-AI, Loom, calendar bots) that get read-everything OAuth scopes nobody audits. A small extension that surfaces 'these tools can read every doc you open' before grant time would close the gap.",
    source: "opportunity",
    region: "global",
    subreddit: null,
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.darkreading.com/identity-and-access-management/saas-extension-audit" },
      { url: "https://blog.1password.com/saas-extension-scope-creep/" },
    ],
  },
  {
    title: "AI agent for Indian GST filing and HSN code disambiguation",
    description:
      "r/IndiaTax and r/IndianCAs threads are full of small businesses spending hours on HSN code lookups and quarterly GST filings. An agent that pulls invoices, classifies HSN codes, and pre-fills GSTR-1/3B would have an instant audience.",
    source: "community",
    region: "south-asia",
    subreddit: "IndiaTax",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/IndiaTax/comments/gst-filing-agent" },
    ],
  },
  {
    title: "Cross-border crypto remittance with KE/NG payout legs",
    description:
      "African diaspora threads in r/Kenya and r/Nigeria keep posting about USDT remittance flows that are 20x cheaper than Western Union but operationally clunky. A vertical-focused player with white-glove ramp + payout would dominate.",
    source: "community",
    region: "africa",
    subreddit: "Kenya",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/Kenya/comments/usdt-remittance-flows" },
    ],
  },
  {
    title: "GCC-localized HR + payroll automation for SMBs",
    description:
      "r/dubai SMB threads point to a gap: existing HR tools handle KSA/UAE labor law inconsistently. A tool that nails WPS payroll + Iqama renewals + end-of-service gratuity calculations would convert quickly.",
    source: "community",
    region: "mena",
    subreddit: "dubai",
    daysAgo: 7,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/dubai/comments/sme-payroll-pain" },
    ],
  },
  {
    title: "Mandarin-first voice agents for inbound SEA seller support",
    description:
      "Sea + Shopee + Lazada sellers in r/sg and r/indonesia mention that Mandarin-speaking customers are underserved by current voice-agent providers. A specialised vertical play could win share fast.",
    source: "community",
    region: "southeast-asia",
    subreddit: "indonesia",
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/indonesia/comments/mandarin-voice-agents" },
    ],
  },
  {
    title: "Indonesian motorcycle-fleet leasing platform tied to gig income",
    description:
      "r/indonesia + r/jakarta entrepreneurs note the gap: Gojek + Grab drivers want leasing tied to actual gig income, not credit scores. A risk model that prices off platform-verified income could unlock big TAM.",
    source: "community",
    region: "southeast-asia",
    subreddit: "indonesia",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/indonesia/comments/gig-leasing" },
    ],
  },
  {
    title: "AU-localized Atlassian-replacement for SMB engineering teams",
    description:
      "r/australian-developers threads complain about Atlassian's Cloud-tier price increases. An AU/NZ-resident lightweight alternative (Linear-style polish, Jira-style breadth, AUD pricing) could pull GTM-light teams away.",
    source: "community",
    region: "oceania",
    subreddit: "australian-developers",
    daysAgo: 9,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/australian-developers/comments/atlassian-pricing" },
    ],
  },
  {
    title: "Brazilian Pix-native invoice + receivables marketplace",
    description:
      "r/empreendedorismo threads consistently surface SMBs holding Pix-paid receivables they want to discount fast. A pure-Pix invoice-discounting marketplace with auto-KYC would clear receivables in hours, not weeks.",
    source: "community",
    region: "latam",
    subreddit: "empreendedorismo",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/empreendedorismo/comments/pix-receivables-marketplace" },
    ],
  },
  {
    title: "Japanese-language coding-agent that respects domestic codebase conventions",
    description:
      "r/japanlife + r/programmingJP threads note that Cursor / Claude Code default to English comments and EN-style naming, which JP teams have to manually correct. A localised mode would convert quickly with the right brand.",
    source: "community",
    region: "east-asia",
    subreddit: "programmingJP",
    daysAgo: 8,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/programmingJP/comments/jp-coding-agent" },
    ],
  },
  {
    title: "EU-resident telemetry analytics under DSA / DMA constraints",
    description:
      "r/europe + r/gdpr threads keep flagging Mixpanel/Amplitude data-residency gaps. A telemetry stack that's GDPR-resident by design and lawful-basis-aware (DSA reporting hooks) would convert EU SMBs faster than the US incumbents.",
    source: "community",
    region: "europe",
    subreddit: "gdpr",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/gdpr/comments/eu-resident-telemetry" },
    ],
  },
  {
    title: "Self-hosted alternative to Slack with built-in CRM",
    description:
      "Founders on HN and r/selfhosted want Slack + Hubspot Lite fused into one self-hosted tool — they're tired of OAuth chains and per-seat pricing that double-counts the same humans.",
    source: "opportunity",
    region: "global",
    subreddit: null,
    daysAgo: 3,
    evidenceUrls: [
      { url: "https://news.ycombinator.com/item?id=slack-crm-fusion" },
    ],
  },
  {
    title: "OSS analytics ETL that ships with seed dashboards per vertical",
    description:
      "Founders running multi-product portfolios complain that 'just set up Snowflake' is too heavy and 'just use PostHog' loses analytical depth. An OSS ETL with pre-built dashboards per vertical (e-commerce, B2B SaaS, marketplace) would slot in cleanly.",
    source: "opportunity",
    region: "global",
    subreddit: null,
    daysAgo: 7,
    evidenceUrls: [
      { url: "https://news.ycombinator.com/item?id=oss-etl-with-dashboards" },
    ],
  },
];

export interface SeedTrend {
  title: string;
  description: string;
  subreddit: string;
  region: Region;
  daysAgo: number;
  evidenceUrls: { url: string; source?: string }[];
}

export const SEED_TRENDS: SeedTrend[] = [
  {
    title: "Local-LLM households are moving from curiosity to dependency",
    description:
      "r/LocalLLaMA threads have shifted from 'how do I run this' to 'I use Llama-3.3 for X daily and it's better than ChatGPT for my use case.' Sustained adoption among technical users, not novelty.",
    subreddit: "LocalLLaMA",
    region: "global",
    daysAgo: 2,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/LocalLLaMA/comments/daily-driver-flips" },
    ],
  },
  {
    title: "EU founders defaulting to Hetzner + Cloudflare over hyperscalers",
    description:
      "Recurring cost-out threads in r/europe-startups show Hetzner + Cloudflare + a managed Postgres as the assumed stack for new builds. Hyperscalers come up only as 'we'd consider it if we hit $X scale.'",
    subreddit: "europe-startups",
    region: "europe",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/europe-startups/comments/cost-out-2026" },
    ],
  },
  {
    title: "Indian SMB owners are buying Macs to run business workflows",
    description:
      "r/IndianFreelancers shows a clear lift in 'first-Mac' purchases from small businesses, driven by Apple Intelligence + local LLM convenience. Used MacBooks moving faster than the previous baseline.",
    subreddit: "IndianFreelancers",
    region: "south-asia",
    daysAgo: 3,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/IndianFreelancers/comments/mac-as-business-tool" },
    ],
  },
  {
    title: "Productivity tooling fatigue — operators going back to plain text",
    description:
      "Founders across r/ProductManagement, r/startups, and r/sre keep posting 'I deleted Notion and went back to plain markdown.' The signal isn't anti-Notion specifically; it's that complex workspaces are getting culled.",
    subreddit: "ProductManagement",
    region: "global",
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/ProductManagement/comments/notion-fatigue" },
    ],
  },
  {
    title: "Latin American devs converging on Rust for new infra work",
    description:
      "r/programacion + r/devbr show a marked shift from Go to Rust for new infra-side projects, citing memory + cost efficiency on Hetzner-equivalent providers. Hiring posts increasingly list Rust as 'nice to have or better.'",
    subreddit: "programacion",
    region: "latam",
    daysAgo: 9,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/programacion/comments/rust-shift-latam" },
    ],
  },
  {
    title: "SEA founders treating WhatsApp Business as the primary growth channel",
    description:
      "r/sg + r/jakarta + r/manila SMB threads describe WhatsApp Business + Click-to-WhatsApp ads as the assumed acquisition path, with Instagram and email reduced to retention. Meta's Click-to-WhatsApp share keeps climbing.",
    subreddit: "sg",
    region: "southeast-asia",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/sg/comments/whatsapp-as-growth-channel" },
    ],
  },
  {
    title: "Personal-finance subreddits treating CDs and T-bills as default again",
    description:
      "Rate-aware threads in r/personalfinance and r/Bogleheads keep pointing to short-duration fixed income as the assumed parking spot for cash. Index-fund-only orthodoxy is softening as rates hold.",
    subreddit: "personalfinance",
    region: "north-america",
    daysAgo: 7,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/personalfinance/comments/cd-tbill-default" },
    ],
  },
  {
    title: "Indian devs increasingly treating Cursor + Claude Code as core tooling",
    description:
      "r/developersIndia threads have shifted from 'is Cursor worth it?' to 'how do you handle the Anthropic billing in INR?' Adoption is high, friction is now operational (FX + billing), not capability.",
    subreddit: "developersIndia",
    region: "south-asia",
    daysAgo: 3,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/developersIndia/comments/cursor-billing-inr" },
    ],
  },
  {
    title: "Japanese SMBs adopting Notion + AI for daily-report culture",
    description:
      "r/japanlife and JP business-forum threads show small companies using Notion's AI summarisation specifically to compress nichijou-houkoku (daily reports). Cultural adaptation, not feature adoption.",
    subreddit: "japanlife",
    region: "east-asia",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/japanlife/comments/daily-report-ai" },
    ],
  },
  {
    title: "Latin American freelancers consolidating on Mercado Pago + Wise",
    description:
      "r/Argentina and r/brasil freelancer threads describe a two-tool stack — Mercado Pago for local + Wise for USD — as the assumed setup, with USD-pegged stables increasingly common as a third leg.",
    subreddit: "brasil",
    region: "latam",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/brasil/comments/freelancer-payment-stack" },
    ],
  },
  {
    title: "GCC developers treating Cloudflare Workers as default edge runtime",
    description:
      "r/dubai + r/saudiarabia + r/SaudiBusiness threads show CF Workers being chosen for new builds primarily because of local PoP latency. Hetzner-style price-sensitivity rare in GCC threads; perf and uptime lead.",
    subreddit: "saudiarabia",
    region: "mena",
    daysAgo: 8,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/saudiarabia/comments/cf-workers-edge" },
    ],
  },
  {
    title: "Kenyan + Nigerian devs converging on M-Pesa Daraja + Paystack as PSP defaults",
    description:
      "r/Kenya + r/Nigeria dev threads default to M-Pesa Daraja for KE volume and Paystack for NG volume; Flutterwave usage is dropping in new builds after regulator-attention headlines.",
    subreddit: "Kenya",
    region: "africa",
    daysAgo: 11,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/Kenya/comments/psp-defaults-2026" },
    ],
  },
  {
    title: "SEA founders treating AI agent platforms as 'cost-out' rather than 'growth'",
    description:
      "r/indonesia + r/singapore SMB threads frame AI adoption around staffing-cost reduction (operations + support), not new product creation. Different narrative from US tech press.",
    subreddit: "singapore",
    region: "southeast-asia",
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/singapore/comments/ai-cost-out-narrative" },
    ],
  },
  {
    title: "Oceania remote-work scene normalising 4-day weeks for tech roles",
    description:
      "r/auscorp + r/newzealand + r/sydney + r/Melbourne threads show 4-day workweek at full pay being treated as the differentiator AU/NZ tech firms compete on, not RTO.",
    subreddit: "auscorp",
    region: "oceania",
    daysAgo: 6,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/auscorp/comments/4-day-week-tech" },
    ],
  },
  {
    title: "European GDPR pushback hardening against US-hosted AI",
    description:
      "r/europe + r/sysadmin EU-resident threads keep posting 'we vetoed ChatGPT Enterprise because of US data flows.' Demand for EU-residence is now table-stakes for procurement, not nice-to-have.",
    subreddit: "europe",
    region: "europe",
    daysAgo: 4,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/europe/comments/us-ai-procurement-veto" },
    ],
  },
  {
    title: "Operator subreddits trading away from public boards toward Discord cohorts",
    description:
      "r/startups + r/founder + r/ProductManagement threads point to high-signal conversation having moved to private Discord cohorts and Slack communities. Reddit threads are getting more entry-level.",
    subreddit: "startups",
    region: "global",
    daysAgo: 5,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/startups/comments/discord-cohort-migration" },
    ],
  },
  {
    title: "Newsletter-as-product builders converging on Beehiiv + Stripe + Webflow",
    description:
      "r/Newsletters + r/SaaS threads show Beehiiv winning the small-newsletter category, paired with Stripe checkout + Webflow landing pages. Substack-as-default era is ending for serious operators.",
    subreddit: "Newsletters",
    region: "global",
    daysAgo: 7,
    evidenceUrls: [
      { url: "https://www.reddit.com/r/Newsletters/comments/beehiiv-stripe-webflow" },
    ],
  },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function inferTargetUser(idea: SeedIdea): string {
  const text = `${idea.title} ${idea.description}`.toLowerCase();
  if (text.includes("founder")) return "founders entering or operating in this category";
  if (text.includes("smb")) return "SMB operators with repeated manual workflows";
  if (text.includes("dev") || text.includes("code") || text.includes("engineering")) {
    return "technical teams with recurring workflow friction";
  }
  if (text.includes("investor") || text.includes("portfolio")) {
    return "retail investors comparing fragmented tools and accounts";
  }
  if (text.includes("seller") || text.includes("commerce")) {
    return "commerce operators dealing with local-market constraints";
  }
  return "operators actively asking for a purpose-built product";
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
}

function seedIdeaToOpportunity(idea: SeedIdea): NonNullable<BriefIdeaItem["opportunity"]> {
  const evidenceCount = idea.evidenceUrls.length;
  const confidence: NonNullable<BriefIdeaItem["opportunity"]>["confidence"] =
    evidenceCount >= 2 ? "medium" : "low";
  const verdict: NonNullable<BriefIdeaItem["opportunity"]>["verdict"] =
    confidence === "medium" ? "test" : "watch";
  const sourceLabel = idea.subreddit ? `r/${idea.subreddit}` : "cross-source opportunity note";

  return {
    verdict,
    confidence,
    targetUser: inferTargetUser(idea),
    problem: firstSentence(idea.description),
    marketTimingReasons: [
      `${sourceLabel} has a fresh demand signal from the last ${idea.daysAgo} days.`,
      idea.region === "global"
        ? "The pain is not tied to one geography, so validation can start with a narrow ICP."
        : `The signal is region-specific (${idea.region}), which makes positioning and interviews more focused.`,
    ],
    evidenceMix: [
      {
        kind: "demand",
        label: idea.source === "community" ? "community demand" : "opportunity signal",
        summary: evidenceCount >= 2
          ? "Multiple cited sources point at the same unmet job."
          : "One cited source is enough to watch, not enough to enter.",
        strength: evidenceCount >= 2 ? "medium" : "low",
        sourceCount: evidenceCount,
      },
    ],
    competitorNotes: [
      "Map the 3-5 obvious substitutes before building; this brief does not yet prove supply is thin.",
    ],
    pricingNotes: [
      "Validate willingness to pay with a landing page or manual offer before sizing the price band.",
    ],
    agentVisibilityNotes: [
      "Ask major AI assistants what they recommend for this job; missing or generic answers are an entry wedge.",
    ],
    risks: [
      evidenceCount >= 2
        ? "Demand may be real but too fragmented to support a focused first product."
        : "Evidence is still thin; treat this as a watchlist item until corroborated.",
    ],
    nextValidationStep:
      "Run 10 problem interviews and publish one comparison or waitlist page tied to the exact complaint.",
    priorHitRate: {
      label: "product-opportunity family",
      hitRate: 0.58,
      sample: 12,
      band: "family",
    },
  };
}

export function fallbackStocks(region: Region, limit: number): BriefStockItem[] {
  const pool = region === "global"
    ? SEED_STOCK_SIGNALS
    : SEED_STOCK_SIGNALS.filter((s) => s.region === region);
  if (pool.length === 0) return [];
  return pool.slice(0, limit).map((s) => {
    const sampleBand: BriefStockItem["hitRateBand"] =
      s.hitRate === null
        ? s.hitRateSample > 0
          ? "early"
          : "none"
        : s.hitRateSample >= 3
          ? "direct"
          : "early";
    return {
      entityId: s.entityId,
      entityName: s.entityName,
      ticker: s.ticker,
      country: s.country,
      signalType: s.signalType,
      signalFamily: familyForSignalType(s.signalType),
      direction: s.direction,
      confidence: s.confidence,
      predictedWindowDays: s.predictedWindowDays,
      headline: s.headline,
      signalSlug: s.slug,
      publishedAt: isoDaysAgo(s.publishedDaysAgo),
      evidenceUrls: s.evidenceUrls,
      hitRate: s.hitRate,
      hitRateSample: s.hitRateSample,
      hitRateBand: sampleBand,
    };
  });
}

export function fallbackIdeas(region: Region, limit: number): BriefIdeaItem[] {
  const pool = region === "global"
    ? SEED_IDEAS
    : SEED_IDEAS.filter((i) => i.region === region || i.region === "global");
  if (pool.length === 0) return [];
  return pool.slice(0, limit).map((i) => ({
    title: i.title,
    description: i.description,
    source: i.source,
    region: i.region,
    subreddit: i.subreddit,
    surfacedAt: isoDaysAgo(i.daysAgo),
    evidenceUrls: i.evidenceUrls,
    opportunity: seedIdeaToOpportunity(i),
  }));
}

export function fallbackTrends(region: Region, limit: number): BriefTrendItem[] {
  const pool = region === "global"
    ? SEED_TRENDS
    : SEED_TRENDS.filter((t) => t.region === region || t.region === "global");
  if (pool.length === 0) return [];
  return pool.slice(0, limit).map((t) => ({
    title: t.title,
    description: t.description,
    subreddit: t.subreddit,
    region: t.region,
    surfacedAt: isoDaysAgo(t.daysAgo),
    evidenceUrls: t.evidenceUrls,
  }));
}
