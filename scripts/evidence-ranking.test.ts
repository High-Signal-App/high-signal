#!/usr/bin/env tsx
/**
 * Unit tests for evidence ranking (packages/shared signal-intelligence).
 *
 * Fixtures are the real defects observed in the live /brief/daily payload on
 * 2026-07-04: authoritative/on-topic citations were sitting BEHIND off-topic
 * or low-authority ones, so the brief email (caps at 2) led with the weak link.
 * rankEvidenceUrls reorders strongest-first without dropping anything.
 *
 * Run: `pnpm evidence-ranking:test`
 */

import { entityMatchTokens, evidenceScore, rankEvidenceUrls } from "@high-signal/shared";

let failures = 0;
let total = 0;

function check(label: string, cond: boolean) {
  total++;
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}
const first = (urls: string[], t: Parameters<typeof rankEvidenceUrls>[1]) =>
  rankEvidenceUrls(urls, t)[0];

console.log("entityMatchTokens");
check(
  "drops corporate boilerplate + short tokens",
  JSON.stringify(entityMatchTokens({ entityName: "HCL Technologies", ticker: "HCLTECH.NS" })) ===
    JSON.stringify(["hcl", "hcltech"]),
);
check(
  "numeric ticker base dropped (no alpha)",
  !entityMatchTokens({ entityName: "SK Hynix Inc.", ticker: "000660.KS" }).includes("000660"),
);
check(
  "keeps distinctive name tokens",
  entityMatchTokens({ entityName: "Alphabet Inc.", ticker: "GOOGL" }).includes("alphabet") &&
    entityMatchTokens({ entityName: "Alphabet Inc.", ticker: "GOOGL" }).includes("googl"),
);

console.log("\nrankEvidenceUrls — real 2026-07-04 defects");

// HCL design-win: a Bajaj Housing Finance article was stored ahead of hcltech.com.
check(
  "HCL: company IR beats an unrelated Bajaj Housing article",
  first(
    [
      "https://economictimes.indiatimes.com/markets/stocks/news/bajaj-housing-finance-shares-rally-5-as-q1-aum-climbs-24-yoy/articleshow/132152873.cms",
      "https://www.hcltech.com/investors",
    ],
    { entityName: "HCL Technologies", ticker: "HCLTECH.NS" },
  ) === "https://www.hcltech.com/investors",
);

// Alphabet capex: a crates.io Rust-crate page was stored ahead of the SEC XBRL filing.
check(
  "Alphabet: SEC XBRL beats crates.io/hashbrown",
  first(
    [
      "https://crates.io/crates/hashbrown",
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0001652044.json",
    ],
    { entityName: "Alphabet Inc.", ticker: "GOOGL" },
  ) === "https://data.sec.gov/api/xbrl/companyfacts/CIK0001652044.json",
);

// Intel partnership: prediction markets must never lead over real reporting.
check(
  "Intel: news beats a Manifold prediction market",
  first(
    [
      "https://manifold.markets/SimoneRomeo/will-intel-manufacture-nvidia-chips",
      "https://www.cnbc.com/2026/07/03/intel-nvidia-foundry-deal.html",
    ],
    { entityName: "Intel Corporation", ticker: "INTC" },
  ) === "https://www.cnbc.com/2026/07/03/intel-nvidia-foundry-deal.html",
);

console.log("\nrankEvidenceUrls — invariants");
const sample = [
  "https://manifold.markets/x/y",
  "https://www.hcltech.com/investors",
  "https://reddit.com/r/x/comments/1",
];
const ranked = rankEvidenceUrls(sample, { entityName: "HCL Technologies", ticker: "HCLTECH.NS" });
check("preserves count (nothing dropped)", ranked.length === sample.length);
check("same set of URLs", JSON.stringify([...ranked].sort()) === JSON.stringify([...sample].sort()));
check("deterministic across runs", JSON.stringify(ranked) === JSON.stringify(rankEvidenceUrls(sample, { entityName: "HCL Technologies", ticker: "HCLTECH.NS" })));
check("empty input → empty output", rankEvidenceUrls([], { entityName: "X" }).length === 0);
check(
  "on-topic 'other' outranks off-topic 'official'",
  evidenceScore("https://www.hcltech.com/design-wins", { entityName: "HCL Technologies", ticker: "HCLTECH.NS" }) >
    evidenceScore("https://www.sec.gov/some-unrelated-filing", { entityName: "HCL Technologies", ticker: "HCLTECH.NS" }),
);
check(
  "malformed URL does not throw",
  typeof evidenceScore("not a url %E0%A4", { entityName: "HCL" }) === "number",
);

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
