import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConfidenceBadge } from '@/components/atoms/ConfidenceBadge';
import { DirectionPill } from '@/components/atoms/DirectionPill';
import { MarkdownView } from '@/components/system/MarkdownView';
import { api } from '@/lib/api';
import { isBackfillSignal, signalHeadline, signalSummary } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Featured signal',
  description: 'One high-confidence signal surfaced fresh on every load.',
};

/**
 * /featured — picks a HIGH-confidence signal from the most recent batch
 * and renders it on its own. Designed as a landing widget / share link.
 */
export default async function FeaturedPage() {
  let candidates: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  try {
    const r = await api.signals();
    candidates = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* offline */
  }

  // Prefer high-confidence; fall back to any.
  const pool = candidates.filter((s) => s.confidence === 'high');
  const sorted = (pool.length > 0 ? pool : candidates).slice(0, 12);
  if (sorted.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-300">
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
        >
          ← high signal
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">Featured signal</h1>
        <p className="mt-4 text-sm text-zinc-400">
          No signals available yet. Check{' '}
          <Link href="/signals" className="underline">
            /signals
          </Link>
          .
        </p>
      </main>
    );
  }

  const pick = sorted[Math.floor(Math.random() * sorted.length)]!;
  let detail: Awaited<ReturnType<typeof api.signal>>;
  try {
    detail = await api.signal(pick.slug);
  } catch {
    notFound();
  }
  const { signal, evidence } = detail;
  if (isBackfillSignal(signal)) notFound();
  const headline = signalHeadline(signal.bodyMd, signal.slug);
  const body = signalSummary(signal.bodyMd, signal.slug, 720);
  const bodyMarkdown = signal.bodyMd.replace(/^\s*#\s+.+\n+/, '').trim();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        featured signal
      </p>
      <article className="mt-4 border-t border-zinc-800 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{new Date(signal.publishedAt).toISOString().slice(0, 10)}</span>
            <span className="text-zinc-700">·</span>
            <Link
              href={`/entities/${signal.primaryEntityId}`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {signal.primaryEntityId}
            </Link>
            <span className="text-zinc-700">·</span>
            <span>{signal.signalType.replaceAll('_', ' ')}</span>
          </div>
          <div className="flex items-center gap-2">
            <ConfidenceBadge confidence={signal.confidence} />
            <DirectionPill direction={signal.direction} />
          </div>
        </div>
        <h1 className="mt-4 text-3xl font-medium tracking-tight text-white">{headline}</h1>
        <div className="mt-5">
          {bodyMarkdown ? <MarkdownView markdown={bodyMarkdown} /> : <p>{body || '(no body)'}</p>}
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          window {signal.predictedWindowDays}d · evidence {evidence.length}
        </p>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link
            href={`/signals/${signal.slug}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            permalink →
          </Link>
          <Link href="/signals/rss" className="text-zinc-400 hover:underline">
            subscribe (RSS)
          </Link>
        </div>
      </article>
    </main>
  );
}
