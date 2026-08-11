import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import {
  briefFeedDefinition,
  composeBriefFeedEdition,
  isBriefFeedSlug,
  isRegion,
  resolveBriefFeedPeriod,
  resolveFeedCadence,
  shiftBriefFeedPeriod,
  type BriefFeedEdition,
  type Region,
} from '@high-signal/shared';
import { BriefSections } from '@/components/brief/BriefSections';
import { EditionCoverageReceipt } from '@/components/brief/EditionCoverageReceipt';
import { FeedEditionHero } from '@/components/brief/FeedEditionHero';
import { PublicationSwitcher } from '@/components/brief/PublicationSwitcher';
import { PageShell } from '@/components/system/HighSignalUI';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface FeedPageProps {
  params: Promise<{ feed: string; cadence: string; period?: string[] }>;
  searchParams?: Promise<{ region?: string }>;
}

async function editionForRequest({ params, searchParams }: FeedPageProps) {
  const route = await params;
  if (!isBriefFeedSlug(route.feed) || (route.period?.length ?? 0) > 1) return null;
  const requestedPeriod = route.period?.[0];
  const feed = briefFeedDefinition(route.feed);
  const cadence = resolveFeedCadence(feed, route.cadence);
  const sp = (await searchParams) ?? {};
  const rawRegion = (sp.region ?? 'global').toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : 'global';
  const period = resolveBriefFeedPeriod(cadence.cadence, requestedPeriod);
  if (!period) return null;

  try {
    return await api.briefFeed({
      feed: feed.slug,
      cadence: route.cadence,
      period: requestedPeriod,
      region,
    });
  } catch {
    return composeBriefFeedEdition({
      feed,
      requestedCadence: route.cadence,
      cadence: cadence.cadence,
      cadenceFellBack: cadence.fellBack,
      period,
      region,
      rows: [],
    });
  }
}

function canonicalPath(edition: BriefFeedEdition) {
  const path = `/feeds/${edition.feed}/${edition.cadence}/${edition.period.key}`;
  return `${SITE_URL}${path}${edition.region === 'global' ? '' : `?region=${edition.region}`}`;
}

function periodHref(edition: BriefFeedEdition, period?: string) {
  const path = `/feeds/${edition.feed}/${edition.cadence}${period ? `/${period}` : ''}`;
  return `${path}${edition.region === 'global' ? '' : `?region=${edition.region}`}` as Route;
}

export async function generateMetadata(props: FeedPageProps): Promise<Metadata> {
  const edition = await editionForRequest(props);
  if (!edition) return { title: 'Feed edition not found', robots: { index: false, follow: false } };
  const feed = briefFeedDefinition(edition.feed);
  return {
    title: `${feed.label} — ${edition.cadence} ${edition.period.key}`,
    description: `${feed.description} Evidence-qualified ${edition.cadence} edition for ${edition.period.startsOn} through ${edition.period.endsOn} UTC.`,
    alternates: { canonical: canonicalPath(edition) },
    robots:
      edition.contributingEditionDates.length > 0 ? undefined : { index: false, follow: true },
  };
}

export default async function FeedEditionPage(props: FeedPageProps) {
  const edition = await editionForRequest(props);
  if (!edition) notFound();
  const definition = briefFeedDefinition(edition.feed);
  const previousPeriod = shiftBriefFeedPeriod(edition.period, -1);
  const nextPeriod = shiftBriefFeedPeriod(edition.period, 1);

  return (
    <PageShell>
      <PublicationSwitcher feed={edition.feed} cadence={edition.cadence} region={edition.region} />
      {edition.cadenceFellBack ? (
        <aside className="mb-6 border border-amber-400/40 bg-amber-400/[0.04] px-4 py-3 text-xs leading-5 text-amber-100">
          {definition.label} is published {edition.cadence}.{' '}
          {definition.slowerCadenceReason ?? 'The requested cadence is not available.'}
        </aside>
      ) : null}
      <FeedEditionHero definition={definition} edition={edition} />

      <section className="border-b border-[var(--color-line)] py-5" aria-label="Edition record">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
            UTC bounds · {edition.period.startsOn} → {edition.period.endsOn}
          </p>
          <nav
            aria-label="Edition navigation"
            className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]"
          >
            <Link
              href={periodHref(edition, previousPeriod.key)}
              className="hover:text-[var(--color-accent)]"
            >
              ← previous
            </Link>
            <Link href={periodHref(edition)} className="hover:text-[var(--color-accent)]">
              latest
            </Link>
            {edition.period.complete ? (
              <Link
                href={periodHref(edition, nextPeriod.key)}
                className="hover:text-[var(--color-accent)]"
              >
                next →
              </Link>
            ) : null}
          </nav>
        </div>
        {edition.contributingEditionDates.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
            <span>Daily records</span>
            {edition.contributingEditionDates.map((date) => (
              <Link
                key={date}
                href={
                  `/brief/${date}${edition.region === 'global' ? '' : `?region=${edition.region}`}` as Route
                }
                className="hover:text-[var(--color-accent)]"
              >
                {date}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-[var(--color-muted)]" role="status">
            No accepted daily record exists for this region and period. This edition is unavailable;
            no live reconstruction or substitute content was inserted.
          </p>
        )}
      </section>

      <EditionCoverageReceipt coverage={edition.coverage} />
      <div className="brief-edition">
        <BriefSections
          brief={edition.snapshot}
          sections={definition.sections}
          itemEditionDates={edition.itemEditionDates}
        />
      </div>
    </PageShell>
  );
}
