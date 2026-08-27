import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import {
  categoryStatesForSnapshot,
  type BriefCategoryState,
  type BriefIdeaItem,
  type BriefPublicSectionKey,
  type BriefSnapshot,
  type BriefStockItem,
  type BriefTrendItem,
} from '@high-signal/shared';

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function stateCopy(state: BriefCategoryState, empty: string) {
  if (state.status === 'unavailable') {
    return 'This category could not be composed from the live source store. No substitute content was inserted.';
  }
  return empty;
}

function SectionShell({
  id,
  title,
  description,
  state,
  count,
  empty,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  state: BriefCategoryState;
  count: number;
  empty: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`brief-feed-section scroll-mt-20 border-b border-[var(--color-line)] ${state.status === 'ready' ? 'py-10 first:pt-8' : 'py-7'}`}
    >
      <header className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
            {state.status === 'ready'
              ? `${count} ${count === 1 ? 'item' : 'items'}`
              : state.status === 'empty'
                ? 'No qualifying items'
                : 'Source unavailable'}
          </div>
          <h2
            className={`${state.status === 'ready' ? 'mt-2 text-3xl' : 'mt-1 text-2xl'} font-medium tracking-[-0.025em] text-[var(--color-fg)]`}
          >
            {title}
          </h2>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            {description}
          </p>
        </div>
        {action}
      </header>

      {state.status === 'ready' && count > 0 ? (
        <div className="brief-feed-items mt-6 border-t border-[var(--color-line)]">{children}</div>
      ) : (
        <div className="mt-4 border-t border-dashed border-[var(--color-line)] pt-4" role="status">
          <p className="max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            {stateCopy(state, empty)}
          </p>
          {state.status === 'unavailable' ? (
            <Link
              href={'/data' as Route}
              className="mt-3 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              inspect source health →
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

function directionTone(direction: BriefStockItem['direction']) {
  if (direction === 'up') return 'text-[var(--color-up)]';
  if (direction === 'down') return 'text-[var(--color-down)]';
  return 'text-[var(--color-muted)]';
}

function DirectHistory({ item }: { item: BriefStockItem }) {
  const direct = item.hitRateBand === 'direct' && item.hitRate != null;
  const early = item.hitRateBand === 'early' && item.hitRateSample > 0;
  const directRate = item.hitRate ?? 0;

  return (
    <div className="border-t border-[var(--color-line)] pt-3 md:border-t-0 md:border-l md:pl-5 md:pt-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
        Direct history
      </div>
      {direct ? (
        <>
          <div className="mt-2 text-2xl font-medium text-[var(--color-accent)]">
            {(directRate * 100).toFixed(0)}%
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">
            {item.hitRateSample} scored calls of this signal type.
          </p>
        </>
      ) : early ? (
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          Early direct sample: {item.hitRateSample} scored{' '}
          {item.hitRateSample === 1 ? 'call' : 'calls'}.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          Not enough scored calls of this exact type yet.
        </p>
      )}
      <Link
        href={'/track-record' as Route}
        className="mt-3 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
      >
        full ledger →
      </Link>
    </div>
  );
}

function StockItem({ item }: { item: BriefStockItem }) {
  return (
    <article className="brief-feed-item grid gap-6 border-b border-[var(--color-line)] py-7 last:border-b-0 md:grid-cols-[minmax(0,1fr)_190px]">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
          <span className="text-[var(--color-fg)]">{item.entityName}</span>
          {item.ticker ? <span>{item.ticker}</span> : null}
          {item.country ? <span>{item.country}</span> : null}
          <span>{item.signalType.replaceAll('_', ' ')}</span>
          <span className={directionTone(item.direction)}>{item.direction}</span>
          <span>{item.confidence} confidence</span>
          <span>{item.predictedWindowDays}d window</span>
        </div>

        <Link
          href={`/signals/${encodeURIComponent(item.signalSlug)}` as Route}
          className="brief-feed-item-title mt-3 block max-w-4xl text-2xl font-medium leading-8 tracking-[-0.02em] text-[var(--color-fg)] hover:text-[var(--color-accent)]"
        >
          {item.headline}
        </Link>

        {item.whatChanged && item.whyItMatters && item.uncertainty ? (
          <dl className="mt-5 grid gap-4 text-sm leading-6 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-[var(--color-fg)]">What changed</dt>
              <dd className="mt-1 text-[var(--color-muted)]">{item.whatChanged}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-fg)]">Why it matters</dt>
              <dd className="mt-1 text-[var(--color-muted)]">{item.whyItMatters}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-fg)]">Uncertainty</dt>
              <dd className="mt-1 text-[var(--color-muted)]">{item.uncertainty}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            This archived item predates the inline editorial ledger. Open the full signal for its
            original evidence and reasoning.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
          {item.evidenceUrls.slice(0, 2).map((citation, index) => (
            <a
              key={citation.url}
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--color-accent)]"
            >
              {index === 0 ? 'primary' : 'corroboration'} ·{' '}
              {citation.source ?? sourceHost(citation.url)} ↗
            </a>
          ))}
          {item.provenance ? (
            <Link
              href={`/signals/${encodeURIComponent(item.signalSlug)}#provenance` as Route}
              className="hover:text-[var(--color-accent)]"
            >
              claim v{item.provenance.version} · {item.provenance.evidenceCount} supporting
            </Link>
          ) : null}
        </div>
      </div>
      <DirectHistory item={item} />
    </article>
  );
}

function verdictTone(verdict: NonNullable<BriefIdeaItem['opportunity']>['verdict']) {
  if (verdict === 'enter') return 'text-[var(--color-up)]';
  if (verdict === 'test') return 'text-[var(--color-accent)]';
  if (verdict === 'watch') return 'text-[var(--color-accent)]';
  return 'text-[var(--color-down)]';
}

function IdeaItem({ item }: { item: BriefIdeaItem }) {
  return (
    <article className="brief-feed-item border-b border-[var(--color-line)] py-7 last:border-b-0">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_190px]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
            {item.source}
            {item.subreddit ? ` · r/${item.subreddit}` : ''} · {item.surfacedAt.slice(0, 10)}
          </div>
          <h3 className="brief-feed-item-title mt-3 max-w-4xl text-2xl font-medium leading-8 tracking-[-0.02em]">
            {item.title}
          </h3>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            {item.description}
          </p>
          {item.whyNow ? (
            <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-fg)]">Why now:</span> {item.whyNow}
            </p>
          ) : null}
        </div>
        {item.opportunity ? (
          <div className="border-t border-[var(--color-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            <div>Evidence verdict</div>
            <div className={`mt-2 text-2xl font-medium ${verdictTone(item.opportunity.verdict)}`}>
              {item.opportunity.verdict}
            </div>
            <div className="mt-1">{item.opportunity.confidence} confidence</div>
            <p className="mt-4 normal-case leading-5 tracking-normal text-[var(--color-muted)]">
              Next: {item.opportunity.nextValidationStep}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
        {item.evidenceUrls.slice(0, 2).map((citation) => (
          <a
            key={citation.url}
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-accent)]"
          >
            evidence · {citation.source ?? sourceHost(citation.url)} ↗
          </a>
        ))}
      </div>
    </article>
  );
}

