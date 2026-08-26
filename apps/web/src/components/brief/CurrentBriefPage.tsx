import Link from 'next/link';
import type { Route } from 'next';
import { BriefSections } from '@/components/brief/BriefSections';
import { DailyBriefHero } from '@/components/brief/DailyBriefHero';
import { EditionCoverageReceipt } from '@/components/brief/EditionCoverageReceipt';
import { ReadingLayoutToggle } from '@/components/brief/ReadingLayoutToggle';
import { ShareBar } from '@/components/molecules/ShareBar';
import { HomeJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import { api, type BriefSnapshot } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import {
  briefFeedDefinition,
  coverageReceiptForSnapshot,
  istDay,
  isRegion,
  type Region,
} from '@high-signal/shared';

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

function ConvergenceContext({
  convergence,
}: {
  convergence: Awaited<ReturnType<typeof api.convergence>> | null;
}) {
  const rows = (convergence?.rows ?? []).slice(0, 5);
  if (rows.length === 0) return null;

  return (
    <aside className="border-b border-[var(--color-line)] py-5" aria-label="Market convergence">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--color-fg)]">Convergence to watch</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">
            Entities appearing across at least three distinct sources in the last 24 hours.
          </p>
        </div>
        <Link
          href={'/convergence' as Route}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          open convergence →
        </Link>
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map((row) => (
          <li key={row.entityId} className="border-t border-[var(--color-line)] pt-3">
            <Link
              href={`/entities/${encodeURIComponent(row.entityId)}` as Route}
              className="text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              {row.ticker ?? row.name ?? row.entityId}
            </Link>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
              {row.sourceCount} sources · {row.eventCount} events
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

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
  let convergence: Awaited<ReturnType<typeof api.convergence>> | null = null;
  const [briefResult, convergenceResult] = await Promise.allSettled([
    api.brief({ region, date: selectedDay === 'yesterday' ? editionDate : undefined }),
    api.convergence(24, 3),
  ]);
  if (briefResult.status === 'fulfilled') brief = briefResult.value;
  if (convergenceResult.status === 'fulfilled') convergence = convergenceResult.value;

  const canonicalParams = new URLSearchParams();
  if (region !== 'global') canonicalParams.set('region', region);
  if (selectedDay === 'yesterday') canonicalParams.set('day', 'yesterday');
  const canonicalQuery = canonicalParams.toString();
  const canonicalUrl = `${SITE_URL}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const coverage = coverageReceiptForSnapshot(briefFeedDefinition('brief'), brief);

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
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
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
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
          }
        >
          Yesterday
        </Link>
        <Link
          href={'/signals' as Route}
          className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Earlier signals →
        </Link>
      </nav>
      <DailyBriefHero brief={brief} region={region} editionDate={editionDate} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] py-4">
        <ShareBar url={canonicalUrl} title="High Signal Daily Brief" />
        <div className="flex flex-wrap items-center gap-4">
          <ReadingLayoutToggle />
          <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
            <Link href={'/signals' as Route} className="hover:text-[var(--color-accent)]">
              signals
            </Link>
            <Link href={'/methodology' as Route} className="hover:text-[var(--color-accent)]">
              methodology
            </Link>
          </div>
        </div>
      </div>

      <EditionCoverageReceipt coverage={coverage} />
      <div className="brief-edition">
        <BriefSections
          brief={brief}
          marketContext={<ConvergenceContext convergence={convergence} />}
        />
      </div>
    </PageShell>
  );
}
