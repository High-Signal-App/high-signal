#!/usr/bin/env tsx
/**
 * Unit tests for the Schema.org JSON-LD builders.
 *
 * Run: `pnpm seo:test`. Validates that each payload (a) has the required
 * Schema.org keys, (b) serializes to valid JSON, and (c) uses absolute
 * URLs for `url`/`@id` fields that AI assistants will follow.
 */

import {
  buildFaqJsonLd,
  buildHomeJsonLd,
  buildOrganizationJsonLd,
  buildSignalArticleJsonLd,
  buildTrackRecordDatasetJsonLd,
} from "../apps/web/src/components/seo/json-ld-builders";
import { SITE_URL } from "../apps/web/src/lib/site";

let failures = 0;
let total = 0;

function check(label: string, cond: boolean, reason: string = "") {
  total++;
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}${reason ? ` — ${reason}` : ""}`);
  }
}

function isAbsoluteUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith("https://") || value.startsWith("http://");
}

function serialisable(payload: unknown): boolean {
  try {
    JSON.parse(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

console.log("Organization + WebSite JSON-LD");
{
  const blocks = buildOrganizationJsonLd();
  check("returns 2 blocks (Organization + WebSite)", blocks.length === 2);
  const [org, site] = blocks;
  check("Organization type", org["@type"] === "Organization");
  check("WebSite type", site["@type"] === "WebSite");
  check("Organization @id absolute", isAbsoluteUrl(org["@id"]));
  check("Organization url absolute", isAbsoluteUrl(org.url));
  check("WebSite publisher refs Organization @id", (site.publisher as { "@id": string })["@id"] === org["@id"]);
  check("WebSite potentialAction has SearchAction", (site.potentialAction as { "@type": string })["@type"] === "SearchAction");
  check("serialises to valid JSON", serialisable(blocks));
}

console.log("\nHome (WebApplication) JSON-LD");
{
  const block = buildHomeJsonLd();
  check("type WebApplication", block["@type"] === "WebApplication");
  check("url absolute", isAbsoluteUrl(block.url));
  check("operatingSystem", block.operatingSystem === "Web");
  check("price = 0 (free)", (block.offers as { price: string }).price === "0");
  check("publisher refs Organization @id", (block.publisher as { "@id": string })["@id"] === `${SITE_URL}/#organization`);
}

console.log("\nTrack-record Dataset JSON-LD");
{
  const block = buildTrackRecordDatasetJsonLd({ liveCount: 7, backfillCount: 110 });
  check("type Dataset", block["@type"] === "Dataset");
  check("url is /track-record", block.url === `${SITE_URL}/track-record`);
  check("license is CC-BY-4.0", block.license === "https://creativecommons.org/licenses/by/4.0/");
  check("description mentions live + backfill counts",
    typeof block.description === "string" &&
    block.description.includes("7") && block.description.includes("110"));
  check("has DataDownload distribution",
    Array.isArray(block.distribution) &&
    (block.distribution as Array<{ "@type": string }>)[0]["@type"] === "DataDownload");
}

console.log("\nSignal Article JSON-LD");
{
  const block = buildSignalArticleJsonLd({
    headline: "TSMC bumps capex on AI-accelerator demand",
    slug: "tsm-capex-raise-2026",
    publishedAt: "2026-05-26T00:00:00.000Z",
    bodyMd: "# TSMC bumps capex\n\nTSMC announced a higher capex envelope...\n\n## Evidence",
    entityName: "TSM",
    evidenceUrls: ["https://www.bloomberg.com/x", "https://investor.tsmc.com/y"],
    direction: "up",
    confidence: "high",
    predictedWindowDays: 60,
    signalType: "capex_raise",
  });
  check("type AnalysisNewsArticle", block["@type"] === "AnalysisNewsArticle");
  check("url absolute", isAbsoluteUrl(block.url));
  check("citation array length matches evidence", Array.isArray(block.citation) && (block.citation as unknown[]).length === 2);
  check("first citation url is absolute", isAbsoluteUrl((block.citation as Array<{ url: string }>)[0].url));
  check("about.name is entity", (block.about as { name: string }).name === "TSM");
  check("description skips H1 line",
    typeof block.description === "string" &&
    !block.description.startsWith("# "));
  check("keywords includes signalType + direction + confidence + window",
    typeof block.keywords === "string" &&
    block.keywords.includes("capex_raise") &&
    block.keywords.includes("up") &&
    block.keywords.includes("high") &&
    block.keywords.includes("60d-window"));
}

console.log("\nFAQ JSON-LD");
{
  const block = buildFaqJsonLd([
    { question: "Is it free?", answer: "Yes." },
    { question: "What sources?", answer: "SEC, news, Reddit, HN, etc." },
  ]);
  check("type FAQPage", block["@type"] === "FAQPage");
  check("has 2 mainEntity items", Array.isArray(block.mainEntity) && (block.mainEntity as unknown[]).length === 2);
  const first = (block.mainEntity as Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>)[0];
  check("first item is Question", first["@type"] === "Question");
  check("first item answer type", first.acceptedAnswer["@type"] === "Answer");
}

console.log(`\nseo-json-ld.test.ts: ${total - failures}/${total} passed`);
if (failures > 0) {
  console.error(`seo-json-ld.test.ts: FAILED (${failures} failure${failures === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("seo-json-ld.test.ts: ok");
