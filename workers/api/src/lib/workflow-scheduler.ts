import type { Env } from '../app';

const GITHUB_REPOSITORY = 'High-Signal-App/high-signal';
const GITHUB_API_VERSION = '2022-11-28';

export type ScheduledWorkflow = {
  workflow: string;
  purpose: 'reddit-archive' | 'digg' | 'ingest' | 'publish' | 'validate' | 'deliver';
  inputs?: Record<string, string>;
};

const DAILY_WORKFLOWS = new Map<string, ScheduledWorkflow>([
  ['02:30', { workflow: 'cron-ingest.yml', purpose: 'ingest' }],
  ['03:30', { workflow: 'cron-publish.yml', purpose: 'publish' }],
  ['04:00', { workflow: 'cron-validate-brief.yml', purpose: 'validate' }],
  ['04:30', { workflow: 'personal-brief.yml', purpose: 'deliver' }],
]);

export type WorkflowDispatchResult = ScheduledWorkflow & {
  slotId: string;
  status: 'dispatched' | 'duplicate' | 'failed' | 'disabled';
  statusCode?: number;
};

function utcSlot(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function workflowsDueAt(scheduledAt: Date): ScheduledWorkflow[] {
  const minute = scheduledAt.getUTCMinutes();
  if (scheduledAt.getUTCHours() === 0 && minute === 17) {
    return [
      {
        workflow: 'cron-reddit-archive.yml',
        purpose: 'reddit-archive',
        inputs: {
          cohort: 'all',
          runner: 'github-hosted',
          window_end: scheduledAt.toISOString(),
        },
      },
    ];
  }
  if (minute !== 0 && minute !== 30) return [];

  const due: ScheduledWorkflow[] = [{ workflow: 'cron-digg.yml', purpose: 'digg' }];
  const time = `${String(scheduledAt.getUTCHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const daily = DAILY_WORKFLOWS.get(time);
  if (daily) due.push(daily);
  return due;
}

async function claimDispatch(
  db: D1Database,
  slotId: string,
  item: ScheduledWorkflow,
  slotAt: number,
  attemptedAt: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO workflow_dispatches
        (id, workflow, purpose, slot_at, status, attempts, created_at, last_attempt_at)
       VALUES (?, ?, ?, ?, 'claimed', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status='claimed',
         attempts=workflow_dispatches.attempts + 1,
         last_attempt_at=excluded.last_attempt_at,
         error=NULL
       WHERE workflow_dispatches.status='failed' AND workflow_dispatches.attempts < 3`
    )
    .bind(slotId, item.workflow, item.purpose, slotAt, attemptedAt, attemptedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

async function finishDispatch(
  db: D1Database,
  slotId: string,
  status: 'dispatched' | 'failed',
  attemptedAt: number,
  error: string | null
) {
  await db
    .prepare(
      `UPDATE workflow_dispatches
       SET status=?, dispatched_at=CASE WHEN ?='dispatched' THEN ? ELSE dispatched_at END,
           error=?
       WHERE id=?`
    )
    .bind(status, status, attemptedAt, error, slotId)
    .run();
}

export async function dispatchDueWorkflows(
  env: Pick<Env, 'DB' | 'GITHUB_WORKFLOW_TOKEN'>,
  scheduledAt: Date,
  options: { fetch?: typeof fetch; attemptedAt?: Date } = {}
): Promise<WorkflowDispatchResult[]> {
  const due = workflowsDueAt(scheduledAt);
  if (due.length === 0) return [];

  const slot = utcSlot(scheduledAt);
  if (!env.GITHUB_WORKFLOW_TOKEN) {
    return due.map((item) => ({
      ...item,
      slotId: `${item.workflow}:${slot}`,
      status: 'disabled',
    }));
  }

  const fetcher = options.fetch ?? fetch;
  const attemptedAt = Math.floor((options.attemptedAt ?? new Date()).getTime() / 1000);
  const slotAt = Math.floor(scheduledAt.getTime() / 1000);
  const results: WorkflowDispatchResult[] = [];

  for (const item of due) {
    const slotId = `${item.workflow}:${slot}`;
    const claimed = await claimDispatch(env.DB, slotId, item, slotAt, attemptedAt);
    if (!claimed) {
      results.push({ ...item, slotId, status: 'duplicate' });
      continue;
    }

    try {
      const response = await fetcher(
        `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${item.workflow}/dispatches`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'high-signal-scheduler',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
          },
          body: JSON.stringify({
            ref: 'main',
            ...(item.inputs ? { inputs: item.inputs } : {}),
          }),
        }
      );
      if (response.status !== 204) {
        const error = `github_dispatch_${response.status}`;
        await finishDispatch(env.DB, slotId, 'failed', attemptedAt, error);
        results.push({ ...item, slotId, status: 'failed', statusCode: response.status });
        continue;
      }
      await finishDispatch(env.DB, slotId, 'dispatched', attemptedAt, null);
      results.push({ ...item, slotId, status: 'dispatched', statusCode: response.status });
    } catch (error) {
      const message = error instanceof Error ? error.name : 'dispatch_error';
      await finishDispatch(env.DB, slotId, 'failed', attemptedAt, message.slice(0, 120));
      results.push({ ...item, slotId, status: 'failed' });
    }
  }
  return results;
}
