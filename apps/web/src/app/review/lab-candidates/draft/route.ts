import type { NextRequest } from 'next/server';
import { requireSignedIn } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

/**
 * Hands the operator a pre-filled signal markdown file derived from a Lab
 * candidate. The operator drops the downloaded `.md` into
 * `signals/<YYYY-MM-DD>/<slug>.md`, reviews + edits, then runs the existing
 * `pnpm signals:sync:local`. Closes the discovery → curation loop without
 * needing direct filesystem access from a Cloudflare Worker.
 */
export async function GET(request: NextRequest) {
  await requireSignedIn();
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const sourceUrl = url.searchParams.get('url') ?? '';
  const title = (url.searchParams.get('title') ?? 'untitled candidate').trim();

  const today = new Date().toISOString().slice(0, 10);
  const slug = slugify(title) || `lab-${id || Date.now()}`;
  const markdown = template({ slug, title, sourceUrl, today });

  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${today}-${slug}.md"`,
    },
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

function template(input: {
  slug: string;
  title: string;
  sourceUrl: string;
  today: string;
}): string {
  return `---
slug: ${input.slug}
signal_type: TODO_FILL_IN
primary_entity: TODO_TICKER_OR_ID
direction: neutral
confidence: low
predicted_window_days: 14
published_at: ${input.today}T12:00:00Z
evidence_urls:
  - ${input.sourceUrl || 'TODO_PRIMARY_SOURCE_URL'}
  - TODO_SECONDARY_SOURCE_URL
spillover_entity_ids: []
supersedes: null
review_status: draft
---

# ${input.title}

> Drafted from a Lab candidate on ${input.today}. Fill in every \`TODO_*\`
> placeholder above, add a second independent source, and flip
> \`review_status\` to \`published\` once the evidence holds up.

## What changed

(Describe the specific change in concrete language. Avoid claims you can't cite.)

## Why it matters

(Explain the directional implication. What does this make likely or unlikely
in the predicted window?)

## Evidence

- ${input.sourceUrl || 'PRIMARY'} — what this confirms
- SECONDARY — what this corroborates

## Spillover

(List the supplier / customer / peer entities affected, with the relationship type.)

## Confidence

(Why low / medium / high. What would change the band up or down.)
`;
}
