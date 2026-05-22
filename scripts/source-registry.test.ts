#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SourceType = "reddit" | "hacker-news" | "github-issues" | "rss";
type RegistrySource = {
  id: string;
  type: SourceType;
  label: string;
  target: string;
  period: "day" | "week" | "month";
  limit?: number;
  query?: string;
  intent: string;
};

type SourceRegistry = {
  updatedAt: string;
  description: string;
  sources: RegistrySource[];
};

const ROOT = resolve(__dirname, "..");
const registry = JSON.parse(
  readFileSync(resolve(ROOT, "data/personal-source-registry.json"), "utf8"),
) as SourceRegistry;

function countBy<T extends string>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sourceClass(source: RegistrySource) {
  const id = source.id.toLowerCase();
  const text = `${source.label} ${source.target} ${source.query ?? ""} ${source.intent}`.toLowerCase();
  if (/india|bangalore|mumbai|delhi|nyc|bayarea|london|toronto|regional/.test(id) || /regional|city|local constraints/.test(text)) {
    return "regional";
  }
  if (
    /smallbusiness|small-business|ecommerce|shopify|etsy|freelance|seller|merchant|marketing|sales|accounting|creator/.test(id) ||
    /small business|ecommerce|shopify|etsy|freelance|seller|merchant|marketing|sales|accounting|creator/.test(text)
  ) {
    return "small-business";
  }
  if (/personalfinance|povertyfinance|jobs|consumer/.test(id) || /consumer|budget|affordability|labor market|jobs/.test(text)) {
    return "public-consumer";
  }
  if (
    /saas|startup|sideproject|entrepreneur|indiehackers|productmanagement|product-validation/.test(id) ||
    /startup|validation|launch|distribution|product management|roadmap|prioritization/.test(text)
  ) {
    return "startup-builder";
  }
  if (/market|stripe|payments|commerce|cloudflare|github|google|openai|anthropic|rss-/.test(id)) {
    return "platform-primary";
  }
  return "ai-dev";
}

assert.match(registry.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.ok(registry.description.includes("not broad web scraping"));
assert.ok(registry.sources.length >= 65, "registry should stay broad enough for non-AI coverage");

const ids = registry.sources.map((source) => source.id);
assert.equal(new Set(ids).size, ids.length, "source ids must be unique");

for (const source of registry.sources) {
  assert.match(source.id, /^[a-z0-9-]+$/);
  assert.ok(source.label.trim(), `${source.id} needs a label`);
  assert.ok(source.target.trim(), `${source.id} needs a target`);
  assert.ok(source.intent.trim().length >= 40, `${source.id} needs a specific intent`);
  assert.ok((source.limit ?? 8) >= 4 && (source.limit ?? 8) <= 12, `${source.id} should stay concise`);
  if (source.type === "rss") assert.match(source.target, /^https:\/\//, `${source.id} rss target must be https`);
}

const byType = countBy(registry.sources.map((source) => source.type));
assert.ok((byType.get("reddit") ?? 0) >= 35, "reddit coverage should include broad public/community sources");
assert.ok((byType.get("hacker-news") ?? 0) >= 8, "HN coverage should remain present");
assert.ok((byType.get("github-issues") ?? 0) >= 9, "GitHub issue coverage should remain present");
assert.ok((byType.get("rss") ?? 0) >= 15, "RSS/news/primary-source coverage should remain present");

const byClass = countBy(registry.sources.map(sourceClass));
assert.ok((byClass.get("ai-dev") ?? 0) >= 8, "AI/developer workflow coverage should remain present");
assert.ok((byClass.get("startup-builder") ?? 0) >= 5, "startup-builder coverage should remain present");
assert.ok((byClass.get("small-business") ?? 0) >= 12, "small-business coverage should remain present");
assert.ok((byClass.get("public-consumer") ?? 0) >= 6, "public-consumer coverage should remain present");
assert.ok((byClass.get("regional") ?? 0) >= 8, "regional coverage should remain present");
assert.ok((byClass.get("platform-primary") ?? 0) >= 12, "primary platform/news coverage should remain present");

console.log("source-registry.test.ts: ok");
