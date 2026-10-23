import { istDay, PUBLIC_BRIEF_REGIONS, regionLabel, type BriefSnapshot } from '@high-signal/shared';
import { NewsFeed, SignalFeed } from '@/components/brief/BriefSections';
import { DailyBriefHeroContent } from '@/components/brief/DailyBriefHeroContent';
import { HomeJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';

export function BriefContent({
  brief,
  day,
  capturedAt,
}: {
  brief: BriefSnapshot;
  day: 'today' | 'yesterday';
  capturedAt: string;
}) {
  const { region, editionDate = istDay(new Date(capturedAt)) } = brief;
  const editionDay =
    editionDate === istDay(new Date(capturedAt))
      ? 'today'
      : editionDate === istDay(new Date(capturedAt), -1)
        ? 'yesterday'
        : 'earlier';
  const href = (selected: 'today' | 'yesterday') => {
    const query = new URLSearchParams({
      ...(region === 'global' ? {} : { region }),
      ...(selected === 'yesterday' ? { day: selected } : {}),
    });
    return query.size ? `/?${query}` : '/';
  };
  return (
    <PageShell>
      <span
        hidden
        data-high-signal-reader="brief-v1"
        data-edition-date={editionDate}
        data-region={region}
      />
      <HomeJsonLd />
      <nav
        aria-label="Daily Brief date"
        className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--color-line)] pb-4 font-mono text-[10px] tracking-[0.16em]"
      >
        {(['today', 'yesterday'] as const).map((selected) => (
          <a
            key={selected}
            href={href(selected)}
            aria-current={day === selected ? 'page' : undefined}
            className={
              day === selected
                ? 'inline-flex min-h-11 items-center text-[var(--color-accent)]'
                : 'inline-flex min-h-11 items-center text-[var(--color-muted)] hover:text-[var(--color-fg)]'
            }
          >
            {selected}
          </a>
        ))}
      </nav>
      <DailyBriefHeroContent
        brief={brief}
        region={region}
        editionDate={editionDate}
        editionDay={editionDay}
        signalOnly
        regionPicker={
          <form
            action="/"
            data-reader-region
            className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.18em]"
          >
            {day === 'yesterday' && <input type="hidden" name="day" value="yesterday" />}
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--color-muted)]">region:</span>
              <select
                name="region"
                defaultValue={region}
                className="min-h-11 border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
              >
                {(PUBLIC_BRIEF_REGIONS.includes(region)
                  ? PUBLIC_BRIEF_REGIONS
                  : [region, ...PUBLIC_BRIEF_REGIONS]
                ).map((item) => (
                  <option key={item} value={item}>
                    {regionLabel(item).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <noscript>
              <button type="submit">apply region</button>
            </noscript>
          </form>
        }
      />
      <div className="brief-edition">
        <NewsFeed brief={brief} pagination={{ day }} />
        <SignalFeed brief={brief} editionDay={editionDay} />
      </div>
    </PageShell>
  );
}
