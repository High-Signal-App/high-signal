#!/usr/bin/env tsx
/**
 * Promote existing draft signals to the public feed.
 *
 *   pnpm tsx scripts/publish-drafts.ts --local
 *   pnpm tsx scripts/publish-drafts.ts --remote
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = resolve(__root, ".tmp");
const TMP_SQL = resolve(TMP_DIR, "publish-drafts.sql");
const flag = process.argv.includes("--remote") ? "--remote" : "--local";

function run() {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(
    TMP_SQL,
    "UPDATE signals SET review_status = 'published' WHERE review_status = 'draft';\n",
  );
  console.log(`[publish-drafts] wrote ${TMP_SQL}`);

  const proc = spawn(
    "pnpm",
    [
      "--dir",
      "packages/db",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "high-signal-db",
      flag,
      `--file=${TMP_SQL}`,
      "--config=../../workers/api/wrangler.toml",
    ],
    { stdio: "inherit", cwd: __root },
  );
  proc.on("close", (code) => process.exit(code ?? 0));
}

run();
