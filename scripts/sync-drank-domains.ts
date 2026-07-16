#!/usr/bin/env tsx
/**
 * Sync script for the drank (Domain Rating) companion data.
 * Pulls the latest shared global DR history + nominations from the public drank pipeline
 * and writes a local copy for high-signal consumption.
 *
 * Run: pnpm tsx scripts/sync-drank-domains.ts
 * Recommended: hook into existing data refresh pipelines.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const RAW_BASE = "https://raw.githubusercontent.com/High-Signal-App/drank/main/data";
const OUT_PATH = join(process.cwd(), "data/dr-domains.json");

async function main() {
  console.log("Syncing drank domain data...");

  const [drRes, sitesRes] = await Promise.all([
    fetch(`${RAW_BASE}/global-dr.json`),
    fetch(`${RAW_BASE}/global-sites.json`),
  ]);

  if (!drRes.ok || !sitesRes.ok) {
    throw new Error("Failed to fetch drank data");
  }

  const drData = await drRes.json();
  const sites: string[] = await sitesRes.json();

  const payload = {
    lastUpdated: drData.lastUpdated,
    sites,
    domains: drData.domains,
    communityNominations: drData.communityNominations || [],
    source: "drank",
    sourceUrl: "https://drank-sand.vercel.app",
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH} (${Object.keys(drData.domains || {}).length} domains)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
