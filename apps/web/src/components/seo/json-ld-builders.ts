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
