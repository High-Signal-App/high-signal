import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { isBackfillSignal, signalHeadline, signalSummary } from "@/lib/signal-format";
import { DirectionPill } from "@/components/atoms/DirectionPill";
import { ConfidenceBadge } from "@/components/atoms/ConfidenceBadge";

export const dynamic = "force-dynamic";

function deriveHeadline(bodyMd: string): string {
  return signalHeadline(bodyMd, "signal");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { signal } = await api.signal(slug);
    const headline = deriveHeadline(signal.bodyMd ?? "");
    const description = `${signal.direction.toUpperCase()} · ${signal.confidence} confidence · ${signal.signalType.replaceAll("_", " ")}`;
    const ogImage = `/api/og?title=${encodeURIComponent(headline)}`;
    return {
      title: headline,
      description,
      openGraph: {
        title: headline,
        description,
        type: "article",
        images: [{ url: ogImage, width: 1200, height: 630, alt: headline }],
      },
      twitter: {
        card: "summary_large_image",
        title: headline,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return { title: "Signal" };
  }
}

// Public per agents.md: individual signals are part of the public web channel.
export default async function SignalDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data;
  try {
    data = await api.signal(slug);
  } catch {
    return notFound();
  }
  const { signal, evidence, scores } = data;
  if (isBackfillSignal(signal)) return notFound();
  const headline = signalHeadline(signal.bodyMd, signal.slug);
  const summary = signalSummary(signal.bodyMd, signal.slug, 720);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a
        href="/signals"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← signals
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{new Date(signal.publishedAt).toISOString().slice(0, 10)}</span>
            <span className="text-zinc-700">·</span>
            <a
              href={`/entities/${signal.primaryEntityId}`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {signal.primaryEntityId}
            </a>
            <span className="text-zinc-700">·</span>
            <span>{signal.signalType.replaceAll("_", " ")}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ConfidenceBadge confidence={signal.confidence} />
            <DirectionPill direction={signal.direction} />
          </div>
        </div>
        <h1 className="mt-5 max-w-3xl text-3xl font-medium leading-tight tracking-tight">{headline}</h1>
        {summary && <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">{summary}</p>}
        <div className="mt-6 flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <span>
            window <span className="nums text-zinc-300">{signal.predictedWindowDays}d</span>
          </span>
          <span>
            evidence <span className="nums text-zinc-300">{evidence.length}</span>
          </span>
        </div>
      </header>

      <section className="mt-12 border-t border-zinc-800 pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">evidence</h2>
        <ul className="mt-4 space-y-2">
          {evidence.map((e) => (
            <li key={e.id} className="border-b border-zinc-900 py-2">
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-zinc-200 underline-offset-4 hover:underline"
              >
                {e.url}
              </a>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {e.sourceType}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {signal.spilloverEntityIds.length > 0 && (
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            spillover entities
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {signal.spilloverEntityIds.map((eid) => (
              <a
                key={eid}
                href={`/entities/${eid}`}
                className="border border-zinc-800 px-2 py-1 font-mono text-xs hover:border-zinc-600 hover:text-white"
              >
                {eid}
              </a>
            ))}
          </div>
        </section>
      )}

      {scores.length > 0 && (
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            score history
          </h2>
          <table className="mt-4 w-full text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="border-b border-zinc-800 py-2 text-left">window</th>
                <th className="border-b border-zinc-800 py-2 text-left">return</th>
                <th className="border-b border-zinc-800 py-2 text-left">outcome</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id}>
                  <td className="nums border-b border-zinc-900 py-2">{s.windowDays}d</td>
                  <td className="nums border-b border-zinc-900 py-2">
                    {s.forwardReturn != null ? `${s.forwardReturn.toFixed(2)}%` : "—"}
                  </td>
                  <td className="border-b border-zinc-900 py-2">
                    <span
                      className={
                        s.outcome === "hit"
                          ? "text-emerald-400"
                          : s.outcome === "miss"
                            ? "text-rose-400"
                            : "text-zinc-400"
                      }
                    >
                      {s.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
