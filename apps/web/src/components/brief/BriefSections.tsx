import { EmptyState } from '@saas-maker/ui/components/empty-state';
import { ErrorState } from '@saas-maker/ui/components/error-state';
import type { ReactNode } from 'react';
import {
  categoryStatesForSnapshot,
  briefNewsPageHref,
  paginateBriefNews,
  selectBriefEdition,
  type BriefCategoryState,
  type BriefCitation,
  type BriefIdeaItem,
  type BriefNewsItem,
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
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--color-accent)]">
            {state.status === 'ready'
              ? `${count} ${count === 1 ? 'item' : 'items'}`
              : state.status === 'empty'
                ? 'no qualifying items'
                : 'source unavailable'}
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
        <div className="mt-4 border-t border-line">
          {state.status === 'unavailable' ? (
            <ErrorState
              description={stateCopy(state, empty)}
              primaryAction={
                <a href="" className="underline">
                  try again →
                </a>
              }
            />
          ) : (
            <EmptyState
              title="no qualifying items"
              description={stateCopy(state, empty)}
              primaryAction={
                <a href="/signals" className="underline">
                  all signals →
                </a>
              }
            />
          )}
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
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
        direct history
      </div>
      {direct ? (
        <>
          <div className="mt-2 font-mono text-2xl font-medium tabular-nums text-[var(--color-fg)]">
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
      <a
        href={'/track-record'}
        className="mt-3 inline-flex min-h-11 items-center font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
      >
        full ledger →
      </a>
    </div>
  );
}

function StockItem({ item }: { item: BriefStockItem }) {
  return (
    <article className="brief-feed-item grid gap-6 border-b border-[var(--color-line)] py-7 last:border-b-0 md:grid-cols-[minmax(0,1fr)_190px]">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
          <span className="text-[var(--color-fg)]">{item.entityName}</span>
          {item.ticker ? <span>{item.ticker}</span> : null}
          {item.country ? <span>{item.country}</span> : null}
          <span>{item.signalType.replaceAll('_', ' ')}</span>
          <span className={directionTone(item.direction)}>{item.direction}</span>
          <span>{item.confidence} confidence</span>
          <span>{item.predictedWindowDays}d window</span>
        </div>

        <a
          href={`/signals/${encodeURIComponent(item.signalSlug)}`}
          className="brief-feed-item-title mt-3 block max-w-4xl text-2xl font-medium leading-8 tracking-[-0.02em] text-[var(--color-fg)] hover:text-[var(--color-accent)]"
        >
          {item.headline}
        </a>

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

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
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
            <a
              href={`/signals/${encodeURIComponent(item.signalSlug)}#provenance`}
              className="hover:text-[var(--color-accent)]"
            >
              claim v{item.provenance.version} · {item.provenance.evidenceCount} supporting
            </a>
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
          <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
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
          <div className="border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)] lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            <div>evidence verdict</div>
            <div className={`mt-2 text-2xl font-medium ${verdictTone(item.opportunity.verdict)}`}>
              {item.opportunity.verdict}
            </div>
            <div className="mt-1">{item.opportunity.confidence} confidence</div>
            <p className="mt-4 normal-case leading-5 tracking-normal text-[var(--color-muted)]">
              next: {item.opportunity.nextValidationStep}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
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
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
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
          className="mt-5 inline-flex min-h-11 items-center border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          source · {item.evidenceUrls[0].source ?? sourceHost(item.evidenceUrls[0].url)} ↗
        </a>
      ) : null}
    </article>
  );
}

function NewsWhatChanged({ value }: { value: string }) {
  return (
    <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
      <span className="font-medium text-[var(--color-fg)]">What changed:</span> {value}
    </p>
  );
}

