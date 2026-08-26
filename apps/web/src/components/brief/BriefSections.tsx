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
  type DiggAttentionGapItem,
  type DiggAttentionItem,
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

function rankMovement(delta: number | null) {
  if (delta == null || delta === 0) return 'no rank movement';
  return delta > 0 ? `↑ ${delta} places` : `↓ ${Math.abs(delta)} places`;
}

function AttentionItem({ item }: { item: DiggAttentionItem }) {
  const title = (
    <span className="block max-w-4xl text-xl font-medium leading-7 tracking-[-0.02em] text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
      {item.title}
    </span>
  );

  return (
    <article className="border-b border-[var(--color-line)] py-6 last:border-b-0">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
            <span>
              {item.attentionState === 'matched_signal' ? 'signal matched' : 'investigation lead'}
            </span>
            <span>{item.position == null ? 'unranked' : `rank ${item.position}`}</span>
            <span>{rankMovement(item.positionDelta)}</span>
            <span>{item.distinctAccountCount} distinct voices</span>
          </div>
          {item.signalSlug ? (
            <Link
              href={`/signals/${encodeURIComponent(item.signalSlug)}` as Route}
              className="group mt-3 block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              {title}
            </Link>
          ) : (
            <a
              href={item.canonicalDiggUrl}
              target="_blank"
              rel="noreferrer"
              className="group mt-3 block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              {title}
            </a>
          )}
          {item.summary ? (
            <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
              {item.summary}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
            <a
              href={item.canonicalDiggUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
            >
              Digg cluster ↗
            </a>
            {item.sourceUrls.slice(0, 2).map((url, index) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
              >
                source post {index + 1} ↗
              </a>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-line)] pt-4 text-sm md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Peak
            </dt>
            <dd className="mt-1 tabular-nums text-[var(--color-fg)]">
              {item.peakPosition == null ? '—' : `#${item.peakPosition}`}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Time observed
            </dt>
            <dd className="mt-1 tabular-nums text-[var(--color-fg)]">
              {item.attentionDurationHours}h
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Source origins
            </dt>
            <dd className="mt-1 tabular-nums text-[var(--color-fg)]">
              {item.canonicalSourceCount || 'unknown'}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Evidence confidence
            </dt>
            <dd className="mt-1 text-[var(--color-fg)]">Unchanged</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

const GAP_LABELS: Record<DiggAttentionGapItem['gapType'], string> = {
  attention_stronger_than_evidence: 'attention ahead of evidence',
  evidence_stronger_than_attention: 'evidence ahead of attention',
  single_origin_amplification: 'one-origin amplification',
  framing_conflict: 'framing conflicts with evidence',
};

function AttentionGapItem({ item }: { item: DiggAttentionGapItem }) {
  return (
    <article className="border-b border-[var(--color-line)] py-5 last:border-b-0">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
        {GAP_LABELS[item.gapType]}
      </div>
      <h4 className="mt-2 max-w-4xl text-lg font-medium leading-7 text-[var(--color-fg)]">
        {item.title}
      </h4>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
        {item.explanation}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
        {item.signalSlug ? (
          <Link
            href={`/signals/${encodeURIComponent(item.signalSlug)}` as Route}
            className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            High Signal evidence →
          </Link>
        ) : null}
        {item.canonicalDiggUrl ? (
          <a
            href={item.canonicalDiggUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            Digg attention ↗
          </a>
        ) : null}
        {item.evidenceUrls.slice(0, 2).map((citation) => (
          <a
            key={citation.url}
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            evidence · {citation.source ?? sourceHost(citation.url)} ↗
          </a>
        ))}
      </div>
    </article>
  );
}

function AttentionSubsection({
  id,
  title,
  description,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-[var(--color-line)] py-7">
      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
            {count} {count === 1 ? 'observation' : 'observations'}
          </div>
          <h3 className="mt-2 text-xl font-medium tracking-[-0.02em] text-[var(--color-fg)]">
            {title}
          </h3>
        </div>
        <p className="max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">{description}</p>
      </div>
      {count > 0 ? (
        <div className="mt-5 border-t border-[var(--color-line)]">{children}</div>
      ) : (
        <p className="mt-5 border-t border-dashed border-[var(--color-line)] pt-4 text-sm leading-6 text-[var(--color-muted)]">
          {empty}
        </p>
      )}
    </section>
  );
}

function AttentionLayer({ brief }: { brief: BriefSnapshot }) {
  const available =
    brief.attentionLeaders !== undefined &&
    brief.emergingBeforeMainstream !== undefined &&
    brief.attentionEvidenceGaps !== undefined;
  const leaders = brief.attentionLeaders ?? [];
  const emerging = brief.emergingBeforeMainstream ?? [];
  const gaps = brief.attentionEvidenceGaps ?? [];
  const count = leaders.length + emerging.length + gaps.length;

  return (
    <section
      id="attention-layer"
      className="scroll-mt-20 border-b border-[var(--color-line)] py-10"
    >
      <header className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
            {available ? 'Derived attention · not evidence' : 'Attention source unavailable'}
          </div>
          <h2 className="mt-2 text-3xl font-medium tracking-[-0.025em] text-[var(--color-fg)]">
            Attention layer
          </h2>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[var(--color-muted)]">
            {available
              ? 'Digg shows what credible technology voices are noticing. High Signal keeps that attention separate from independent evidence, factual confidence, and predicted direction.'
              : 'This edition predates the Digg attention dataset or the attention source could not be composed. No substitute observations were inserted.'}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-[var(--color-line)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Observations
            </dt>
            <dd className="mt-1 text-2xl font-medium tabular-nums text-[var(--color-fg)]">
              {count}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
              Evidence confidence
            </dt>
            <dd className="mt-1 text-sm text-[var(--color-fg)]">Unchanged by attention</dd>
          </div>
        </dl>
      </header>

      {available ? (
        <div className="mt-7">
          <AttentionSubsection
            id="attention-leaders"
            title="Attention leaders"
            description="Highest-ranked Digg clusters that already connect to a material High Signal entity or published signal."
            count={leaders.length}
            empty="No Digg cluster currently maps to a published High Signal item."
          >
            {leaders.map((item) => (
              <AttentionItem key={item.shortId} item={item} />
            ))}
          </AttentionSubsection>

          <AttentionSubsection
            id="emerging-before-mainstream"
            title="Emerging before mainstream"
            description="Rising clusters that warrant original-source investigation. These are discovery leads, not factual claims."
            count={emerging.length}
            empty="No unmatched rising cluster cleared the investigation threshold."
          >
            {emerging.map((item) => (
              <AttentionItem key={item.shortId} item={item} />
            ))}
          </AttentionSubsection>

          <AttentionSubsection
            id="attention-evidence-gaps"
            title="Attention–evidence gaps"
            description="Material mismatches between public attention, independent support, and source concentration."
            count={gaps.length}
            empty="No material mismatch between attention and evidence is visible in this edition."
          >
            {gaps.map((item) => (
              <AttentionGapItem key={item.id} item={item} />
            ))}
          </AttentionSubsection>
        </div>
      ) : null}
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
  const attentionCount =
    (brief.attentionLeaders?.length ?? 0) +
    (brief.emergingBeforeMainstream?.length ?? 0) +
    (brief.attentionEvidenceGaps?.length ?? 0);
  const hasCoreContent = brief.stocks.length + brief.ideas.length + brief.trends.length > 0;
  const attentionFirst = attentionCount > 0 && !hasCoreContent;

  return (
    <>
      {attentionFirst ? <AttentionLayer brief={brief} /> : null}
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

      {!attentionFirst ? <AttentionLayer brief={brief} /> : null}
    </>
  );
}
