#!/usr/bin/env node
// Concurrent test runner for the high-signal monorepo.
//
// The previous root `test` script chained ~14 suites with `&&`, so every suite
// paid the full tsx cold-start serially (~10s wall, dominated by startup, not
// assertions). This runner spawns the same suites concurrently with a worker
// pool capped at the CPU count, aggregates pass/fail, prints captured output
// for failures, and exits non-zero if any suite fails.
//
// Intentionally NOT vitest — these suites are plain tsx scripts that assert and
// `process.exit(1)` on failure; a runner is a far smaller change than a migration.

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Each job: { name, cmd, args }. tsx suites run directly via the local tsx bin;
// the workers/api vitest suite runs through pnpm so it uses the package config.
const TSX_SUITES = [
  ["signals", "scripts/sync-signals.test.ts"],
  ["signals:auto-publish", "scripts/auto-publish-rules.test.ts"],
  ["seo", "scripts/seo-json-ld.test.ts"],
  ["requirements", "scripts/daily-requirements.test.ts"],
  ["daily-range", "scripts/daily-range.test.ts"],
  ["source-registry", "scripts/source-registry.test.ts"],
  ["daily-automation", "scripts/daily-automation-status.test.ts"],
  ["daily-source-audit", "scripts/daily-source-audit.test.ts"],
  ["market-snapshot", "scripts/market-snapshot.test.ts"],
  ["claim-provenance", "scripts/claim-provenance.test.ts"],
  ["brief-delivery", "scripts/brief-delivery.test.ts"],
  ["watchlist-impact", "scripts/watchlist-impact.test.ts"],
  ["openlens-visibility", "scripts/openlens-visibility.test.ts"],
  ["intent-opportunities", "scripts/intent-opportunities.test.ts"],
];

const tsxBin = resolve(ROOT, "node_modules/.bin/tsx");

const jobs = [
  // Workspace package tests (equivalent to the old `pnpm -r test`; only
  // workers/api defines a `test` script today — a Vitest run).
  { name: "workers/api (vitest)", cmd: "pnpm", args: ["-r", "test"] },
  ...TSX_SUITES.map(([name, file]) => ({ name, cmd: tsxBin, args: [file] })),
];

const concurrency = Math.max(1, Math.min(jobs.length, availableParallelism()));

function runJob(job) {
  return new Promise((resolveJob) => {
    const started = Date.now();
    const child = spawn(job.cmd, job.args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      resolveJob({ job, code: 1, ms: Date.now() - started, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      resolveJob({ job, code: code ?? 1, ms: Date.now() - started, stdout, stderr });
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      process.stdout.write(`  → ${job.name}\n`);
      const result = await runJob(job);
      results.push(result);
      const status = result.code === 0 ? "PASS" : "FAIL";
      process.stdout.write(`  ${status} ${job.name} (${(result.ms / 1000).toFixed(1)}s)\n`);
    }
  }

  console.log(`Running ${jobs.length} test suites with concurrency ${concurrency}...\n`);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const failures = results.filter((r) => r.code !== 0);

  if (failures.length) {
    console.log(`\n${"=".repeat(60)}\nFAILURES (${failures.length})\n${"=".repeat(60)}`);
    for (const f of failures) {
      console.log(`\n----- ${f.job.name} (exit ${f.code}) -----`);
      if (f.stdout.trim()) console.log(f.stdout.trimEnd());
      if (f.stderr.trim()) console.error(f.stderr.trimEnd());
    }
  }

  const passed = results.length - failures.length;
  const totalMs = Date.now() - startedAt;
  console.log(
    `\n${failures.length ? "✗" : "✓"} ${passed}/${results.length} suites passed in ${(totalMs / 1000).toFixed(1)}s`,
  );

  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
