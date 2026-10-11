import type { Metadata } from 'next';
import { EmptyState } from '@saas-maker/ui/components/empty-state';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BriefSections } from '@/components/brief/BriefSections';
import { DailyBriefHero } from '@/components/brief/DailyBriefHero';
import { EditionCoverageReceipt } from '@/components/brief/EditionCoverageReceipt';
import { HistoryGate } from '@/components/history/HistoryGate';
import { PageShell } from '@/components/system/HighSignalUI';
import { ShareBar } from '@/components/molecules/ShareBar';
import { api, type BriefSnapshot } from '@/lib/api';
import {
  briefFeedDefinition,
  coverageReceiptForSnapshot,
  isProtectedHistoryDay,
  isRegion,
  summarizeBriefDiscovery,
  type Region,
} from '@high-signal/shared';
import { SITE_URL, clampDescription } from '@/lib/site';
import { evaluateCollection, robotsForVerdict } from '../../../../public-corpus-policy.mjs';
import { verifiedHistoryGrant } from '@/lib/history-access';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface BriefDatePageProps {
  params: Promise<{ date: string }>;
  searchParams?: Promise<{ region?: string }>;
}

export async function generateMetadata({ params }: BriefDatePageProps): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_REGEX.test(date)) return { title: 'Brief not found' };
  if (isProtectedHistoryDay(date)) {
    return {
      title: `Earlier signals — ${date}`,
      description: `The High Signal edition for ${date}. Verify to read this archived Daily Brief and its cited evidence.`,
      robots: { index: false, follow: false },
    };
  }
  let brief: BriefSnapshot | null = null;
  try {
    brief = await api.brief({ region: 'global', date });
  } catch {
    /* Missing data fails closed to noindex. */
  }
  const discovery = summarizeBriefDiscovery(brief);
  const verdict = evaluateCollection(
    'brief',
    {
      childCount: discovery.publicItemCount,
      hasProvenance:
        discovery.publicItemCount > 0 && discovery.citedItemCount === discovery.publicItemCount,
    },
    3
  );
  return {
    title: `Daily Brief — ${date}`,
    description: clampDescription(
      `Daily Brief for ${date}: ${discovery.publicItemCount} stories and signals. ${brief?.news?.[0]?.title ?? brief?.stocks[0]?.headline ?? 'Cited evidence across technology, startups, and finance.'}`
    ),
    alternates: { canonical: `${SITE_URL}/brief/${date}` },
    robots: robotsForVerdict(verdict),
  };
}

export default async function BriefDatePage({ params, searchParams }: BriefDatePageProps) {
  const { date } = await params;
  if (!DATE_REGEX.test(date)) notFound();

  const historyGrant = isProtectedHistoryDay(date) ? await verifiedHistoryGrant() : null;
  if (isProtectedHistoryDay(date) && !historyGrant) {
    return (
      <PageShell>
        <Link
          href="/signals"
          className="font-mono text-[10px] tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          ← signals
        </Link>
        <HistoryGate title={`verify to read the ${date} brief`} />
      </PageShell>
    );
  }

  const sp = (await searchParams) ?? {};
  const rawRegion = (sp.region ?? 'global').toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';

  let brief: BriefSnapshot | null = null;
  try {
    brief = await api.brief({ region, date }, historyGrant);
  } catch {
    /* 404 or offline — render the "no brief" state */
  }

  const hasBrief =
    brief !== null && brief.stocks.length + brief.ideas.length + brief.trends.length > 0;
  const heroBrief: BriefSnapshot = brief ?? {
    generatedAt: `${date}T00:00:00.000Z`,
    region,
    stocks: [],
    ideas: [],
    trends: [],
    categoryStates: {
      stocks: { status: 'empty', source: 'live', reason: 'snapshot_missing' },
      ideas: { status: 'empty', source: 'live', reason: 'snapshot_missing' },
      trends: { status: 'empty', source: 'live', reason: 'snapshot_missing' },
    },
  };
  const coverage = coverageReceiptForSnapshot(briefFeedDefinition('brief'), heroBrief);

  return (
    <PageShell>
      <DailyBriefHero brief={heroBrief} region={region} editionDate={date} />

      <section className="border-b border-[var(--color-line)] py-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)]">
            daily record — {date}
          </h2>
          <Link
            href="/signals"
            className="font-mono text-[10px] tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
          >
            all signals →
          </Link>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          This is the brief as it was composed on {date}. The snapshot is the record, not a live
          rebuild. Region filtering applies when a precomputed snapshot exists for that date.
        </p>
        <ShareBar
          url={`${SITE_URL}/brief/${date}`}
          title={`High Signal Daily Brief — ${date}`}
          className="mt-4"
        />
      </section>

      <EditionCoverageReceipt coverage={coverage} />

      {hasBrief && brief ? (
        <div className="brief-edition">
          <BriefSections brief={brief} />
        </div>
      ) : (
        <EmptyState
          title={`no precomputed brief snapshot for ${date}${region !== 'global' ? ` in ${region}` : ''}`}
          description={
            <>
              Brief snapshots are stored daily by the precompute cron. This date may predate the
              archive system, or no snapshot was computed for this region. Try the global region or
              browse{' '}
              <Link href="/signals" className="underline">
                available signals
              </Link>
              .
            </>
          }
          primaryAction={
            <div className="flex flex-wrap justify-center gap-4">
              <Link href={`/brief/${date}`} className="underline underline-offset-4">
                global region
              </Link>
              <Link href="/" className="underline underline-offset-4">
                today’s brief →
              </Link>
            </div>
          }
        />
      )}
    </PageShell>
  );
}
