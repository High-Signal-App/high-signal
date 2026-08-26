import type { Metadata } from 'next';
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
import { SITE_URL } from '@/lib/site';
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
    description: `The High Signal Daily Brief for ${date}. Every claim cites two independent sources and a public hit-rate ledger.`,
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
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          ← signals
        </Link>
        <HistoryGate title={`Verify to read the ${date} brief`} />
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
    hasBrand: false,
    stocks: [],
    ideas: [],
    trends: [],
    perception: [],
    improvements: [],
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
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
            daily record — {date}
          </h2>
          <Link
            href="/signals"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
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
        <section className="mt-8 border border-dashed border-zinc-800 p-10 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no precomputed brief snapshot for {date}
            {region !== 'global' ? ` in ${region}` : ''}
          </p>
          <p className="mt-3 text-sm text-zinc-500">
            Brief snapshots are stored daily by the precompute cron. This date may predate the
            archive system, or no snapshot was computed for this region. Try the global region or
            browse{' '}
            <Link href="/signals" className="text-[var(--color-accent)] hover:underline">
              available signals
            </Link>
            .
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href={`/brief/${date}`}
              className="border border-zinc-800 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:border-zinc-700"
            >
              global region
            </Link>
            <Link
              href="/"
              className="border border-zinc-800 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:border-zinc-700"
            >
              today’s brief →
            </Link>
          </div>
        </section>
      )}
    </PageShell>
  );
}
