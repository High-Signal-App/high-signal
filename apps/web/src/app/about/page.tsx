import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description:
    'High Signal extracts actionable signals from public information streams. Evidence-first, hit-rate-tracked, no retroactive edits.',
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">About</h1>
      <p className="mt-4 text-sm leading-6 text-zinc-400">
        High Signal extracts actionable signals from noisy public and semi-public information
        streams — SEC filings, news, IR pages, community chatter, GitHub releases — and predicts
        second-order impact through entity graphs.
      </p>

      <section className="mt-10 space-y-3 text-sm leading-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Quality gates
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-zinc-300 marker:text-zinc-600">
          <li>Every published signal cites at least two sources.</li>
          <li>Direction (up / down / neutral) and confidence band must be set.</li>
          <li>Corrections are new signals citing the prior — no retroactive edits.</li>
          <li>
            Spillover edges are flagged <em>unverified</em> until reviewed.
          </li>
          <li>Per-source hit-rate is logged; underperformers get culled.</li>
        </ul>
      </section>

      <section className="mt-10 space-y-3 text-sm leading-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Channels</h2>
        <ul className="list-disc space-y-1 pl-5 text-zinc-300 marker:text-zinc-600">
          <li>
            <Link className="text-[var(--color-accent)] hover:underline" href="/signals">
              /signals
            </Link>{' '}
            — full feed, filterable by direction, confidence, and entity.
          </li>
          <li>
            <Link className="text-[var(--color-accent)] hover:underline" href="/digest">
              /digest
            </Link>{' '}
            — last 7 days of signals, designed to be email-shaped.
          </li>
          <li>
            RSS:{' '}
            <Link className="text-[var(--color-accent)] hover:underline" href="/signals/rss">
              /signals/rss
            </Link>{' '}
            ·{' '}
            <Link className="text-[var(--color-accent)] hover:underline" href="/digest/rss">
              /digest/rss
            </Link>
          </li>
          <li>
            Surprise me:{' '}
            <Link className="text-[var(--color-accent)] hover:underline" href="/signals/random">
              /signals/random
            </Link>
          </li>
          <li>
            Case studies:{' '}
            <Link
              className="text-[var(--color-accent)] hover:underline"
              href={'/case-studies' as Route}
            >
              /case-studies
            </Link>{' '}
            — source-constrained product intelligence examples.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3 text-sm leading-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Out of scope (on purpose)
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-zinc-300 marker:text-zinc-600">
          <li>Multi-wedge expansion before hit-rate is real.</li>
          <li>Agent UI / chat-over-docs — that space is saturated.</li>
          <li>Licensed datasets — premature.</li>
          <li>Vector retrieval — defer until evidence search is the bottleneck.</li>
        </ul>
      </section>
    </main>
  );
}
