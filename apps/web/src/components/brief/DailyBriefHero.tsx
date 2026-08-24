import Link from 'next/link';
import type { Route } from 'next';
import { RegionPicker } from '@/components/brief/RegionPicker';
import {
  categoryStatesForSnapshot,
  regionLabel,
  type BriefCategoryStatus,
  type BriefSnapshot,
  type Region,
} from '@high-signal/shared';

function stateLabel(status: BriefCategoryStatus, count: number) {
  if (status === 'ready') return `${count} ${count === 1 ? 'item' : 'items'}`;
  if (status === 'unavailable') return 'unavailable';
  return 'no qualifying items';
}

export function DailyBriefHero({
  brief,
  region,
  editionDate,
}: {
  brief: BriefSnapshot;
  region: Region;
  editionDate?: string;
}) {
  const generated = brief.generatedAt.slice(0, 16).replace('T', ' ');
  const date = editionDate ?? brief.generatedAt.slice(0, 10);
  const states = categoryStatesForSnapshot(brief);
  const attentionCount =
    (brief.attentionLeaders?.length ?? 0) +
    (brief.emergingBeforeMainstream?.length ?? 0) +
    (brief.attentionEvidenceGaps?.length ?? 0);
  const hasAttentionData =
    brief.attentionLeaders !== undefined &&
    brief.emergingBeforeMainstream !== undefined &&
    brief.attentionEvidenceGaps !== undefined;
  const coreContents = [
    {
      href: '#markets-companies',
      label: 'Markets & companies',
      status: states.stocks.status,
      count: brief.stocks.length,
    },
    {
      href: '#business-opportunities',
      label: 'Business opportunities',
      status: states.ideas.status,
      count: brief.ideas.length,
    },
    {
      href: '#behavior-culture',
      label: 'Behavior & culture',
      status: states.trends.status,
      count: brief.trends.length,
    },
  ] as const;
  const attentionContents = {
    href: '#attention-layer',
    label: 'Attention layer',
    status:
      attentionCount > 0
        ? ('ready' as const)
        : hasAttentionData
          ? ('empty' as const)
          : ('unavailable' as const),
    count: attentionCount,
  };
  const hasCoreContent = brief.stocks.length + brief.ideas.length + brief.trends.length > 0;
  const contents =
    attentionCount > 0 && !hasCoreContent
      ? [attentionContents, ...coreContents]
      : [...coreContents, attentionContents];

  return (
    <header className="border-b border-[var(--color-line)] pb-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
        <span className="text-[var(--color-accent)]">Daily Brief</span>
        <span>Edition {date}</span>
        <span>{regionLabel(region)}</span>
        <span className="sm:ml-auto">Published {generated} UTC</span>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-fg)] sm:text-5xl">
            What changed, why it matters, and what remains uncertain.
          </h1>
          <p className="mt-4 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            One evidence-first edition across markets, business opportunities, and behavior, plus a
            separately labeled attention layer. Items earn their place; attention never substitutes
            for evidence.
          </p>
        </div>
        <RegionPicker active={region} />
      </div>

      <nav
        aria-label="Brief contents"
        className="mt-7 -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {contents.map((item, index) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className="min-w-[210px] snap-start border-t border-[var(--color-line)] pt-3 hover:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)] sm:min-w-0 sm:flex-1"
          >
            <span className="block text-sm font-medium text-[var(--color-fg)]">
              {index + 1}. {item.label}
            </span>
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
              {stateLabel(item.status, item.count)}
            </span>
          </Link>
        ))}
      </nav>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-muted)] sm:hidden">
        swipe to see all four sections →
      </p>
    </header>
  );
}
