import Link from 'next/link';
import type { Route } from 'next';
import type {
  BriefImprovementItem,
  BriefIntentItem,
  BriefIdeaItem,
  BriefPerceptionItem,
  BriefSnapshot,
  BriefStockItem,
  BriefTrendItem,
  BriefWatchingItem,
  BriefClaimProvenance,
} from '@high-signal/shared';

interface SectionShellProps {
  eyebrow: string;
  title: string;
  description?: string;
  empty?: string;
  children: React.ReactNode;
  isEmpty?: boolean;
  action?: React.ReactNode;
}

function SectionShell({
  eyebrow,
  title,
  description,
  empty,
  children,
  isEmpty,
  action,
}: SectionShellProps) {
  return (
    <section className="mt-8 rounded-md border border-[var(--color-line)] bg-zinc-950/35 p-4 sm:p-5">
      <header className="grid gap-4 border-b border-[var(--color-line)] pb-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {eyebrow}
          </div>
          <h2 className="mt-2 text-2xl font-medium tracking-tight text-[var(--color-fg)]">
            {title}
          </h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      <div>
        {isEmpty ? (
          <p className="pt-5 text-sm leading-6 text-[var(--color-muted)]">
            {empty ?? 'Nothing here yet.'}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function directionTone(direction: 'up' | 'down' | 'neutral') {
  if (direction === 'up') return 'text-emerald-300';
  if (direction === 'down') return 'text-rose-300';
  return 'text-[var(--color-muted)]';
}

function formatPct(value: number | null) {
  if (value == null) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function IntentFinding({ intent }: { intent: BriefIntentItem }) {
  return (
    <div className="border-l-2 border-[var(--color-accent)] pl-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <span className="text-[var(--color-accent)]">{intent.intentStage} intent</span>
        <span>{intent.platform}</span>
        <span>{intent.score}/100</span>
        <span>{intent.actionType.replaceAll('_', ' ')}</span>
      </div>
      <a
        href={intent.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block text-sm font-medium leading-6 text-[var(--color-fg)] hover:text-[var(--color-accent)]"
      >
        {intent.sourceTitle} ↗
      </a>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-muted)]">
        {intent.sourceExcerpt}
      </p>
      {intent.competitors.length ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          competitors: {intent.competitors.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function verdictTone(verdict: NonNullable<BriefIdeaItem['opportunity']>['verdict']) {
  if (verdict === 'enter') return 'text-emerald-300';
  if (verdict === 'test') return 'text-[var(--color-accent)]';
  if (verdict === 'watch') return 'text-amber-300';
  return 'text-rose-300';
}

function StockItem({ item }: { item: BriefStockItem }) {
  const bandCopy =
    item.hitRateBand === 'direct'
      ? 'this signal type'
      : item.hitRateBand === 'family'
        ? `family rate — ${item.signalFamily.replaceAll('-', ' ')}`
        : item.hitRateBand === 'early'
          ? 'early calls'
          : 'no live calls yet';
  const hitRateColor =
    item.hitRate == null
      ? 'text-[var(--color-muted)]'
      : item.hitRate >= 0.5
        ? 'text-[var(--color-accent)]'
        : 'text-rose-300';
  return (
    <article className="grid gap-4 border-b border-[var(--color-line)] py-5 transition-colors last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[1fr_230px] md:px-3">
      <div>
        <div className="flex flex-wrap items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <span className="text-[var(--color-fg)]">{item.entityName}</span>
          {item.ticker ? <span>· {item.ticker}</span> : null}
          {item.country ? <span>· {item.country}</span> : null}
          <span>· {item.signalType.replaceAll('_', ' ')}</span>
          <span className={directionTone(item.direction)}>{item.direction}</span>
          <span>· {item.confidence}</span>
          <span>· {item.predictedWindowDays}d window</span>
        </div>
        <Link
          href={`/signals/${encodeURIComponent(item.signalSlug)}` as Route}
          className="mt-3 block text-xl font-medium leading-7 tracking-tight hover:text-[var(--color-accent)]"
        >
          {item.headline}
        </Link>
        {item.evidenceUrls.length ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--color-muted)]">
            {item.evidenceUrls.slice(0, 4).map((cite) => (
              <li key={cite.url}>
                <a
                  className="hover:text-[var(--color-accent)]"
                  href={cite.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {cite.source ?? new URL(cite.url).hostname.replace(/^www\./, '')}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {item.provenance ? (
          <ProvenanceDisclosure provenance={item.provenance} signalSlug={item.signalSlug} />
        ) : null}
      </div>
      <div className="rounded-md border border-[var(--color-line)] bg-black/20 p-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>{bandCopy}</div>
        <div className={`mt-2 text-xl font-medium ${hitRateColor}`}>
          {item.hitRate == null
            ? 'no live calls yet'
            : `${(item.hitRate * 100).toFixed(0)}% hit-rate`}
        </div>
        <div className="mt-1 text-[var(--color-muted)]">
          {item.hitRateSample
            ? `${item.hitRateSample} scored ${item.hitRateBand === 'family' ? 'across family' : 'calls'}`
            : 'pending — backfill not counted'}
        </div>
        <Link
          href={'/track-record' as Route}
          className="mt-3 block underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
        >
          full ledger →
        </Link>
      </div>
    </article>
  );
}

function ProvenanceDisclosure({
  provenance,
  signalSlug,
  why,
}: {
  provenance: BriefClaimProvenance;
  signalSlug: string;
  why?: string;
}) {
  return (
    <details className="mt-3 border-l border-[var(--color-line)] pl-3 font-mono text-[10px] text-[var(--color-muted)]">
      <summary className="cursor-pointer uppercase tracking-[0.18em] hover:text-[var(--color-accent)]">
        why this is here
      </summary>
      <div className="mt-2 space-y-2 leading-5">
        {why ? <p>{why}</p> : null}
        <p className="text-[var(--color-fg)]">{provenance.assertion}</p>
        <p>
          claim v{provenance.version} · {provenance.primaryCount} primary ·{' '}
          {provenance.corroborationCount} corroboration · {provenance.evidenceCount} sources
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Link
            href={`/signals/${encodeURIComponent(signalSlug)}#provenance` as Route}
            className="hover:text-[var(--color-accent)]"
          >
            claim {provenance.claimId.slice(0, 8)} →
          </Link>
          {provenance.evidenceUrls.slice(0, 3).map((url, index) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--color-accent)]"
            >
              source {index + 1}
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

function WatchingItem({ item }: { item: BriefWatchingItem }) {
  return (
    <article
      className={`border-b border-[var(--color-line)] py-5 last:border-b-0 sm:px-3 ${
        item.observed ? '' : 'opacity-75'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <span className="text-[var(--color-fg)]">{item.subjectEntityName}</span>
        <span>· {item.deltaKind.replace('_', ' ')}</span>
        <span>· {item.observed ? 'observed' : 'inferred'}</span>
        <span>· {item.confidence} confidence</span>
      </div>
      <Link
        href={`/signals/${encodeURIComponent(item.signalSlug)}` as Route}
        className="mt-2 block text-xl font-medium leading-7 tracking-tight hover:text-[var(--color-accent)]"
      >
        {item.headline}
      </Link>
      <ProvenanceDisclosure
        provenance={item.provenance}
        signalSlug={item.signalSlug}
        why={item.why.replace(item.watchedEntityId, item.watchedEntityName)}
      />
    </article>
  );
}

function IdeaItem({ item }: { item: BriefIdeaItem }) {
  const opportunity = item.opportunity;
  return (
    <article className="border-b border-[var(--color-line)] py-5 transition-colors last:border-b-0 hover:bg-white/[0.025] sm:px-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            {item.source} {item.subreddit ? `/ r/${item.subreddit}` : ''} ·{' '}
            {item.surfacedAt.slice(0, 10)}
          </div>
          <h3 className="mt-2 max-w-3xl text-xl font-medium leading-7 tracking-tight">
            {item.title}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            {item.description}
          </p>
        </div>
        {opportunity ? (
          <div className="rounded-md border border-[var(--color-line)] bg-black/20 p-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            <div>verdict</div>
            <div className={`mt-2 text-xl font-medium ${verdictTone(opportunity.verdict)}`}>
              {opportunity.verdict}
            </div>
            <div className="mt-1">{opportunity.confidence} confidence</div>
            {opportunity.priorHitRate ? (
              <div className="mt-3 border-t border-[var(--color-line)] pt-3">
                {opportunity.priorHitRate.hitRate == null
                  ? 'no prior hit-rate'
                  : `${(opportunity.priorHitRate.hitRate * 100).toFixed(0)}% prior hit-rate`}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {opportunity ? (
        <div className="mt-5 grid gap-5 border-t border-[var(--color-line)] pt-5 md:grid-cols-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              target + problem
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              <span className="text-[var(--color-fg)]">{opportunity.targetUser}</span> —{' '}
              {opportunity.problem}
            </p>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              next validation
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              {opportunity.nextValidationStep}
            </p>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              evidence mix
            </div>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
              {opportunity.evidenceMix.slice(0, 3).map((evidence) => (
                <li key={`${evidence.kind}-${evidence.label}`}>
                  <span className="text-[var(--color-fg)]">{evidence.label}</span> ·{' '}
                  {evidence.strength} · {evidence.sourceCount} sources
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              why now + risk
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              {opportunity.marketTimingReasons[0]}
            </p>
            {opportunity.risks[0] ? (
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                <span className="text-[var(--color-fg)]">Risk:</span> {opportunity.risks[0]}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {item.evidenceUrls.length ? (
        <ul className="mt-2 flex flex-wrap gap-4 font-mono text-[10px]">
          {item.evidenceUrls.slice(0, 3).map((cite) => (
            <li key={cite.url}>
              <a
                className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                href={cite.url}
                rel="noreferrer"
                target="_blank"
              >
                source
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function TrendItem({ item }: { item: BriefTrendItem }) {
  return (
    <article className="border-b border-[var(--color-line)] py-5 transition-colors last:border-b-0 hover:bg-white/[0.025] sm:px-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        r/{item.subreddit} · {item.surfacedAt.slice(0, 10)}
      </div>
      <h3 className="mt-2 max-w-3xl text-xl font-medium leading-7 tracking-tight">{item.title}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
        {item.description}
      </p>
      {item.evidenceUrls[0] ? (
        <a
          className="mt-2 inline-block font-mono text-[10px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          href={item.evidenceUrls[0].url}
          rel="noreferrer"
          target="_blank"
        >
          source thread →
        </a>
      ) : null}
    </article>
  );
}

function PerceptionItem({ item }: { item: BriefPerceptionItem }) {
  return (
    <article className="grid gap-3 border-b border-[var(--color-line)] py-5 transition-colors last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[1fr_repeat(3,minmax(0,116px))] md:px-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          {item.latestCheckAt?.slice(0, 16).replace('T', ' ') ?? 'no check yet'}
        </div>
        <Link
          href={`/mentions/${encodeURIComponent(item.configId)}?tab=intent` as Route}
          className="mt-2 block text-xl font-medium tracking-tight hover:text-[var(--color-accent)]"
        >
          {item.brandName}
        </Link>
      </div>
      <div className="rounded-md border border-[var(--color-line)] bg-black/20 p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>mentioned</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.mentionRate)}
        </div>
      </div>
      <div className="rounded-md border border-[var(--color-line)] bg-black/20 p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>positive</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.positiveShare)}
        </div>
      </div>
      <div className="rounded-md border border-[var(--color-line)] bg-black/20 p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>competitors</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.competitorPresence)}
        </div>
      </div>
      {item.topIntent ? (
        <div className="md:col-span-4">
          <IntentFinding intent={item.topIntent} />
        </div>
      ) : null}
    </article>
  );
}

function ImprovementItem({ item }: { item: BriefImprovementItem }) {
  return (
    <article className="grid gap-4 border-b border-[var(--color-line)] py-5 transition-colors last:border-b-0 hover:bg-white/[0.025] sm:grid-cols-[120px_1fr] sm:px-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div
          className={
            item.priority === 'high'
              ? 'text-rose-300'
              : item.priority === 'medium'
                ? 'text-amber-300'
                : 'text-[var(--color-muted)]'
          }
        >
          {item.priority}
        </div>
        <div className="mt-2">{item.area}</div>
      </div>
      <div>
        <div className="text-sm text-[var(--color-muted)]">{item.brandName}</div>
        <h3 className="mt-1 text-base leading-6 text-[var(--color-fg)]">{item.task}</h3>
        {item.intent ? (
          <div className="mt-3">
            <IntentFinding intent={item.intent} />
            <Link
              href={`/mentions/${encodeURIComponent(item.intent.brandId)}?tab=intent` as Route}
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            >
              review in intent inbox →
            </Link>
            {item.auditId ? (
              <Link
                href={`/agent-eval?audit=${encodeURIComponent(item.auditId)}` as Route}
                className="ml-4 mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              >
                open linked audit →
              </Link>
            ) : null}
          </div>
        ) : item.auditId ? (
          <Link
            href={`/agent-eval?audit=${encodeURIComponent(item.auditId)}` as Route}
            className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            open audit →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function BriefSections({ brief }: { brief: BriefSnapshot }) {
  return (
    <>
      <SectionShell
        eyebrow="01 / stocks watching for a boom"
        title="Market change with receipts"
        description="Recent published market signals, ranked by direction and confidence. Hit-rate inline so you can size your trust per signal type."
        isEmpty={brief.stocks.length === 0}
        empty="No qualifying market signals this window. The ingest cron hasn't surfaced a fresh call yet."
        action={
          <Link
            href={'/markets' as Route}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            markets lens →
          </Link>
        }
      >
        <p className="my-4 border-l-2 border-[var(--color-line)] pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          Decision support, not stock advice. Cited signals to inform your research — not a
          recommendation to buy, sell, or hold.
        </p>
        <div className="border-t border-[var(--color-line)]">
          {brief.stocks.map((item) => (
            <StockItem key={`${item.signalSlug}-${item.entityId}`} item={item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="02 / business ideas to build"
        title="Demand threads worth turning into product bets"
        description="Aggregated key actions from community digests. Each idea links back to the source thread and stays framed as a validation target, not a brainstorm."
        isEmpty={brief.ideas.length === 0}
        empty="No fresh demand clusters surfaced from the tracked communities yet."
        action={
          <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            <Link href={'/opportunities' as Route} className="hover:text-[var(--color-accent)]">
              deeper view →
            </Link>
            <Link href={'/communities' as Route} className="hover:text-[var(--color-accent)]">
              communities lens →
            </Link>
          </div>
        }
      >
        <div className="border-t border-[var(--color-line)]">
          {brief.ideas.map((item) => (
            <IdeaItem
              key={`${item.surfacedAt}-${item.subreddit ?? 'opportunity'}-${item.title}`}
              item={item}
            />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="03 / new lifestyle trends"
        title="Behavior shifts before they become categories"
        description="Key trends from the community digests. Lifestyle drift before it shows up in mainstream coverage."
        isEmpty={brief.trends.length === 0}
        empty="No new trend clusters in the latest community sweep."
      >
        <div className="border-t border-[var(--color-line)]">
          {brief.trends.map((item) => (
            <TrendItem key={`${item.surfacedAt}-${item.subreddit}-${item.title}`} item={item} />
          ))}
        </div>
      </SectionShell>

      {(brief.watching?.items.length ?? 0) > 0 ? (
        <SectionShell
          eyebrow="watching / your entities"
          title="What moved around names you follow"
          description="Direct and one-hop impacts from your default watchlist. Every item is attached to structured claim evidence."
          action={
            <Link
              href={'/watchlist/entities' as Route}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            >
              manage watchlist →
            </Link>
          }
        >
          <div className="border-t border-[var(--color-line)]">
            {brief.watching?.items.map((item) => (
              <WatchingItem key={`${item.signalId}-${item.watchedEntityId}`} item={item} />
            ))}
          </div>
        </SectionShell>
      ) : null}

      <SectionShell
        eyebrow="04 / how the market perceives your products"
        title="How agents and buyers perceive your product"
        description="Mention rate, sentiment, and competitor presence across the latest checks. Pick another product from the picker to recompose this section."
        isEmpty={brief.perception.length === 0}
        empty="No perception data — switch product in the picker."
        action={
          <Link
            href={'/mentions' as Route}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            mentions lens →
          </Link>
        }
      >
        <div className="border-t border-[var(--color-line)]">
          {brief.perception.map((item) => (
            <PerceptionItem key={item.configId} item={item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="05 / ideas to improve your products"
        title="Proof tasks that make the product recommendable"
        description="Open missing-evidence tasks ordered by priority, scoped to the picked product."
        isEmpty={brief.improvements.length === 0}
        empty="No open tasks for this product."
        action={
          <Link
            href={'/agent-eval' as Route}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            agent eval lens →
          </Link>
        }
      >
        <div className="border-t border-[var(--color-line)]">
          {brief.improvements.map((item) => (
            <ImprovementItem key={`${item.auditId}-${item.area}-${item.task}`} item={item} />
          ))}
        </div>
      </SectionShell>
    </>
  );
}
