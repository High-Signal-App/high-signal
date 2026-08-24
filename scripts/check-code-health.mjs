#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionPaths = [
  'apps/web/src',
  'apps/web/agent-edge.mjs',
  'apps/web/public-corpus-policy.mjs',
  'apps/web/public-corpus-records.mjs',
  'apps/web/public-corpus-receipt.mjs',
  'apps/web/public-route-registry.mjs',
  'apps/web/timing.mjs',
  'apps/web/worker.mjs',
  'packages/db/src',
  'packages/shared/src',
  'python/ingest/src',
  'python/lab/src',
  'scripts',
  'workers/api/src',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

function failRegressions(label, observed, baseline) {
  const regressions = Object.entries(baseline).filter(([key, maximum]) => observed[key] > maximum);
  if (regressions.length > 0) {
    throw new Error(
      regressions
        .map(([key, maximum]) => `${label} ${key} regressed: ${observed[key]} > ${maximum}`)
        .join('\n')
    );
  }
  if (Object.entries(baseline).some(([key, maximum]) => observed[key] < maximum)) {
    console.log(`${label} improved; lower the checked-in baseline in the next intentional update.`);
  }
}

function checkComplexity() {
  const result = run('uv', [
    'run',
    '--project',
    'python/ingest',
    '--no-sync',
    'lizard',
    ...productionPaths,
    '-x',
    '**/*.test.*',
    '-x',
    '**/*.spec.*',
    '-x',
    '**/*artifact*.ts',
    '--csv',
  ]);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => line.match(/^(\d+),(\d+),(\d+),(\d+),(\d+),/u))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number));
  const observed = {
    functions: rows.length,
    nloc: rows.reduce((sum, row) => sum + row[0], 0),
    violations: rows.filter((row) => row[1] > 20 || row[4] > 100 || row[3] > 7).length,
    maxCcn: Math.max(0, ...rows.map((row) => row[1])),
    maxLength: Math.max(0, ...rows.map((row) => row[4])),
    maxParams: Math.max(0, ...rows.map((row) => row[3])),
  };
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  // Ratcheted 2026-08-22 (ADR-013 removals).
  const baseline = { violations: 108, maxCcn: 56, maxLength: 398, maxParams: 11 };
  console.log(
    `Complexity: ${observed.functions} functions, ${observed.nloc} NLOC, ` +
      `${observed.violations} violations; max CCN ${observed.maxCcn}, ` +
      `max length ${observed.maxLength}, max params ${observed.maxParams}.`
  );
  failRegressions('Complexity', observed, baseline);
}

function checkDuplication() {
  const outputDirectory = join(tmpdir(), `high-signal-jscpd-${process.pid}`);
  run('pnpm', [
    'exec',
    'jscpd',
    ...productionPaths,
    '--format',
    'javascript,typescript,python',
    '--min-lines',
    '8',
    '--min-tokens',
    '60',
    '--mode',
    'strict',
    '--ignore',
    '**/*.test.*,**/*.spec.*,**/*artifact*.ts,**/node_modules/**,**/coverage/**,**/dist/**',
    '--reporters',
    'json',
    '--output',
    outputDirectory,
    '--silent',
    '--no-tips',
  ]);
  const observed = JSON.parse(readFileSync(join(outputDirectory, 'jscpd-report.json'), 'utf8'))
    .statistics.total;
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  // Re-baselined 2026-08-24 after consolidating the two scheduled D1 sync
  // launchers. Absolute duplication fell from 110 to 109 clone groups and
  // from 1451 to 1433 duplicated lines. Ratchet all three observed values.
  const baseline = { clones: 109, duplicatedLines: 1433, percentage: 2.4384433440536353 };
  console.log(
    `Duplication: ${observed.duplicatedLines}/${observed.lines} lines ` +
      `(${observed.percentage.toFixed(4)}%), ${observed.clones} groups across ` +
      `${observed.sources} files.`
  );
  failRegressions('Duplication', observed, baseline);
}

