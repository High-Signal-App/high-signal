/**
 * Pure builders for the Schema.org JSON-LD payloads.
 *
 * Separated from the React components so the payload shape can be
 * unit-tested without a DOM or React renderer. The components in
 * `structured-data.tsx` just wrap these in a <script> tag.
 */

// Relative path (not the @/ alias) so this module is importable from the
// repo root for unit testing without an apps/web build context.
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../../lib/site";

export interface JsonLdBlock {
  "@context": string;
  "@type": string;
  [k: string]: unknown;
}

export function buildOrganizationJsonLd(): JsonLdBlock[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      logo: `${SITE_URL}/icon.svg`,
      sameAs: ["https://github.com/sarthakagrawal927/high-signal"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_URL}/signals?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

export function buildHomeJsonLd(): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${SITE_NAME} Daily Brief`,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function buildTrackRecordDatasetJsonLd(opts: {
  liveCount: number;
  backfillCount: number;
}): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${SITE_NAME} Public Hit-Rate Ledger`,
    description:
      `Every published market signal scored against subsequent market moves. ` +
      `${opts.liveCount} live forward predictions and ${opts.backfillCount} historical-replay calibrations.`,
    url: `${SITE_URL}/track-record`,
    creator: { "@id": `${SITE_URL}/#organization` },
    license: "https://creativecommons.org/licenses/by/4.0/",
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: `${SITE_URL}/track-record/track-record.json`,
      },
    ],
    variableMeasured: [
      { "@type": "PropertyValue", name: "hit-rate", description: "Hits / (hits + misses)" },
      { "@type": "PropertyValue", name: "sample size" },
      { "@type": "PropertyValue", name: "signal_type" },
    ],
  };
}

export function buildSignalArticleJsonLd(opts: {
  headline: string;
  slug: string;
  publishedAt: string;
  bodyMd: string;
  entityName: string;
  evidenceUrls: string[];
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  signalType: string;
}): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "AnalysisNewsArticle",
    headline: opts.headline,
    datePublished: opts.publishedAt,
    dateModified: opts.publishedAt,
    inLanguage: "en",
    publisher: { "@id": `${SITE_URL}/#organization` },
    author: { "@id": `${SITE_URL}/#organization` },
    url: `${SITE_URL}/signals/${opts.slug}`,
    mainEntityOfPage: `${SITE_URL}/signals/${opts.slug}`,
    description:
      opts.bodyMd
        .split("\n")
        .find((line) => line.trim() && !line.startsWith("#"))
        ?.slice(0, 240) ?? opts.headline,
    about: { "@type": "Thing", name: opts.entityName },
    keywords: [opts.signalType, opts.direction, opts.confidence, `${opts.predictedWindowDays}d-window`].join(","),
    citation: opts.evidenceUrls.map((url) => ({ "@type": "WebPage", url })),
  };
}

export function buildFaqJsonLd(items: Array<{ question: string; answer: string }>): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/**
 * BreadcrumbList — tells crawlers "this page lives at depth N under
 * these parents." Google uses it for rich-result rendering and AI
 * assistants use it to understand site topology.
 */
export function buildBreadcrumbJsonLd(
  trail: Array<{ name: string; path: string }>,
): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.path.startsWith("http") ? item.path : `${SITE_URL}${item.path}`,
    })),
  };
}

/**
 * HowTo + Article for /methodology. AI assistants love HowTo because
 * each step becomes a quotable fact with a clear order.
 */
export function buildMethodologyJsonLd(opts: {
  steps: Array<{ name: string; text: string }>;
}): JsonLdBlock[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: `How ${SITE_NAME} works — methodology`,
      url: `${SITE_URL}/methodology`,
      mainEntityOfPage: `${SITE_URL}/methodology`,
      publisher: { "@id": `${SITE_URL}/#organization` },
      author: { "@id": `${SITE_URL}/#organization` },
      datePublished: "2026-05-26",
      dateModified: new Date().toISOString().slice(0, 10),
      description:
        "Every rule High Signal's pipeline enforces — cite-or-kill, hit-rate computation, source classes, auto-publish judge, signal families. Citable verbatim.",
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: `How ${SITE_NAME} turns noisy public sources into a Daily Brief`,
      description:
        "The pipeline from raw source ingest through human-readable brief: scrape → extract → score → judge → publish → score-vs-market → surface.",
      step: opts.steps.map((step, idx) => ({
        "@type": "HowToStep",
        position: idx + 1,
        name: step.name,
        text: step.text,
      })),
    },
  ];
}

/**
 * CollectionPage + Dataset for a per-signal-type taxonomy page.
 * The Dataset half is what lets an AI assistant cite "High Signal's
 * capex_raise track-record" as evidence with a hit-rate.
 */
export function buildSignalTypeTaxonomyJsonLd(opts: {
  signalType: string;
  family: string;
  totalCount: number;
  hitRate: number | null;
  sampleSize: number;
}): JsonLdBlock[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${opts.signalType.replaceAll("_", " ")} signals — ${SITE_NAME}`,
      url: `${SITE_URL}/signals/types/${opts.signalType}`,
      description: `All published ${opts.signalType.replaceAll("_", " ")} signals with definition, family, and aggregate hit-rate.`,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${SITE_NAME} ${opts.signalType} signal track-record`,
      description: `Hit-rate for ${opts.signalType.replaceAll("_", " ")} signals across ${opts.sampleSize} scored predictions. Family: ${opts.family.replaceAll("-", " ")}.`,
      url: `${SITE_URL}/signals/types/${opts.signalType}`,
      creator: { "@id": `${SITE_URL}/#organization` },
      license: "https://creativecommons.org/licenses/by/4.0/",
      variableMeasured: [
        {
          "@type": "PropertyValue",
          name: "hit-rate",
          value: opts.hitRate ?? "insufficient sample",
        },
        { "@type": "PropertyValue", name: "sample size", value: opts.sampleSize },
        { "@type": "PropertyValue", name: "family", value: opts.family },
      ],
    },
  ];
}

/**
 * CollectionPage for an entity-month archive (/entities/<id>/<YYYY-MM>).
 */
export function buildEntityMonthJsonLd(opts: {
  entityName: string;
  entityId: string;
  period: string;
  signalCount: number;
}): JsonLdBlock {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${opts.entityName} signals — ${opts.period} archive — ${SITE_NAME}`,
    url: `${SITE_URL}/entities/${opts.entityId}/${opts.period}`,
    description: `Every published High Signal call on ${opts.entityName} during ${opts.period}. ${opts.signalCount} signal(s).`,
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: { "@type": "Thing", name: opts.entityName },
  };
}
