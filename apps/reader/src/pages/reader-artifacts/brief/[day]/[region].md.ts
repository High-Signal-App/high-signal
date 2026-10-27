import { createElement } from 'react';
import { istDay } from '@high-signal/shared';
import { BriefContent } from '../../../../components/BriefContent';
import { briefInput } from '../../../../input';
import { publicSourceTree } from '@/lib/public-source-tree';
import { absoluteMarkdownLinks } from '@web-root/agent-surfaces/format.mjs';
import { SITE_URL } from '@/lib/site';
export function getStaticPaths() {
  return (briefInput?.entries ?? []).map((entry) => ({
    params: { day: entry.day, region: entry.brief.region },
    props: { entry, capturedAt: briefInput!.capturedAt },
  }));
}
export async function GET({
  props,
}: {
  props:
    | Parameters<typeof BriefContent>[0]
    | { entry: NonNullable<typeof briefInput>['entries'][number]; capturedAt: string };
}) {
  if (!('entry' in props)) throw new Error('Missing public brief input');
  const editionDate =
    props.entry.brief.editionDate ??
    istDay(new Date(props.capturedAt), props.entry.day === 'yesterday' ? -1 : 0);
  const marker = `<!-- data-high-signal-reader="brief-v1" data-edition-date="${editionDate}" data-region="${props.entry.brief.region}" -->`;
  const content = await publicSourceTree(
    createElement(BriefContent, {
      brief: props.entry.brief,
      day: props.entry.day,
      capturedAt: props.capturedAt,
    }),
    { canonical: SITE_URL + '/' }
  );
  return new Response(
    absoluteMarkdownLinks(
      `# High Signal — Technology, startups and finance brief\n\n> Read the daily technology, startup and finance brief with attributed news, evidence-qualified signals, source links, uncertainties and permanent signal history.\n\nCanonical: ${SITE_URL}/\n\n${marker}\n\n${content.replace(/^# [^\n]*\n/m, '').trim()}\n`,
      SITE_URL + '/'
    ),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }
  );
}
