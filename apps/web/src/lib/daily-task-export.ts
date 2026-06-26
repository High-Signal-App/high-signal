import type { DailyRequirementItem } from '@/lib/daily-requirements';
import type { PersonalActionTask } from '@high-signal/shared';

export type DailyRequirementTaskExport = {
  id: string;
  requirementId: string;
  projectSlug: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  status: PersonalActionTask['status'];
  action: PersonalActionTask['action'];
  description: string;
  acceptanceCriteria: string[];
  evidenceUrls: string[];
  task: PersonalActionTask;
};

function taskPriority(task: PersonalActionTask): DailyRequirementTaskExport['priority'] {
  return task.priority === 'critical' ? 'high' : task.priority;
}

function taskDescription(task: PersonalActionTask) {
  const acceptance = task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n');
  const evidence = task.evidenceUrls.map((url) => `- ${url}`).join('\n');
  return [
    task.rationale,
    '',
    `Next step: ${task.nextStep}`,
    '',
    'Acceptance:',
    acceptance,
    evidence ? '' : null,
    evidence ? 'Evidence:' : null,
    evidence || null,
    '',
    `Generated from High Signal daily requirement: ${task.recommendationId}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function buildDailyRequirementTaskExports(
  requirements: DailyRequirementItem[]
): DailyRequirementTaskExport[] {
  return requirements
    .map((requirement) => {
      const task = requirement.taskDraft;
      if (!task) return null;
      return {
        id: task.id,
        requirementId: requirement.id,
        projectSlug: task.saasMakerProjectSlug,
        title: task.title,
        priority: taskPriority(task),
        status: task.status,
        action: task.action,
        description: taskDescription(task),
        acceptanceCriteria: task.acceptanceCriteria,
        evidenceUrls: task.evidenceUrls,
        task,
      };
    })
    .filter((item): item is DailyRequirementTaskExport => item !== null);
}
