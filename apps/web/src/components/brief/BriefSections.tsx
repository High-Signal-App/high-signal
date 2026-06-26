import Link from 'next/link';
import type { Route } from 'next';
import type {
  BriefImprovementItem,
  BriefIdeaItem,
  BriefPerceptionItem,
  BriefSnapshot,
  BriefStockItem,
  BriefTrendItem,
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
    <section className="mt-10 border-y border-[var(--color-line)] py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            {eyebrow}
          </div>
          <h2 className="mt-2 text-2xl font-medium tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="mt-6">
        {isEmpty ? (
          <p className="text-sm leading-6 text-[var(--color-muted)]">
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
    <article className="grid gap-3 border-b border-[var(--color-line)] py-5 md:grid-cols-[1fr_220px]">
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
          className="mt-3 block text-lg font-medium tracking-tight hover:text-[var(--color-accent)]"
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
      </div>
      <div className="border border-[var(--color-line)] p-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
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

function IdeaItem({ item }: { item: BriefIdeaItem }) {
  return (
    <article className="border-b border-[var(--color-line)] py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        {item.source} {item.subreddit ? `/ r/${item.subreddit}` : ''} ·{' '}
        {item.surfacedAt.slice(0, 10)}
      </div>
      <h3 className="mt-2 text-lg font-medium tracking-tight">{item.title}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
        {item.description}
      </p>
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
    <article className="border-b border-[var(--color-line)] py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        r/{item.subreddit} · {item.surfacedAt.slice(0, 10)}
      </div>
      <h3 className="mt-2 text-lg font-medium tracking-tight">{item.title}</h3>
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
    <article className="grid gap-3 border-b border-[var(--color-line)] py-5 md:grid-cols-[1fr_repeat(3,minmax(0,110px))]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          {item.latestCheckAt?.slice(0, 16).replace('T', ' ') ?? 'no check yet'}
        </div>
        <Link
          href={`/mentions?config=${encodeURIComponent(item.configId)}` as Route}
          className="mt-2 block text-lg font-medium tracking-tight hover:text-[var(--color-accent)]"
        >
          {item.brandName}
        </Link>
      </div>
      <div className="border border-[var(--color-line)] p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>mentioned</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.mentionRate)}
        </div>
      </div>
      <div className="border border-[var(--color-line)] p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>positive</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.positiveShare)}
        </div>
      </div>
      <div className="border border-[var(--color-line)] p-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <div>competitors</div>
        <div className="mt-2 text-lg font-medium text-[var(--color-fg)]">
          {formatPct(item.competitorPresence)}
        </div>
      </div>
    </article>
  );
}

function ImprovementItem({ item }: { item: BriefImprovementItem }) {
  return (
    <article className="grid grid-cols-[80px_1fr] gap-4 border-b border-[var(--color-line)] py-5">
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
        <Link
          href={`/agent-eval?audit=${encodeURIComponent(item.auditId)}` as Route}
          className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          open audit →
        </Link>
      </div>
    </article>
  );
}

export function BriefSections({ brief }: { brief: BriefSnapshot }) {
  return (
    <>
      <SectionShell
        eyebrow="01 / stocks watching for a boom"
        title="Where finance and technology overlap"
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
        <p className="mb-4 border-l-2 border-[var(--color-line)] pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
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
        title="What demand is opening that nobody owns yet"
        description="Aggregated 'key action' items from community digests. Each idea links back to the source thread."
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
          {brief.ideas.map((item, i) => (
            <IdeaItem key={`${item.title}-${i}`} item={item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="03 / new lifestyle trends"
        title="How people are spending their time and attention"
        description="Key trends from the community digests. Lifestyle drift before it shows up in mainstream coverage."
        isEmpty={brief.trends.length === 0}
        empty="No new trend clusters in the latest community sweep."
      >
        <div className="border-t border-[var(--color-line)]">
          {brief.trends.map((item, i) => (
            <TrendItem key={`${item.title}-${i}`} item={item} />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="04 / how the market perceives your products"
        title="Brand visibility in AI assistants"
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
        title="Evidence agents would expect to find but can't"
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
          {brief.improvements.map((item, i) => (
            <ImprovementItem key={`${item.auditId}-${i}`} item={item} />
          ))}
        </div>
      </SectionShell>
    </>
  );
}
