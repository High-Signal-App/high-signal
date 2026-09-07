import { notFound } from 'next/navigation';

import { ConfidenceBadge } from '@/components/atoms/ConfidenceBadge';
import { DirectionPill } from '@/components/atoms/DirectionPill';
import { api } from '@/lib/api';
import { signalPresentation } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

/**
 * /embed/[slug] — chromeless single-signal card designed to be iframed
 * into blogs, dashboards, or Substack posts. No nav, no footer.
 */
export default async function EmbedSignal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof api.signal>>;
  try {
    data = await api.signal(slug);
  } catch {
    return notFound();
  }
  const { signal } = data;
  const { headline, summary, sample } = signalPresentation(signal);

  return (
    <main className="bg-zinc-950 p-4 text-zinc-300">
      <article className="rounded-md border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{new Date(signal.publishedAt).toISOString().slice(0, 10)}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[var(--color-accent)]">{signal.primaryEntityId}</span>
            <span className="text-zinc-700">·</span>
            <span>{sample ? 'review sample' : signal.signalType.replaceAll('_', ' ')}</span>
          </div>
          <div className="flex items-center gap-2">
            {sample ? (
              <span className="text-sm text-amber-300">Trend not established</span>
            ) : (
              <>
                <ConfidenceBadge confidence={signal.confidence} />
                <DirectionPill direction={signal.direction} />
              </>
            )}
          </div>
        </div>
        <h3 className="mt-3 text-base font-medium text-zinc-100">{headline}</h3>
        {sample && <p className="mt-3 text-sm text-zinc-400">{summary}</p>}
        <div className="mt-3 flex items-center gap-4 font-mono text-[10px] text-zinc-500">
          {!sample && (
            <span>
              window <span className="nums text-zinc-300">{signal.predictedWindowDays}d</span>
            </span>
          )}
          <span>
            evidence <span className="nums text-zinc-300">{signal.evidenceUrls.length}</span>
          </span>
          <a
            href={`/signals/${signal.slug}`}
            target="_top"
            className="ml-auto text-[var(--color-accent)] hover:underline"
          >
            read on high signal →
          </a>
        </div>
      </article>
    </main>
  );
}
