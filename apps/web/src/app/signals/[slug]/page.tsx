import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { isBackfillSignal, signalHeadline, signalSummary } from '@/lib/signal-format';
import { pricedInContext, pricedInTone } from '@/lib/price-context';
import { DirectionPill } from '@/components/atoms/DirectionPill';
import { ConfidenceBadge } from '@/components/atoms/ConfidenceBadge';
import { MarkdownView } from '@/components/system/MarkdownView';
import { SignalArticleJsonLd } from '@/components/seo/structured-data';
import catalog from '@/lib/source-catalog.json';

export const dynamic = 'force-dynamic';

function deriveHeadline(bodyMd: string): string {
  return signalHeadline(bodyMd, 'signal');
}

function markdownWithoutFirstHeading(markdown: string) {
  return markdown.replace(/^\s*#\s+.+\n+/, '').trim();
}

function confidenceCopy(score: number | undefined, independentSources: number | undefined) {
  if (typeof score !== 'number') return 'Confidence is based on cited evidence and source quality.';
  const sources = independentSources ?? 0;
  if (score >= 85)
    return `Strong evidence: ${sources} independent source class${sources === 1 ? '' : 'es'} support this read.`;
  if (score >= 65)
    return `Usable evidence: enough corroboration to publish, with ${sources} independent source class${sources === 1 ? '' : 'es'}.`;
  if (score >= 45) return 'Watch item: useful signal, but still thin or early.';
  return 'Draft-grade evidence: keep this out of the public feed unless corroboration improves.';
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const CATALOG_SOURCE_IDS = new Set(
  (catalog.sources as Array<{ id: string }>).map((source) => source.id)
);

function sourceFamily(sourceType: string) {
  const raw = sourceType.toLowerCase();
  if (raw.startsWith('china-news:') || raw.startsWith('news:china-news-')) return 'china-news';
  if (raw.startsWith('scmp:') || raw.startsWith('news:scmp-')) return 'scmp';
  if (raw === 'market') return 'markets';
  if (raw === 'package' || raw === 'osv') return 'packages';
  if (raw === 'regulations-gov') return 'regulations';
  const first = raw.split(':', 1)[0] ?? raw;
  if (CATALOG_SOURCE_IDS.has(first)) return first;
  return CATALOG_SOURCE_IDS.has(raw) ? raw : null;
}

function evidenceDay(value: number | string | null | undefined) {
  if (value == null) return null;
  const date =
    typeof value === 'number'
      ? new Date(value > 1_000_000_000_000 ? value : value * 1000)
      : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function evidenceDataHref(sourceType: string, publishedAt: number | string | null | undefined) {
  const source = sourceFamily(sourceType);
  const day = evidenceDay(publishedAt);
  if (!source || !day) return null;
  return `/data/${encodeURIComponent(source)}?date=${day}` as Route;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { signal } = await api.signal(slug);
    const headline = deriveHeadline(signal.bodyMd ?? '');
    const description = `${signal.direction.toUpperCase()} · ${signal.confidence} confidence · ${signal.signalType.replaceAll('_', ' ')}`;
    const ogImage = `/api/og?title=${encodeURIComponent(headline)}`;
    return {
      title: headline,
      description,
      openGraph: {
        title: headline,
        description,
        type: 'article',
        images: [{ url: ogImage, width: 1200, height: 630, alt: headline }],
      },
      twitter: {
        card: 'summary_large_image',
        title: headline,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return { title: 'Signal' };
  }
}

// Public per agents.md: individual signals are part of the public web channel.
export default async function SignalDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof api.signal>>;
  try {
    data = await api.signal(slug);
  } catch {
    return notFound();
  }
  const { signal, evidence, scores } = data;
  if (isBackfillSignal(signal)) return notFound();
  // Public detail surface should only render published signals.
  // Drafts, killed, and corrected rows 404 — they live in /review for
  // operators with admin access.
  if (signal.reviewStatus !== 'published') return notFound();
  let claims: Awaited<ReturnType<typeof api.claimsBySignal>>['claims'] = [];
  try {
    const c = await api.claimsBySignal(slug);
    claims = c.claims;
  } catch {
    // Claims surface is additive; a fetch failure should not 404 the signal.
  }
  const headline = signalHeadline(signal.bodyMd, signal.slug);
  const summary = signalSummary(signal.bodyMd, signal.slug, 720);
  const price = pricedInContext(signal.primaryEntityId, signal.direction);
  const bodyMarkdown = markdownWithoutFirstHeading(signal.bodyMd);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <SignalArticleJsonLd
        headline={headline}
        slug={signal.slug}
        publishedAt={new Date(signal.publishedAt).toISOString()}
        bodyMd={signal.bodyMd}
        entityName={signal.primaryEntityId}
        evidenceUrls={signal.evidenceUrls}
        direction={signal.direction}
        confidence={signal.confidence}
        predictedWindowDays={signal.predictedWindowDays}
        signalType={signal.signalType}
      />
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
            <span>{signal.signalType.replaceAll('_', ' ')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ConfidenceBadge confidence={signal.confidence} />
            <DirectionPill direction={signal.direction} />
          </div>
        </div>
        <h1 className="mt-5 max-w-3xl text-3xl font-medium leading-tight tracking-tight">
          {headline}
        </h1>
        {summary && <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">{summary}</p>}
        <div className="mt-6 flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <span>
            window <span className="nums text-zinc-300">{signal.predictedWindowDays}d</span>
          </span>
          <span>
            evidence <span className="nums text-zinc-300">{evidence.length}</span>
          </span>
          {typeof signal.qualityScore === 'number' && (
            <span>
              confidence score <span className="nums text-zinc-300">{signal.qualityScore}</span>
            </span>
          )}
          {price.price ? (
            <span>
              price{' '}
              <span className="nums text-zinc-300">
                {price.price.ticker} ${price.price.currentPrice.toFixed(2)}
              </span>
            </span>
          ) : null}
        </div>
      </header>

      <section className="mt-8 border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              confidence score
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
              {confidenceCopy(signal.qualityScore, signal.independentSourceCount)}
            </p>
          </div>
          {typeof signal.qualityScore === 'number' && (
            <div className="nums shrink-0 text-4xl font-medium text-zinc-100">
              {signal.qualityScore}
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <span>{signal.confidence} confidence</span>
          {typeof signal.independentSourceCount === 'number' && (
            <span>{signal.independentSourceCount} independent source classes</span>
          )}
          {signal.sourceClasses?.map((sourceClass) => (
            <span key={sourceClass}>{sourceClass}</span>
          ))}
          {signal.qualityReasons?.map((reason) => (
            <span key={reason}>{reason.replaceAll('_', ' ')}</span>
          ))}
        </div>
      </section>

      {price.status !== 'unknown' ? (
        <section className="mt-8 border-y border-zinc-800 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                priced-in check
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{price.reason}</p>
            </div>
            <span
              className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${pricedInTone(price.status)}`}
            >
              {price.label}
            </span>
          </div>
          {price.price ? (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              <span>
                as of <span className="nums text-zinc-300">{price.price.asOf}</span>
              </span>
              <span>
                7d{' '}
                <span className="nums text-zinc-300">
                  {price.price.move7d === null
                    ? 'n/a'
                    : `${price.price.move7d >= 0 ? '+' : ''}${price.price.move7d.toFixed(0)}%`}
                </span>
              </span>
              <span>
                45d{' '}
                <span className="nums text-zinc-300">
                  {price.price.move45d === null
                    ? 'n/a'
                    : `${price.price.move45d >= 0 ? '+' : ''}${price.price.move45d.toFixed(0)}%`}
                </span>
              </span>
              <span>
                90d{' '}
                <span className="nums text-zinc-300">
                  {price.price.move90d === null
                    ? 'n/a'
                    : `${price.price.move90d >= 0 ? '+' : ''}${price.price.move90d.toFixed(0)}%`}
                </span>
              </span>
              <a
                className="text-[var(--color-accent)] hover:underline"
                href={price.price.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                yahoo
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      {bodyMarkdown ? (
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            signal brief
          </h2>
          <div className="mt-5">
            <MarkdownView markdown={bodyMarkdown} />
          </div>
        </section>
      ) : null}

      {claims.length > 0 && (
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            provenance
          </h2>
          <ul className="mt-4 space-y-3">
            {claims
              .filter(
                (claim) => claim.reviewStatus === 'published' || claim.reviewStatus === 'corrected'
              )
              .map((claim) => (
                <li key={claim.id} className="border border-zinc-900 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    <span>
                      claim · v{claim.version} ·{' '}
                      <span
                        className={
                          claim.reviewStatus === 'published' ? 'text-emerald-400' : 'text-zinc-400'
                        }
                      >
                        {claim.reviewStatus}
                      </span>
                    </span>
                    <span className="text-zinc-500">
                      P{claim.rollup.primary} · C{claim.rollup.corroboration}
                      {claim.rollup.contradiction > 0 ? (
                        <span className="text-amber-400"> · X{claim.rollup.contradiction}</span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-200">{claim.assertion}</p>
                  {claim.evidence.length > 0 && (
                    <ul className="mt-2 space-y-1 font-mono text-[10px]">
                      {claim.evidence.map((link) => (
                        <li key={link.id} className="flex items-center gap-2">
                          <span
                            className={`border px-1.5 py-0.5 uppercase tracking-[0.18em] ${
                              link.role === 'primary'
                                ? 'border-emerald-500/40 text-emerald-300'
                                : link.role === 'corroboration'
                                  ? 'border-cyan-500/40 text-cyan-300'
                                  : link.role === 'contradiction'
                                    ? 'border-amber-500/40 text-amber-300'
                                    : 'border-zinc-800 text-zinc-500'
                            }`}
                          >
                            {link.role}
                          </span>
                          <a
                            href={link.evidenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 truncate text-zinc-400 hover:text-zinc-200 hover:underline"
                          >
                            {link.evidenceUrl}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="mt-12 border-t border-zinc-800 pt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          source data used
        </h2>
        <ul className="mt-4 space-y-3">
          {evidence.map((e) => {
            const dataHref = evidenceDataHref(e.sourceType, e.publishedAt);
            const day = evidenceDay(e.publishedAt);
            return (
              <li key={e.id} className="border border-zinc-900 p-3">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  <span>{e.sourceType}</span>
                  {day ? (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span>{day}</span>
                    </>
                  ) : null}
                  <span className="text-zinc-700">·</span>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-zinc-300 underline-offset-4 hover:underline"
                  >
                    {hostLabel(e.url)}
                  </a>
                  {dataHref ? (
                    <>
                      <span className="text-zinc-700">·</span>
                      <a
                        href={dataHref}
                        className="text-[var(--color-accent)] underline-offset-4 hover:underline"
                      >
                        source day
                      </a>
                    </>
                  ) : null}
                </div>
                {e.excerpt ? (
                  <blockquote className="mt-3 border-l-2 border-zinc-700 pl-3 text-sm leading-6 text-zinc-300">
                    “{e.excerpt}”
                  </blockquote>
                ) : (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block truncate text-sm text-zinc-400 underline-offset-4 hover:underline"
                  >
                    {e.url}
                  </a>
                )}
              </li>
            );
          })}
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

      <p className="mt-10 border-l-2 border-zinc-800 pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        Decision support, not stock advice. This signal is research with cited evidence — not a
        recommendation to buy, sell, or hold any security.
      </p>

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
                    {s.forwardReturn != null ? `${s.forwardReturn.toFixed(2)}%` : '—'}
                  </td>
                  <td className="border-b border-zinc-900 py-2">
                    <span
                      className={
                        s.outcome === 'hit'
                          ? 'text-emerald-400'
                          : s.outcome === 'miss'
                            ? 'text-rose-400'
                            : 'text-zinc-400'
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
