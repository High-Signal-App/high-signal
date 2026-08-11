import { RegionPicker } from '@/components/brief/RegionPicker';
import { regionLabel, type BriefFeedDefinition, type BriefFeedEdition } from '@high-signal/shared';

function cadenceLabel(edition: BriefFeedEdition) {
  if (edition.cadence === 'daily') return edition.period.key;
  return `${edition.period.startsOn}—${edition.period.endsOn}`;
}

export function FeedEditionHero({
  definition,
  edition,
}: {
  definition: BriefFeedDefinition;
  edition: BriefFeedEdition;
}) {
  const itemCount =
    edition.snapshot.stocks.length + edition.snapshot.ideas.length + edition.snapshot.trends.length;

  return (
    <header className="feed-edition-hero border-b border-[var(--color-line)] pb-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
        <span className="text-[var(--color-accent)]">{edition.cadence} edition</span>
        <span>{cadenceLabel(edition)}</span>
        <span>{regionLabel(edition.region)}</span>
        <span className="sm:ml-auto">
          {edition.period.complete ? 'closed edition' : 'in-progress edition'}
        </span>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="max-w-4xl text-4xl font-medium leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            {definition.label}
          </h1>
          <p className="mt-4 max-w-[72ch] text-sm leading-6 text-[var(--color-muted)]">
            {definition.description} This edition contains {itemCount}{' '}
            {itemCount === 1 ? 'accepted item' : 'accepted items'} from{' '}
            {edition.contributingEditionDates.length}{' '}
            {edition.contributingEditionDates.length === 1 ? 'daily snapshot' : 'daily snapshots'}.
          </p>
          {definition.slowerCadenceReason ? (
            <p className="mt-3 max-w-[72ch] text-xs leading-5 text-[var(--color-muted)]">
              {definition.slowerCadenceReason}
            </p>
          ) : null}
        </div>
        <RegionPicker active={edition.region} />
      </div>
    </header>
  );
}
