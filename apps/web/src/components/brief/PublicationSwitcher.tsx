import Link from 'next/link';
import type { Route } from 'next';
import {
  BRIEF_FEEDS,
  briefFeedDefinition,
  type BriefFeedCadence,
  type BriefFeedSlug,
  type Region,
} from '@high-signal/shared';
import { ReadingLayoutToggle } from './ReadingLayoutToggle';

function feedHref(feed: BriefFeedSlug, cadence: BriefFeedCadence, region: Region) {
  const path = feed === 'brief' && cadence === 'daily' ? '/' : `/feeds/${feed}/${cadence}`;
  return `${path}${region === 'global' ? '' : `?region=${region}`}` as Route;
}

export function PublicationSwitcher({
  feed,
  cadence,
  region,
}: {
  feed: BriefFeedSlug;
  cadence: BriefFeedCadence;
  region: Region;
}) {
  const activeFeed = briefFeedDefinition(feed);

  return (
    <nav
      aria-label="Publication controls"
      className="publication-switcher mb-7 grid gap-4 border-y border-[var(--color-line)] py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end"
    >
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
          Feed
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {BRIEF_FEEDS.map((option) => {
            const targetCadence = option.supportedCadences.includes(cadence)
              ? cadence
              : option.defaultCadence;
            return (
              <Link
                key={option.slug}
                href={feedHref(option.slug, targetCadence, region)}
                aria-current={option.slug === feed ? 'page' : undefined}
                className={`flex min-h-11 shrink-0 items-center border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                  option.slug === feed
                    ? 'border-[var(--color-accent)] text-[var(--color-fg)]'
                    : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-fg)]'
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-muted)] sm:hidden">
          swipe to see all four feeds →
        </p>
      </div>

      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
          Edition
        </div>
        <div className="mt-2 flex border border-[var(--color-line)]">
          {activeFeed.supportedCadences.map((option) => (
            <Link
              key={option}
              href={feedHref(feed, option, region)}
              aria-current={option === cadence ? 'page' : undefined}
              className={`flex min-h-11 items-center px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                option === cadence
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
          View
        </div>
        <div className="mt-2">
          <ReadingLayoutToggle />
        </div>
      </div>
    </nav>
  );
}
