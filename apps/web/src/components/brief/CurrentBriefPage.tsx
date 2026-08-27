import Link from 'next/link';
import type { Route } from 'next';
import { SignalFeed } from '@/components/brief/BriefSections';
import { DailyBriefHero } from '@/components/brief/DailyBriefHero';
import { HomeJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import { api, type BriefSnapshot } from '@/lib/api';
import { istDay, isRegion, type Region } from '@high-signal/shared';

const EMPTY_BRIEF: BriefSnapshot = {
  generatedAt: new Date().toISOString(),
  region: 'global',
  hasBrand: false,
  stocks: [],
  ideas: [],
  trends: [],
  perception: [],
  improvements: [],
  categoryStates: {
    stocks: { status: 'unavailable', source: 'live', reason: 'brief_api_unavailable' },
    ideas: { status: 'unavailable', source: 'live', reason: 'brief_api_unavailable' },
    trends: { status: 'unavailable', source: 'live', reason: 'brief_api_unavailable' },
  },
};

export async function CurrentBriefPage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; day?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const rawRegion = (params.region ?? 'global').toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';
  const selectedDay = params.day === 'yesterday' ? 'yesterday' : 'today';
  const editionDate = istDay(new Date(), selectedDay === 'yesterday' ? -1 : 0);

  let brief: BriefSnapshot = { ...EMPTY_BRIEF, region };
  try {
    brief = await api.brief({
      region,
      date: selectedDay === 'yesterday' ? editionDate : undefined,
    });
  } catch {
    // The explicit unavailable state below is preferable to substituting input feeds.
  }

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
        editionDay={selectedDay}
        signalOnly
      />
      <div className="brief-edition">
        <SignalFeed brief={brief} editionDay={selectedDay} />
      </div>
    </PageShell>
  );
}