function NewsSourceReferences({ citations }: { citations: BriefCitation[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
      {citations.map((citation) => (
        <span key={citation.url} className="inline-flex items-center gap-2">
          <a
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-accent)]"
          >
            {sourceHost(citation.url)} ↗
          </a>
          {citation.recordId ? (
            <a
              href={`/data/records/${encodeURIComponent(citation.recordId)}`}
              className="text-[var(--color-fg)] underline decoration-[var(--color-line)] underline-offset-4 hover:text-[var(--color-accent)]"
            >
              record
            </a>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function NewsItem({ item, related = [] }: { item: BriefNewsItem; related?: BriefNewsItem[] }) {
  return (
    <article className="brief-feed-item border-b border-[var(--color-line)] py-7 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
        <span className="text-[var(--color-fg)]">{item.evidence_status}</span>
        <span>{item.event_at.slice(0, 10)}</span>
      </div>
      <h3 className="brief-feed-item-title mt-3 max-w-4xl text-2xl font-medium leading-8 tracking-[-0.02em]">
        {item.title}
      </h3>
      <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
        {item.summary}
      </p>
      {item.what_changed ? <NewsWhatChanged value={item.what_changed} /> : null}
      <NewsSourceReferences citations={item.source_references} />
      {related.length > 0 ? (
        <details className="mt-4 max-w-[70ch] border-l border-[var(--color-line)] pl-4">
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            {related.length} more {related.length === 1 ? 'report' : 'reports'} on this story
          </summary>
          <p className="text-xs leading-5 text-[var(--color-muted)]">
            Related accounts, each attributed to its own source.
          </p>
          {related.map((report) => (
            <div key={report.id} className="py-4">
              <h4 className="text-sm font-medium">{report.title}</h4>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{report.summary}</p>
              <NewsSourceReferences citations={report.source_references} />
            </div>
          ))}
        </details>
      ) : null}
    </article>
  );
}

function NewsPages({
  selection,
  day,
  region,
}: {
  selection: ReturnType<typeof paginateBriefNews>;
  day: 'today' | 'yesterday';
  region: BriefSnapshot['region'];
}) {
  if (selection.pageCount <= 1) return null;
  const linkClass =
    'inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]';
  return (
    <nav
      aria-label="News pages"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--color-line)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]"
    >
      <span>
        stories {selection.from}–{selection.to} of {selection.total}
      </span>
      <div className="flex items-center gap-6">
        {selection.page > 1 ? (
          <a
            href={briefNewsPageHref({ page: selection.page - 1, region, day, all: true })}
            rel="prev"
            className={linkClass}
          >
            ← previous stories
          </a>
        ) : null}
        {selection.page < selection.pageCount ? (
          <a
            href={briefNewsPageHref({ page: selection.page + 1, region, day, all: true })}
            rel="next"
            className={linkClass}
          >
            more stories →
          </a>
        ) : null}
      </div>
    </nav>
  );
}

export function NewsFeed({
  brief,
  pagination,
}: {
  brief: BriefSnapshot;
  pagination?: { page?: string | string[]; day: 'today' | 'yesterday' };
}) {
  const news = brief.news ?? [];
  if (news.length === 0) return null;
  const fullStream = pagination?.page !== undefined;
  const edition = pagination && !fullStream ? selectBriefEdition(brief) : null;
  const selected = fullStream ? paginateBriefNews({ news, requestedPage: pagination.page }) : null;
  const day = pagination?.day ?? 'today';
  const fullHref = briefNewsPageHref({ page: 1, day, region: brief.region, all: true });
  return (
    <section id="news" className="scroll-mt-20 border-b border-[var(--color-line)] py-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="font-mono text-[10px] font-normal tracking-[0.14em] text-[var(--color-muted)]">
          {edition
            ? `${edition.items.length} selected ${edition.items.length === 1 ? 'story' : 'stories'}${edition.items.length ? ` · ${edition.readingMinutes} min read` : ''}`
            : `${news.length} ${news.length === 1 ? 'story' : 'stories'}${selected ? ` · page ${selected.page} of ${selected.pageCount}` : ''}`}
        </h2>
        {pagination ? (
          <a
            href={fullStream ? briefNewsPageHref({ page: 1, day, region: brief.region }) : fullHref}
            className="inline-flex min-h-11 items-center font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            {fullStream ? '← back to the brief' : `all ${news.length} stories →`}
          </a>
        ) : null}
      </div>
      <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
        {edition
          ? 'A short selection of recent developments across technology, startups, and finance. Related reporting is grouped; single-source claims remain attributed.'
          : 'The complete collection from retained records. Single-source reporting is attributed; this is not a market signal.'}
      </p>
      <div className="brief-feed-items mt-6 border-t border-[var(--color-line)]">
        {edition
          ? edition.items.map(({ story, related }) => (
              <NewsItem key={story.id} item={story} related={related} />
            ))
          : (selected?.items ?? news).map((item) => <NewsItem key={item.id} item={item} />)}
      </div>
      {edition && edition.items.length === 0 ? (
        <p className="py-6 text-sm leading-6 text-[var(--color-muted)]">
          No recent reporting met the front edition’s selection rules. The full collection remains
          available above.
        </p>
      ) : null}
      {pagination && selected ? (
        <NewsPages selection={selected} day={pagination.day} region={brief.region} />
      ) : null}
    </section>
  );
}

export function SignalFeed({
  brief,
  editionDay,
  concise = false,
}: {
  brief: BriefSnapshot;
  editionDay: 'today' | 'yesterday' | 'earlier';
  concise?: boolean;
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
        <h2 className="font-mono text-[10px] font-normal tracking-[0.14em] text-[var(--color-muted)]">
          {state.status === 'ready'
            ? `${concise && count > 3 ? `3 of ${count}` : count} verified ${count === 1 ? 'signal' : 'signals'}`
            : state.status === 'unavailable'
              ? 'signal source unavailable'
              : editionDay === 'earlier'
                ? 'no verified signals in this edition'
                : `no verified signals ${editionDay}`}
        </h2>
        {state.status === 'ready' && count > 0 ? (
          <a
            href={'/signals'}
            className="inline-flex min-h-11 items-center font-mono text-[10px] tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            all signals →
          </a>
        ) : null}
      </div>

      {state.status === 'ready' && count > 0 ? (
        <div className="brief-feed-items">
          {(concise ? brief.stocks.slice(0, 3) : brief.stocks).map((item) => (
            <StockItem key={`${item.signalSlug}-${item.entityId}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="border-b border-line">
          {state.status === 'unavailable' ? (
            <ErrorState
              description="The signal store could not be read. No substitute content was inserted."
              primaryAction={
                <a href="" className="underline">
                  try again →
                </a>
              }
            />
          ) : (
            <EmptyState
              title={`no verified signals ${editionDay}`}
              description={
                <p className="max-w-[65ch] text-sm leading-6 text-[var(--color-muted)]">
                  Nothing cleared the evidence and publication gates for this edition.{' '}
                  <a
                    href={alternateHref}
                    className="text-[var(--color-fg)] underline decoration-[var(--color-line)] underline-offset-4 hover:text-[var(--color-accent)]"
                  >
                    Check {alternateDay}
                  </a>{' '}
                  or{' '}
                  <a
                    href={'/signals'}
                    data-app-health-event="signals.browse_opened"
                    className="text-[var(--color-fg)] underline decoration-[var(--color-line)] underline-offset-4 hover:text-[var(--color-accent)]"
                  >
                    browse earlier verified signals
                  </a>
                  .
                </p>
              }
              primaryAction={
                <a href={alternateHref} className="underline">
                  check {alternateDay} →
                </a>
              }
            />
          )}
        </div>
      )}
    </section>
  );
}

export function BriefEnding({ brief, day }: { brief: BriefSnapshot; day: 'today' | 'yesterday' }) {
  return (
    <div className="border-t border-[var(--color-line)] py-8">
      <p className="text-lg font-medium tracking-[-0.02em]">End of the brief.</p>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
        Come back for the next edition, or go deeper into the source collection.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
        <a
          className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)]"
          href={briefNewsPageHref({ page: 1, day, region: brief.region, all: true })}
        >
          all stories →
        </a>
        <a
          className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)]"
          href="/data"
        >
          source coverage →
        </a>
      </div>
    </div>
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
      <NewsFeed brief={brief} />
      {sections.includes('stocks') ? (
        <SectionShell
          id="markets-companies"
          title="markets & companies"
          description="Material company and market changes with a grounded implication, principal uncertainty, and only direct track-record history. This is decision support, not investment advice."
          state={states.stocks}
          count={brief.stocks.length}
          empty="No market signal cleared the editorial and evidence gates for this edition."
          action={
            <a
              href={'/signals'}
              className="inline-flex min-h-11 items-center font-mono text-[10px] tracking-[0.14em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              all signals →
            </a>
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
          title="business opportunities"
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
          title="behavior & culture"
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
