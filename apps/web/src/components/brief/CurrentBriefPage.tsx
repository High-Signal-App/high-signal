import Link from 'next/link';
import type { Route } from 'next';
import { BriefSections } from '@/components/brief/BriefSections';
import { DailyBriefHero } from '@/components/brief/DailyBriefHero';
import { ShareBar } from '@/components/molecules/ShareBar';
import { HomeJsonLd } from '@/components/seo/structured-data';
import { PageShell } from '@/components/system/HighSignalUI';
import { api, type BriefSnapshot } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import { isRegion, type Region } from '@high-signal/shared';

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
  searchParams?: Promise<{ region?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const rawRegion = (params.region ?? 'global').toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';

  let brief: BriefSnapshot = { ...EMPTY_BRIEF, region };
  let convergence: Awaited<ReturnType<typeof api.convergence>> | null = null;
  const [briefResult, convergenceResult] = await Promise.allSettled([
    api.brief({ region }),
    api.convergence(24, 3),
  ]);
  if (briefResult.status === 'fulfilled') brief = briefResult.value;
  if (convergenceResult.status === 'fulfilled') convergence = convergenceResult.value;

  const canonicalUrl = `${SITE_URL}${region === 'global' ? '' : `?region=${region}`}`;

  return (
    <PageShell>
      <HomeJsonLd />
      <DailyBriefHero brief={brief} region={region} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] py-4">
        <ShareBar url={canonicalUrl} title="High Signal Daily Brief" />
        <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
          <Link href={'/brief/archive' as Route} className="hover:text-[var(--color-accent)]">
            archive
          </Link>
          <Link href={'/methodology' as Route} className="hover:text-[var(--color-accent)]">
            methodology
          </Link>
        </div>
      </div>

      <BriefSections
        brief={brief}
        marketContext={<ConvergenceContext convergence={convergence} />}
      />
    </PageShell>
  );
}
