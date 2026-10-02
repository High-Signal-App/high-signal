import Link from 'next/link';
import type { Route } from 'next';
import { NewsFeed, SignalFeed } from '@/components/brief/BriefSections';
import { DailyBriefHero } from '@/components/brief/DailyBriefHero';
import { HomeJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import { api } from '@/lib/api';
import { resolveCurrentBrief } from '@/lib/current-brief';
import { istDay, isRegion, type Region } from '@high-signal/shared';

export async function CurrentBriefPage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; day?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const rawRegion = (params.region ?? 'global').toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';
  const selectedDay = params.day === 'yesterday' ? 'yesterday' : 'today';
  const now = new Date();
  const brief = await resolveCurrentBrief(api, region, selectedDay, now);
  const editionDate = brief.editionDate;
  const editionDay =
    editionDate === istDay(now)
      ? 'today'
      : editionDate === istDay(now, -1)
        ? 'yesterday'
        : 'earlier';

  return (
    <PageShell>
      <HomeJsonLd />
      <nav
        aria-label="Daily Brief date"
        className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--color-line)] pb-4 font-mono text-[10px] uppercase tracking-[0.16em]"
      >
        <Link
          href={(region === 'global' ? '/' : `/?region=${region}`) as Route}
          aria-current={selectedDay === 'today' ? 'page' : undefined}
          className={
            selectedDay === 'today'
              ? 'inline-flex min-h-11 items-center text-[var(--color-accent)]'
              : 'inline-flex min-h-11 items-center text-[var(--color-muted)] hover:text-[var(--color-fg)]'
          }
        >
          Today
        </Link>
        <Link
          href={
            `/?${new URLSearchParams({ ...(region === 'global' ? {} : { region }), day: 'yesterday' }).toString()}` as Route
          }
          aria-current={selectedDay === 'yesterday' ? 'page' : undefined}
          className={
            selectedDay === 'yesterday'
              ? 'inline-flex min-h-11 items-center text-[var(--color-accent)]'
              : 'inline-flex min-h-11 items-center text-[var(--color-muted)] hover:text-[var(--color-fg)]'
          }
        >
          Yesterday
        </Link>
      </nav>
      <DailyBriefHero
        brief={brief}
        region={region}
        editionDate={editionDate}
        editionDay={editionDay}
        signalOnly
      />
      <div className="brief-edition">
        <NewsFeed brief={brief} />
        <SignalFeed brief={brief} editionDay={editionDay} />
      </div>
    </PageShell>
  );
}
