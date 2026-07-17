import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type SignalRow, type TrackBucket } from '@/lib/api';
import { isBackfillSignal, signalHeadline, signalSummary } from '@/lib/signal-format';
import { FaqJsonLd, SoftwareApplicationJsonLd, HomeJsonLd } from '@/components/seo/structured-data';
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** Homepage self-canonical — do not inherit a global homepage canonical onto every route. */
export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — ${SITE_TAGLINE}`,
  },
  description:
    'High Signal is a daily evidence-first intelligence brief on technology, startups, and finance. Every claim cites two independent sources and a public hit-rate ledger tracks whether past signals were right.',
  alternates: {
    canonical: SITE_URL,
  },
};

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Homepage FAQ for GEO (generative-engine optimization). AI search
 * engines lift 35-60 word passages, so each answer is self-contained,
 * factual, and in that band. Mirrors the wording in agents.md and
 * /methodology so surfaces stay in sync.
 */
const HOMEPAGE_FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'What is High Signal?',
    answer:
      'High Signal is a daily synthesized intelligence brief covering technology, startups, and finance. It aggregates noisy public sources, curates and cleans them, and emits an end-of-day brief answering five questions for operators. Every claim cites at least two independent sources.',
  },
  {
    question: 'Is High Signal free?',
    answer:
      'Yes, everything is free for now. There is no paid tier, no billing, and no paywall. Region filters are free, and all features are accessible without payment. The brief renders identically for anonymous and signed-in users until a brand is connected.',
  },
  {
    question: 'How does High Signal ensure quality?',
    answer:
      'Every claim in the brief must cite at least two independent sources. A public hit-rate ledger tracks whether past signals were right. Confidence is rated as low, medium, or high, and calibrated post-hoc against outcomes. Prediction-market-only drafts are killed even when the pipeline marks them publishable.',
  },
  {
    question: 'What sources does High Signal use?',
    answer:
      'Reddit, news, Hacker News, YouTube transcripts, SEC filings, GitHub, IR pages, papers, government feeds, and prediction markets. The job is curation and de-duplication, not aggregation volume. Sources are grouped into classes — news, filing, ir, blog, regulator, transcript, repo, and market — so independence is checked by class, not just domain.',
  },
  {
    question: 'What is the hit-rate ledger?',
    answer:
      'A public track record showing whether past signals were accurate. It is the competitive moat — competitors cannot copy it without rebuilding the history from scratch. Every published market signal is scored against subsequent moves, and the hit-rate displays inline on each new signal.',
  },
  {
    question: 'Can I filter by region?',
    answer:
      'Yes, region is a free filter on every section. The default is global. Users can switch to any region and the brief recomputes scoped to that region\u2019s entities and sources. Preference persists for signed-in users via Clerk publicMetadata.',
  },
  {
    question: 'Does High Signal have an API or RSS feed?',
    answer:
      'Yes, RSS and Atom feeds are available at /digest/rss and /digest/atom. Signal-level feeds live at /signals/rss and /signals/atom. There is also an API docs page at /api-docs describing the REST endpoints for signals, entities, and the track record.',
  },
  {
    question: 'Where can I download the hit-rate dataset?',
    answer:
      'The public hit-rate ledger is downloadable as JSON and CSV at /data. The dataset includes every published market signal scored against subsequent moves, broken down by signal type, with hit, miss, push, and hit-rate columns. It is licensed CC-BY 4.0 for citation in research and analysis.',
  },
];

/**
 * Methodology digest — the five pipeline steps, condensed from the
 * canonical /methodology page. Each step is one sentence so the
 * homepage carries the process without duplicating the full reference.
 */
const METHODOLOGY_STEPS = [
  {
    name: 'Ingest',
    text: 'Pipelines pull from SEC filings, IR pages, news, Hacker News, Reddit, GitHub, YouTube transcripts, prediction markets, and government feeds. Daily at 06:00 UTC via GitHub Actions. No web scraping of paywalled content.',
  },
  {
    name: 'Score',
    text: "Each candidate is scored against the pipeline's quality rubric: number of evidence URLs, number of independent source classes, presence of fallback flags, and semantic clarity of the directional claim. Output is a quality band and a publishable boolean.",
  },
  {
    name: 'Auto-judge',
    text: 'A deterministic rubric runs at 07:00 UTC. Drafts with \u2265 2 independent source classes and pipeline blessing PUBLISH. Prediction-market-only drafts KILL \u2014 markets reflect crowd opinion, not new information. Borderline cases ESCALATE to an AI judge with the same hard rules in its system prompt.',
  },
  {
    name: 'Score vs market',
    text: 'Every published signal carries a predicted window (e.g. 20 days). At 22:30 UTC, the scorer runs against signals whose window has closed and records hit / miss / push. The result lands in the public hit-rate ledger.',
  },
  {
    name: 'Surface',
    text: 'The brief composes five sections from D1: stocks watching for a boom, business ideas to build, lifestyle trends, market perception of operator brands, and product-improvement ideas. Region filter free for everyone. Hit-rate inline on every stock claim.',
  },
];

function formatHitRate(value: number | null) {
  return value != null ? `${(value * 100).toFixed(0)}%` : '\u2014';
}

function summarizeBuckets(buckets: TrackBucket[]) {
  return buckets.reduce(
    (acc, bucket) => {
      acc.hit += bucket.hit;
      acc.miss += bucket.miss;
      acc.push += bucket.push;
      acc.total += bucket.total;
      return acc;
    },
    { hit: 0, miss: 0, push: 0, total: 0 }
  );
}

function hitRateFrom(summary: ReturnType<typeof summarizeBuckets>) {
  return summary.hit + summary.miss > 0 ? summary.hit / (summary.hit + summary.miss) : null;
}

export default async function HomePage() {
  // Load today's signals + track record in parallel. Both degrade
  // gracefully when the API is offline — the page still renders the
  // methodology + FAQ sections, which are static and always real.
  let todaySignals: SignalRow[] = [];
  let cohorts: { live: TrackBucket[]; backfill: TrackBucket[]; all: TrackBucket[] } = {
    live: [],
    backfill: [],
    all: [],
  };
  try {
    const [signalsRes, cohortsRes] = await Promise.allSettled([
      api.signals({ limit: 200 }),
      api.trackRecordCohorts(),
    ]);
    if (signalsRes.status === 'fulfilled') {
      todaySignals = signalsRes.value.signals
        .filter((s) => !isBackfillSignal(s))
        .sort(
          (a, b) =>
            CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
            (b.qualityScore ?? 0) - (a.qualityScore ?? 0) ||
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        )
        .slice(0, 3);
    }
    if (cohortsRes.status === 'fulfilled') cohorts = cohortsRes.value;
  } catch {
    /* api offline — static sections still render */
  }

  const liveSummary = summarizeBuckets(cohorts.live);
  const liveHitRate = hitRateFrom(liveSummary);
  const backfillSummary = summarizeBuckets(cohorts.backfill);
  const backfillHitRate = hitRateFrom(backfillSummary);
  const totalScored = liveSummary.total + backfillSummary.total;
  const liveTypes = cohorts.live.length;
  const topLiveTypes = cohorts.live
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <HomeJsonLd />
      <SoftwareApplicationJsonLd />
      <FaqJsonLd items={HOMEPAGE_FAQ} />

      {/* Hero */}
      <header className="mb-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
          evidence-first daily intelligence
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-100 sm:text-5xl">
          High Signal
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          One daily brief on technology, startups, and finance. High Signal turns 20+ noisy public
          sources — SEC filings, Reddit, Hacker News, YouTube transcripts, GitHub, prediction
          markets — into a clean end-of-day read. Every claim cites at least two independent
          sources, and a public hit-rate ledger tracks whether past signals were right. The moat is
          the number being public.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/brief"
            className="border border-[var(--color-accent)]/60 bg-cyan-400/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:border-[var(--color-accent)]"
          >
            read today’s brief →
          </Link>
          <Link
            href="/track-record"
            className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          >
            public hit-rate ledger
          </Link>
          <Link
            href="/data"
            className="border border-zinc-800 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          >
            download the dataset
          </Link>
        </div>
      </header>

      {/* Today's top 3 signals */}
      <section className="mb-14" aria-labelledby="today-signals-heading">
        <div className="flex items-baseline justify-between border-b border-zinc-800 pb-3">
          <h2
            id="today-signals-heading"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
          >
            today’s top signals
          </h2>
          <Link
            href="/signals/today"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
          >
            all today →
          </Link>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          The three highest-confidence published signals right now, ranked by confidence band then
          quality score. Each links to its full page with cited evidence, spillover entities, and
          the project’s prior hit-rate on that signal type.
        </p>
        {todaySignals.length === 0 ? (
          <div className="mt-6 border border-dashed border-zinc-800 p-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            no signals published yet — first cards drop after the next source sweep
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
            {todaySignals.map((s) => {
              const headline = signalHeadline(s.bodyMd, s.slug);
              const summary = signalSummary(s.bodyMd, s.slug);
              return (
                <li key={s.id} className="py-5">
                  <Link href={`/signals/${s.slug}`} className="group block">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      <span>{new Date(s.publishedAt).toISOString().slice(0, 10)}</span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-[var(--color-accent)]">{s.primaryEntityId}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{s.signalType.replaceAll('_', ' ')}</span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-zinc-400">{s.confidence} confidence</span>
                    </div>
                    <h3 className="mt-2 text-base font-medium tracking-tight text-zinc-100 group-hover:text-[var(--color-accent)]">
                      {headline}
                    </h3>
                    <p className="mt-1.5 max-w-3xl text-sm leading-6 text-zinc-400">{summary}</p>
                    <div className="mt-2 font-mono text-[10px] text-zinc-600">
                      {s.evidenceUrls.length} evidence url{s.evidenceUrls.length === 1 ? '' : 's'}
                      {s.independentSourceCount != null
                        ? ` \u00b7 ${s.independentSourceCount} independent source class${s.independentSourceCount === 1 ? '' : 'es'}`
                        : ''}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Hit-rate summary */}
      <section className="mb-14" aria-labelledby="hitrate-heading">
        <div className="flex items-baseline justify-between border-b border-zinc-800 pb-3">
          <h2
            id="hitrate-heading"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
          >
            hit-rate summary
          </h2>
          <Link
            href="/track-record"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
          >
            full ledger →
          </Link>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          The public hit-rate ledger is the competitive moat. Every published market signal is
          scored against subsequent moves — hit, miss, or push. Hit-rate excludes pushes.
          Read Live first (forward predictions made before the scoring window closed); use Backfill
          only to calibrate the scoring system. The dataset is downloadable as JSON and CSV at{' '}
          <Link href="/data" className="text-[var(--color-accent)] hover:underline">
            /data
          </Link>
          .
        </p>
        <div className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-2">
          <div className="bg-zinc-950/50 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              live forward predictions
            </div>
            <div className="nums mt-3 flex items-baseline gap-4">
              <div>
                <div className="text-3xl font-medium text-zinc-100">{formatHitRate(liveHitRate)}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  hit-rate
                </div>
              </div>
              <div className="grid flex-1 grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xl font-medium text-emerald-400">{liveSummary.hit}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    hit
                  </div>
                </div>
                <div>
                  <div className="text-xl font-medium text-rose-400">{liveSummary.miss}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    miss
                  </div>
                </div>
                <div>
                  <div className="text-xl font-medium text-zinc-500">{liveSummary.push}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    push
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 border-t border-zinc-900 pt-3 text-xs leading-5 text-zinc-500">
              {liveSummary.total} scored prediction{liveSummary.total === 1 ? '' : 's'} across{' '}
              {liveTypes} signal type{liveTypes === 1 ? '' : 's'}. This is the only section that
              should count for public trust.
            </p>
          </div>
          <div className="bg-zinc-950/50 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              backfill calibration
            </div>
            <div className="nums mt-3 flex items-baseline gap-4">
              <div>
                <div className="text-3xl font-medium text-zinc-400">
                  {formatHitRate(backfillHitRate)}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  hit-rate
                </div>
              </div>
              <div className="grid flex-1 grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xl font-medium text-emerald-400">{backfillSummary.hit}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    hit
                  </div>
                </div>
                <div>
                  <div className="text-xl font-medium text-rose-400">{backfillSummary.miss}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    miss
                  </div>
                </div>
                <div>
                  <div className="text-xl font-medium text-zinc-500">{backfillSummary.push}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    push
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 border-t border-zinc-900 pt-3 text-xs leading-5 text-zinc-500">
              {backfillSummary.total} historical-replay predictions. Useful for spotting weak signal
              types and scoring bias, not for claiming accuracy.
            </p>
          </div>
        </div>
        {topLiveTypes.length > 0 ? (
          <div className="mt-6">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              live predictions by signal type
            </h3>
            <table className="mt-3 w-full text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-800 py-2 text-left">type</th>
                  <th className="border-b border-zinc-800 py-2 text-right">n</th>
                  <th className="border-b border-zinc-800 py-2 text-right">hit</th>
                  <th className="border-b border-zinc-800 py-2 text-right">miss</th>
                  <th className="border-b border-zinc-800 py-2 text-right">push</th>
                  <th className="border-b border-zinc-800 py-2 text-right">hit-rate</th>
                </tr>
              </thead>
              <tbody className="nums">
                {topLiveTypes.map((b) => (
                  <tr key={b.signalType}>
                    <td className="border-b border-zinc-900 py-1.5 font-mono text-xs">
                      {b.signalType.replaceAll('_', ' ')}
                    </td>
                    <td className="border-b border-zinc-900 py-1.5 text-right">{b.total}</td>
                    <td className="border-b border-zinc-900 py-1.5 text-right text-emerald-400">
                      {b.hit}
                    </td>
                    <td className="border-b border-zinc-900 py-1.5 text-right text-rose-400">
                      {b.miss}
                    </td>
                    <td className="border-b border-zinc-900 py-1.5 text-right text-zinc-500">
                      {b.push}
                    </td>
                    <td className="border-b border-zinc-900 py-1.5 text-right">
                      {formatHitRate(b.hitRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {liveSummary.total > 0 && liveSummary.total < 10 ? (
          <p className="mt-4 border border-amber-500/40 bg-amber-500/[0.04] p-3 text-xs leading-5 text-amber-100">
            <strong>Sample warning:</strong> the live cohort has only {liveSummary.total} scored
            prediction{liveSummary.total === 1 ? '' : 's'}. Any rate on a sample this small is
            statistically meaningless — read it as &ldquo;direction of travel,&rdquo; not as a
            reliable accuracy claim. Wait until n ≥ 10 (per signal type) before trusting it.
          </p>
        ) : null}
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          {totalScored} total scored predictions across live + backfill · dataset updated daily
          at 22:30 UTC
        </p>
      </section>

      {/* Methodology digest */}
      <section className="mb-14" aria-labelledby="methodology-heading">
        <div className="flex items-baseline justify-between border-b border-zinc-800 pb-3">
          <h2
            id="methodology-heading"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
          >
            how it works
          </h2>
          <Link
            href="/methodology"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
          >
            full methodology →
          </Link>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          The pipeline from raw source ingest through human-readable brief. Every rule is the exact
          same wording shipped in <code className="text-zinc-300">agents.md</code>,{' '}
          <code className="text-zinc-300">/llms.txt</code>, and the auto-publish judge’s system
          prompt. Citable verbatim. Drift between surfaces costs trust.
        </p>
        <div className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
          {METHODOLOGY_STEPS.map((step, i) => (
            <article key={step.name} className="grid gap-3 py-5 md:grid-cols-[60px_1fr]">
              <div className="font-mono text-2xl text-zinc-600">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <h3 className="text-base font-medium tracking-tight text-zinc-100">{step.name}</h3>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-zinc-400">{step.text}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-6 grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              core principle
            </div>
            <div className="mt-2 text-sm font-medium text-zinc-100">cite or kill</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">
              ≥ 2 independent sources
            </div>
          </div>
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              decision gate
            </div>
            <div className="mt-2 text-sm font-medium text-zinc-100">auto-judge</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">
              deterministic + AI escalation
            </div>
          </div>
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              trust mechanism
            </div>
            <div className="mt-2 text-sm font-medium text-zinc-100">public ledger</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">
              hit-rate inline per signal
            </div>
          </div>
          <div className="bg-zinc-950/50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              scope
            </div>
            <div className="mt-2 text-sm font-medium text-zinc-100">tech / startups / finance</div>
            <div className="mt-1 font-mono text-[10px] text-zinc-600">global + 7 regions</div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-14" aria-labelledby="faq-heading">
        <h2
          id="faq-heading"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          frequently asked
        </h2>
        <div className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
          {HOMEPAGE_FAQ.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="cursor-pointer text-base font-medium tracking-tight text-zinc-100 hover:text-[var(--color-accent)]">
                {item.question}
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer links */}
      <footer className="mt-16 border-t border-zinc-800 pt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
          explore
        </h2>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-zinc-500">
          <li>
            <Link href="/brief" className="hover:text-[var(--color-accent)]">
              daily brief
            </Link>
          </li>
          <li>
            <Link href="/signals" className="hover:text-[var(--color-accent)]">
              all signals
            </Link>
          </li>
          <li>
            <Link href="/signals/today" className="hover:text-[var(--color-accent)]">
              today
            </Link>
          </li>
          <li>
            <Link href="/track-record" className="hover:text-[var(--color-accent)]">
              track record
            </Link>
          </li>
          <li>
            <Link href="/data" className="hover:text-[var(--color-accent)]">
              dataset
            </Link>
          </li>
          <li>
            <Link href="/methodology" className="hover:text-[var(--color-accent)]">
              methodology
            </Link>
          </li>
          <li>
            <Link href="/markets" className="hover:text-[var(--color-accent)]">
              markets
            </Link>
          </li>
          <li>
            <Link href="/communities" className="hover:text-[var(--color-accent)]">
              communities
            </Link>
          </li>
          <li>
            <Link href="/about" className="hover:text-[var(--color-accent)]">
              about
            </Link>
          </li>
          <li>
            <Link href="/digest/rss" className="hover:text-[var(--color-accent)]">
              rss
            </Link>
          </li>
        </ul>
      </footer>
    </main>
  );
}