function checkDependencies() {
  const result = run('pnpm', ['audit', '--json'], { allowFailure: true });
  const report = JSON.parse(result.stdout);
  const advisories = Object.values(report.advisories ?? {});
  const productionReport = JSON.parse(
    run('pnpm', ['audit', '--prod', '--json'], { allowFailure: true }).stdout
  );
  const productionAdvisories = Object.values(productionReport.advisories ?? {});
  const observed = {
    critical: advisories.filter((advisory) => advisory.severity === 'critical').length,
    high: advisories.filter((advisory) => advisory.severity === 'high').length,
    productionCritical: productionAdvisories.filter((advisory) => advisory.severity === 'critical')
      .length,
    productionHigh: productionAdvisories.filter((advisory) => advisory.severity === 'high').length,
  };
  const acceptedHighIds = new Set([
    'GHSA-2p49-hgcm-8545',
    'GHSA-2pvr-wf23-7pc7',
    'GHSA-2v37-7h3g-55p8',
    'GHSA-3jxr-9vmj-r5cp',
    'GHSA-4c8g-83qw-93j6',
    'GHSA-4cwx-7wf7-3272',
    'GHSA-52cp-r559-cp3m',
    'GHSA-5p2g-fcmc-qvqq',
    'GHSA-5p4m-2wfm-xmqj',
    'GHSA-5wm8-gmm8-39j9',
    'GHSA-66ff-xgx4-vchm',
    'GHSA-685m-2w69-288q',
    'GHSA-6g55-p6wh-862q',
    'GHSA-75px-5xx7-5xc7',
    'GHSA-7p8r-x3mc-p8w7',
    'GHSA-8hv8-536x-4wqp',
    'GHSA-96hv-2xvq-fx4p',
    'GHSA-f88m-g3jw-g9cj',
    'GHSA-fv7c-fp4j-7gwp',
    'GHSA-hm92-r4w5-c3mj',
    'GHSA-hmw2-7cc7-3qxx',
    'GHSA-jvwf-75h9-cwgg',
    'GHSA-mh99-v99m-4gvg',
    'GHSA-q3j6-qgpj-74h6',
    'GHSA-qjx8-664m-686j',
    'GHSA-r28c-9q8g-f849',
    'GHSA-rgw5-rvv9-x895',
    'GHSA-v2hh-gcrm-f6hx',
    'GHSA-v39h-62p7-jpjc',
    'GHSA-vmh5-mc38-953g',
    'GHSA-vxpw-j846-p89q',
    'GHSA-w3rx-r6r6-pgpr',
    'GHSA-wcpc-wj8m-hjx6',
  ]);
  const unexpected = advisories.filter(
    (advisory) =>
      ['critical', 'high'].includes(advisory.severity) &&
      !acceptedHighIds.has(advisory.github_advisory_id)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unaccepted critical/high advisories: ${unexpected
        .map((advisory) => advisory.github_advisory_id)
        .join(', ')}`
    );
  }
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  const baseline = { critical: 0, high: 39, productionCritical: 0, productionHigh: 17 };
  console.log(
    `Dependencies: ${observed.critical} critical, ${observed.high} high total; ` +
      `${observed.productionCritical} critical, ${observed.productionHigh} high in production.`
  );
  failRegressions('Dependencies', observed, baseline);
}

function checkSuppressions() {
  const result = run(
    'git',
    [
      'grep',
      '-n',
      '-E',
      '(biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|istanbul ignore|c8 ignore|# (noqa|type: ignore|pragma: no cover))',
      '--',
      ...productionPaths,
      ':(exclude)scripts/check-code-health.mjs',
    ],
    { allowFailure: true }
  );
  const observed = result.stdout.trim() ? result.stdout.trim().split('\n').length : 0;
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  const baseline = { count: 52 };
  console.log(`Suppressions: ${observed} inline directives.`);
  failRegressions('Suppressions', { count: observed }, baseline);
}

function checkPythonFormat() {
  const result = run(
    'uv',
    [
      'run',
      '--project',
      'python/ingest',
      '--no-sync',
      'ruff',
      'format',
      '--check',
      'python/ingest/src',
      'python/lab/src',
    ],
    { allowFailure: true }
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = output.match(/(\d+) files? would be reformatted/u);
  const observed = { files: match ? Number(match[1]) : 0 };
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  const baseline = { files: 0 };
  console.log(`Python format: ${observed.files} files outside the Ruff format baseline.`);
  failRegressions('Python format', observed, baseline);
}

function checkUnused() {
  run('pnpm', [
    'exec',
    'knip',
    '--dependencies',
    '--include',
    'files,dependencies,unlisted,unresolved,binaries',
    '--reporter',
    'symbols',
    '--no-config-hints',
  ]);
  const report = JSON.parse(
    run('pnpm', [
      'exec',
      'knip',
      '--include',
      'exports,types',
      '--reporter',
      'json',
      '--no-exit-code',
      '--no-config-hints',
    ]).stdout
  );
  const observed = report.issues.reduce(
    (counts, issue) => ({
      exports: counts.exports + (issue.exports?.length ?? 0),
      types: counts.types + (issue.types?.length ?? 0),
    }),
    { exports: 0, types: 0 }
  );
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  // Ratcheted 2026-08-22 (ADR-013 removals).
  const baseline = { exports: 27, types: 29 };
  console.log(
    `Unused: 0 high-confidence findings; ${observed.exports} exports, ${observed.types} types.`
  );
  failRegressions('Unused', observed, baseline);
}

const checks = {
  complexity: checkComplexity,
  dependencies: checkDependencies,
  duplication: checkDuplication,
  'python-format': checkPythonFormat,
  suppressions: checkSuppressions,
  unused: checkUnused,
};
const selected = process.argv[2];

if (!Object.hasOwn(checks, selected)) {
  console.error(`Usage: check-code-health.mjs <${Object.keys(checks).join('|')}>`);
  process.exit(2);
}

try {
  checks[selected]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
