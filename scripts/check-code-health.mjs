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
  'apps/web/legacy-worker.mjs',
  'apps/web/reader-artifacts.mjs',
  'apps/reader/src',
  'apps/reader/scripts',
  'packages/db/src',
  'packages/shared/src',
  'python/ingest/src',
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
  // Ratcheted 2026-09-13 after the product-boundary cleanup.
  const baseline = { violations: 79, maxCcn: 56, maxLength: 394, maxParams: 11 };
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
  // Ratcheted 2026-09-13 after the product-boundary cleanup.
  const baseline = { clones: 80, duplicatedLines: 1012, percentage: 1.9474646396613104 };
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
  const unexpected = advisories.filter((advisory) =>
    ['critical', 'high'].includes(advisory.severity)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unaccepted critical/high advisories: ${unexpected
        .map((advisory) => advisory.github_advisory_id)
        .join(', ')}`
    );
  }
  // Debt: https://github.com/High-Signal-App/high-signal/issues/104
  const baseline = { critical: 0, high: 0, productionCritical: 0, productionHigh: 0 };
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
  // Ratcheted 2026-09-13 after the product-boundary cleanup.
  const baseline = { count: 45 };
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
  // Ratcheted 2026-09-13 after the product-boundary cleanup.
  const baseline = { exports: 17, types: 14 };
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
