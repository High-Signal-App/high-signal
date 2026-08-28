#!/usr/bin/env node

import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ISSUE_NUMBER = 133;
export const RUN_START_TOLERANCE_MS = 10 * 60 * 1000;

export const REQUIRED_CHAIN = [
  { workflow: 'cron-ingest.yml', label: '08:00 IST ingest', utcTime: '02:30:00' },
  { workflow: 'cron-publish.yml', label: '09:00 IST publish', utcTime: '03:30:00' },
  { workflow: 'cron-validate-brief.yml', label: '09:30 IST validation', utcTime: '04:00:00' },
  { workflow: 'personal-brief.yml', label: '10:00 IST delivery', utcTime: '04:30:00' },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export function expectedRunAt(date, utcTime) {
  const value = new Date(`${date}T${utcTime}Z`);
  if (!Number.isFinite(value.getTime())) throw new Error(`invalid UTC date: ${date}`);
  return value;
}

export function closestRun(runs, target, toleranceMs = RUN_START_TOLERANCE_MS) {
  const targetMs = target.getTime();
  return (
    runs
      .filter((run) => run?.event === 'workflow_dispatch')
      .map((run) => ({ run, distance: Math.abs(Date.parse(run.created_at) - targetMs) }))
      .filter(({ distance }) => Number.isFinite(distance) && distance <= toleranceMs)
      .sort((left, right) => left.distance - right.distance)[0]?.run ?? null
  );
}

export function diggAcceptance(verification) {
  const verifiedCandidates = Number(verification?.verifiedCandidates ?? 0);
  const rawMedian = verification?.medianFirstSeenToVerifiedMinutes;
  const numericMedian = rawMedian == null ? Number.NaN : Number(rawMedian);
  const medianMinutes = Number.isFinite(numericMedian) ? numericMedian : null;
  return {
    verifiedCandidates,
    medianMinutes,
    passed: verifiedCandidates > 0 && medianMinutes != null && medianMinutes < 90,
  };
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) await appendFile(outputPath, `${name}=${value}\n`);
}

async function writeSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${lines.join('\n')}\n`);
}

async function main() {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const githubToken = requireEnv('GH_TOKEN');
  const apiBase = requireEnv('API_BASE').replace(/\/$/, '');
  const adminToken = requireEnv('ADMIN_TOKEN');
  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const issue = await fetchJson(
    `https://api.github.com/repos/${repository}/issues/${ISSUE_NUMBER}`,
    { headers: apiHeaders }
  );
  if (issue.state === 'closed') {
    await writeOutput('ready', 'false');
    await writeOutput('already_closed', 'true');
    await writeSummary([
      `## Issue #${ISSUE_NUMBER} acceptance monitor`,
      '',
      'Issue is already closed; no checks or mutations were performed.',
    ]);
    return;
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const chain = [];
  for (const required of REQUIRED_CHAIN) {
    const target = expectedRunAt(date, required.utcTime);
    const url =
      `https://api.github.com/repos/${repository}/actions/workflows/` +
      `${encodeURIComponent(required.workflow)}/runs?event=workflow_dispatch&created=${date}&per_page=50`;
    const payload = await fetchJson(url, { headers: apiHeaders });
    const run = closestRun(payload.workflow_runs ?? [], target);
    chain.push({
      ...required,
      target: target.toISOString(),
      runId: run?.id ?? null,
      url: run?.html_url ?? null,
      createdAt: run?.created_at ?? null,
      conclusion: run?.conclusion ?? null,
      passed: run?.status === 'completed' && run?.conclusion === 'success',
    });
  }

  const diggStatus = await fetchJson(`${apiBase}/admin/digg/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const digg = diggAcceptance(diggStatus.verification);
  const chainPassed = chain.every((item) => item.passed);
  const ready = chainPassed && digg.passed;

  const lines = [
    `## Issue #${ISSUE_NUMBER} acceptance monitor`,
    '',
    `**UTC date checked:** ${date}`,
    '',
    '| Gate | Expected | Observed | Result |',
    '| --- | --- | --- | --- |',
    ...chain.map(
      (item) =>
        `| ${item.label} | ${item.target} | ${item.createdAt ?? 'no on-time run'} | ${item.passed ? 'pass' : (item.conclusion ?? 'missing')} |`
    ),
    `| Digg verified-candidate median | <90m with at least one candidate | ${digg.verifiedCandidates} candidate(s), ${digg.medianMinutes ?? 'n/a'}m median | ${digg.passed ? 'pass' : 'pending'} |`,
    '',
    ready
      ? 'All acceptance gates passed. The workflow may close issue #133.'
      : 'The issue remains open; no evidence or timing gate was weakened.',
  ];
  await writeSummary(lines);
  await writeOutput('ready', String(ready));
  await writeOutput('already_closed', 'false');

  if (ready) {
    const commentPath = process.env.ISSUE_COMMENT_PATH;
    if (!commentPath) throw new Error('ISSUE_COMMENT_PATH is required when acceptance passes');
    await writeFile(
      commentPath,
      [
        'Automated production acceptance completed.',
        '',
        ...chain.map(
          (item) =>
            `- ${item.label}: [run ${item.runId}](${item.url}) started at ${item.createdAt} and passed.`
        ),
        `- Digg: ${digg.verifiedCandidates} verified candidate(s), median first-seen to verified ${digg.medianMinutes} minutes.`,
        '',
        'The current-day scheduled chain and genuine sub-90-minute Digg verification gate both passed. Closing #133.',
      ].join('\n')
    );
  }

  if (!chainPassed) {
    throw new Error(
      'one or more required scheduled workflow runs were missing, late, or unsuccessful'
    );
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