function TrendItem({ item }: { item: BriefTrendItem }) {
  return (
    <article className="brief-feed-item border-b border-[var(--color-line)] py-7 last:border-b-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
        r/{item.subreddit} · {item.surfacedAt.slice(0, 10)}
      </div>
      <h3 className="brief-feed-item-title mt-3 max-w-4xl text-2xl font-medium leading-8 tracking-[-0.02em]">
        {item.title}
      </h3>
      <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
        {item.description}
      </p>
      {item.whyNow ? (
        <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-fg)]">Why now:</span> {item.whyNow}
        </p>
      ) : null}
      {item.evidenceUrls[0] ? (
        <a
          href={item.evidenceUrls[0].url}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex min-h-11 items-center border-t border-[var(--color-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          source · {item.evidenceUrls[0].source ?? sourceHost(item.evidenceUrls[0].url)} ↗
        </a>
      ) : null}
    </article>
  );
}

export function SignalFeed({
  brief,
  editionDay,
}: {
  brief: BriefSnapshot;
  editionDay: 'today' | 'yesterday';
}) {
  const state = categoryStatesForSnapshot(brief).stocks;
  const count = brief.stocks.length;
  const alternateDay = editionDay === 'today' ? 'yesterday' : 'today';
  const alternateParams = new URLSearchParams({
    ...(brief.region === 'global' ? {} : { region: brief.region }),
    ...(editionDay === 'today' ? { day: 'yesterday' } : {}),
  });
  const alternateHref = alternateParams.size > 0 ? `/?${alternateParams.toString()}` : '/';

  return (
    <section id="signals" className="scroll-mt-20 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
          {state.status === 'ready'
            ? `${count} verified ${count === 1 ? 'signal' : 'signals'}`
            : state.status === 'unavailable'
              ? 'Signal source unavailable'
              : `No verified signals ${editionDay}`}
        </div>
        {state.status === 'ready' && count > 0 ? (
          <Link
            href={'/signals' as Route}
            className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            all signals →
          </Link>
        ) : null}
      </div>

      {state.status === 'ready' && count > 0 ? (
        <div className="brief-feed-items">
          {brief.stocks.map((item) => (
            <StockItem key={`${item.signalSlug}-${item.entityId}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="border-b border-dashed border-[var(--color-line)] py-8" role="status">
          <p className="max-w-[65ch] text-sm leading-6 text-[var(--color-muted)]">
            {state.status === 'unavailable'
              ? 'The signal store could not be read. No substitute content was inserted.'
              : 'Nothing cleared the evidence and publication gates for this edition.'}{' '}
            <Link
              href={alternateHref as Route}
              className="text-[var(--color-fg)] underline decoration-[var(--color-line)] underline-offset-4 hover:text-[var(--color-accent)]"
            >
              Check {alternateDay}
            </Link>{' '}
            or{' '}
            <Link
              href={'/signals' as Route}
              className="text-[var(--color-fg)] underline decoration-[var(--color-line)] underline-offset-4 hover:text-[var(--color-accent)]"
            >
              browse earlier verified signals
            </Link>
            .
          </p>
        </div>
      )}
    </section>
  );
}

export function BriefSections({
  brief,
  marketContext,
  sections = ['stocks', 'ideas', 'trends'],
}: {
  brief: BriefSnapshot;
  marketContext?: ReactNode;
  sections?: BriefPublicSectionKey[];
}) {
  const states = categoryStatesForSnapshot(brief);

  return (
    <>
      {sections.includes('stocks') ? (
        <SectionShell
          id="markets-companies"
          title="Markets & companies"
          description="Material company and market changes with a grounded implication, principal uncertainty, and only direct track-record history. This is decision support, not investment advice."
          state={states.stocks}
          count={brief.stocks.length}
          empty="No market signal cleared the editorial and evidence gates for this edition."
          action={
            <Link
              href={'/signals' as Route}
              className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              all signals →
            </Link>
          }
        >
          {marketContext}
          {brief.stocks.map((item) => (
            <StockItem key={`${item.signalSlug}-${item.entityId}`} item={item} />
          ))}
        </SectionShell>
      ) : null}

      {sections.includes('ideas') ? (
        <SectionShell
          id="business-opportunities"
          title="Business opportunities"
          description="Observed demand and product openings grounded in retained community or market evidence. Volume grows only when more ideas clear the same bar."
          state={states.ideas}
          count={brief.ideas.length}
          empty="No business opportunity cleared the editorial and evidence gates for this edition."
        >
          {brief.ideas.map((item) => (
            <IdeaItem
              key={`${item.surfacedAt}-${item.subreddit ?? 'opportunity'}-${item.title}`}
              item={item}
            />
          ))}
        </SectionShell>
      ) : null}

      {sections.includes('trends') ? (
        <SectionShell
          id="behavior-culture"
          title="Behavior & culture"
          description="Early changes in how people work, buy, and organize—kept separate from product ideas so a visitor can scan the edition by intent."
          state={states.trends}
          count={brief.trends.length}
          empty="No behavior or culture shift cleared the editorial and evidence gates for this edition."
        >
          {brief.trends.map((item) => (
            <TrendItem key={`${item.surfacedAt}-${item.subreddit}-${item.title}`} item={item} />
          ))}
        </SectionShell>
      ) : null}
    </>
  );
}
