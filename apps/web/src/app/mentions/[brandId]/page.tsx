import Link from 'next/link';
import type { Route } from 'next';
import { api } from '@/lib/api';
import { requireSignedIn } from '@/lib/require-auth';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Brand visibility' };

type Tab = 'visibility' | 'intent' | 'sources' | 'trends' | 'report';

const TABS: Tab[] = ['visibility', 'intent', 'sources', 'trends', 'report'];

async function refreshIntent(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const brandId = `${formData.get('brandId') ?? ''}`.trim();
  const windowDays = Math.max(7, Math.min(Number(formData.get('windowDays') ?? 14), 90));
  if (!brandId) return;
  await api.refreshIntentOpportunities(ownerId, brandId, windowDays);
  revalidatePath(`/mentions/${brandId}`);
}

async function updateIntentStatus(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const brandId = `${formData.get('brandId') ?? ''}`.trim();
  const opportunityId = `${formData.get('opportunityId') ?? ''}`.trim();
  const status = `${formData.get('status') ?? ''}`.trim();
  if (
    !brandId ||
    !opportunityId ||
    (status !== 'open' && status !== 'dismissed' && status !== 'done')
  ) {
    return;
  }
  await api.updateIntentOpportunity(ownerId, brandId, opportunityId, status);
  revalidatePath(`/mentions/${brandId}`);
}

async function generateIntentReplyDraft(formData: FormData) {
  'use server';
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const brandId = `${formData.get('brandId') ?? ''}`.trim();
  const opportunityId = `${formData.get('opportunityId') ?? ''}`.trim();
  if (!brandId || !opportunityId) return;
  try {
    await api.generateIntentReplyDraft(ownerId, brandId, opportunityId);
  } catch {
    // AI keys are optional; the inbox still works without reply drafts.
  }
  revalidatePath(`/mentions/${brandId}`);
}

export default async function BrandVisibilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ tab?: Tab; window?: string }>;
}) {
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const { brandId } = await params;
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'visibility';
  const windowDays = Math.max(7, Math.min(Number(sp.window ?? 30), 365));

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/mentions"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← mentions
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Brand visibility</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Multi-engine matrix, cited-source intelligence, trend lines, and a report-ready view.
        </p>
      </header>

      <div className="mt-6 flex gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/mentions/${encodeURIComponent(brandId)}?tab=${t}&window=${windowDays}` as Route}
            className={`border px-3 py-1 ${
              t === tab
                ? 'border-[var(--color-accent)] bg-white/[0.04] text-white'
                : 'border-zinc-800 text-zinc-400 hover:bg-white/[0.02]'
            }`}
          >
            {t}
          </Link>
        ))}
        <span className="ml-auto font-mono text-[10px] text-zinc-500">window: {windowDays}d</span>
      </div>

      <div className="mt-8">
        {tab === 'visibility' && (
          <VisibilityTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
        {tab === 'intent' && (
          <IntentTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
        {tab === 'sources' && <SourcesTab ownerId={ownerId} brandId={brandId} />}
        {tab === 'trends' && (
          <TrendsTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
        {tab === 'report' && (
          <ReportTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
      </div>
    </main>
  );
}

async function VisibilityTab({
  ownerId,
  brandId,
  windowDays,
}: {
  ownerId: string;
  brandId: string;
  windowDays: number;
}) {
  let cells: Awaited<ReturnType<typeof api.visibilityMatrix>>['cells'] = [];
  let runs = 0;
  try {
    const r = await api.visibilityMatrix(ownerId, brandId, windowDays);
    cells = r.cells;
    runs = r.runs;
  } catch {
    return <EmptyState text="no data — connect a brand or run a check first" />;
  }
  if (cells.length === 0) return <EmptyState text={`no runs in the last ${windowDays}d`} />;

  return (
    <section>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {runs} run(s) collapsed to {cells.length} cell(s)
      </div>
      <table className="mt-4 w-full text-xs">
        <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <tr>
            <th className="border-b border-zinc-800 py-2 text-left">prompt</th>
            <th className="border-b border-zinc-800 py-2 text-left">platform</th>
            <th className="border-b border-zinc-800 py-2 text-left">brand</th>
            <th className="border-b border-zinc-800 py-2 text-left">competitors</th>
            <th className="border-b border-zinc-800 py-2 text-right">citations</th>
            <th className="border-b border-zinc-800 py-2 text-right">run at</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={`${c.prompt}-${c.platform}`}>
              <td className="border-b border-zinc-900 py-2 text-zinc-200">{c.prompt}</td>
              <td className="border-b border-zinc-900 py-2 text-zinc-300">{c.platform}</td>
              <td className="border-b border-zinc-900 py-2">
                <span className={c.brandMentioned ? 'text-emerald-400' : 'text-zinc-500'}>
                  {c.brandMentioned ? 'mentioned' : '—'}
                </span>
              </td>
              <td className="border-b border-zinc-900 py-2 text-zinc-400">
                {c.competitors.slice(0, 3).join(', ') || '—'}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {c.citationsCount}
              </td>
              <td className="border-b border-zinc-900 py-2 text-right font-mono text-[10px] text-zinc-500">
                {new Date(c.runAt).toISOString().slice(0, 16).replace('T', ' ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function IntentTab({
  ownerId,
  brandId,
  windowDays,
}: {
  ownerId: string;
  brandId: string;
  windowDays: number;
}) {
  let opportunities: Awaited<ReturnType<typeof api.intentOpportunities>>['opportunities'] = [];
  try {
    const r = await api.intentOpportunities(ownerId, brandId, { limit: 40 });
    opportunities = r.opportunities;
  } catch {
    return <EmptyState text="intent inbox unavailable — apply migration 0014 first" />;
  }

  return (
    <section>
      <div className="flex flex-col gap-3 border border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            buyer intent inbox
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Scored community and developer-source items where buyers compare, complain, ask for
            proof, or show purchase intent. These are operator-reviewed actions, not auto-posts.
          </p>
        </div>
        <form action={refreshIntent}>
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="windowDays" value={Math.min(windowDays, 90)} />
          <button
            type="submit"
            className="border border-[var(--color-accent)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:bg-white/[0.04]"
          >
            refresh
          </button>
        </form>
      </div>

      {opportunities.length === 0 ? (
        <div className="mt-6">
          <EmptyState text="no open intent items yet — refresh after ingest has community events" />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {opportunities.map((item) => (
            <li key={item.id} className="border border-zinc-800 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                    <span className="border border-zinc-700 px-1.5 py-0.5 text-zinc-400">
                      {item.source}
                    </span>
                    <span className="border border-cyan-500/40 px-1.5 py-0.5 text-cyan-300">
                      {item.intentStage}
                    </span>
                    <span className="border border-zinc-700 px-1.5 py-0.5 text-zinc-400">
                      {item.actionType.replaceAll('_', ' ')}
                    </span>
                    <span className="nums text-zinc-500">{item.score}</span>
                  </div>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block truncate text-sm font-medium text-zinc-100 hover:text-[var(--color-accent)]"
                  >
                    {item.sourceTitle}
                  </a>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">
                    {item.sourceExcerpt}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    {item.competitors.length > 0 && (
                      <span>competitors: {item.competitors.slice(0, 3).join(', ')}</span>
                    )}
                    {item.matchedKeywords.length > 0 && (
                      <span>matched: {item.matchedKeywords.slice(0, 4).join(', ')}</span>
                    )}
                    {item.evidenceTaskId && <span>evidence task linked</span>}
                    <span>{new Date(item.foundAt).toISOString().slice(0, 10)}</span>
                  </div>
                  {item.replyDraft && (
                    <div className="mt-4 border border-zinc-800 bg-zinc-950/40 p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        operator-reviewed reply draft
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                        {item.replyDraft}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!item.replyDraft && (
                    <form action={generateIntentReplyDraft}>
                      <input type="hidden" name="brandId" value={brandId} />
                      <input type="hidden" name="opportunityId" value={item.id} />
                      <button
                        type="submit"
                        className="border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-cyan-400 hover:text-cyan-300"
                      >
                        draft
                      </button>
                    </form>
                  )}
                  <form action={updateIntentStatus}>
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="opportunityId" value={item.id} />
                    <input type="hidden" name="status" value="done" />
                    <button
                      type="submit"
                      className="border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-emerald-400 hover:text-emerald-300"
                    >
                      done
                    </button>
                  </form>
                  <form action={updateIntentStatus}>
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="opportunityId" value={item.id} />
                    <input type="hidden" name="status" value="dismissed" />
                    <button
                      type="submit"
                      className="border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:border-rose-400 hover:text-rose-300"
                    >
                      dismiss
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function SourcesTab({ ownerId, brandId }: { ownerId: string; brandId: string }) {
  let sources: Awaited<ReturnType<typeof api.citedSources>>['sources'] = [];
  try {
    const r = await api.citedSources(ownerId, brandId);
    sources = r.sources;
  } catch {
    return (
      <EmptyState text="no cited-sources index yet — POST /products/mentions/<id>/cited-sources/refresh" />
    );
  }
  if (sources.length === 0) {
    return <EmptyState text="no cited URLs indexed yet — refresh after the next mention check" />;
  }
  return (
    <section>
      <ul className="space-y-1 font-mono text-[11px]">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center gap-2 border-b border-zinc-900 py-2">
            <span
              className={`border px-1.5 py-0.5 uppercase tracking-[0.18em] ${
                s.ownership === 'owned'
                  ? 'border-emerald-500/40 text-emerald-300'
                  : s.ownership === 'competitor'
                    ? 'border-amber-500/40 text-amber-300'
                    : 'border-zinc-700 text-zinc-400'
              }`}
            >
              {s.ownership}
            </span>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 truncate text-zinc-300 hover:underline"
            >
              {s.url}
            </a>
            <span className="nums shrink-0 text-zinc-500">{s.mentionRunCount}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function TrendsTab({
  ownerId,
  brandId,
  windowDays,
}: {
  ownerId: string;
  brandId: string;
  windowDays: number;
}) {
  let points: Awaited<ReturnType<typeof api.mentionTrends>>['points'] = [];
  try {
    const r = await api.mentionTrends(ownerId, brandId, windowDays);
    points = r.points;
  } catch {
    return <EmptyState text="no trend data" />;
  }
  if (points.length === 0) return <EmptyState text="no points in window" />;

  const latest = points[points.length - 1]!;
  const earliest = points[0]!;
  const delta = latest.mentionRate - earliest.mentionRate;

  return (
    <section>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="latest mention rate" value={pct(latest.mentionRate)} />
        <Tile label="delta vs first" value={`${delta >= 0 ? '+' : ''}${pct(delta)}`} />
        <Tile label="latest cited hosts" value={String(latest.citedHosts)} />
        <Tile label="points" value={String(points.length)} />
      </div>
      <table className="mt-6 w-full text-xs">
        <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <tr>
            <th className="border-b border-zinc-800 py-2 text-left">date</th>
            <th className="border-b border-zinc-800 py-2 text-right">runs</th>
            <th className="border-b border-zinc-800 py-2 text-right">mention</th>
            <th className="border-b border-zinc-800 py-2 text-right">rec</th>
            <th className="border-b border-zinc-800 py-2 text-right">hosts</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td className="border-b border-zinc-900 py-2 text-zinc-300">{p.date}</td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {p.runs}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {pct(p.mentionRate)}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {pct(p.recommendationRate)}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {p.citedHosts}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function ReportTab({
  ownerId,
  brandId,
  windowDays,
}: {
  ownerId: string;
  brandId: string;
  windowDays: number;
}) {
  let report: Awaited<ReturnType<typeof api.mentionReport>>;
  try {
    report = await api.mentionReport(ownerId, brandId, windowDays);
  } catch {
    return <EmptyState text="no report data" />;
  }
  const r = report.report;
  return (
    <section className="space-y-8">
      {r ? (
        <AiVisibilityReportView report={r} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile label="runs" value={String(report.summary.runs)} />
          <Tile label="mention rate" value={pct(report.summary.brandMentionRate)} />
          <Tile label="citation rate" value={pct(report.summary.brandCitationRate)} />
          <Tile label="trend points" value={String(report.summary.trendPoints)} />
        </div>
      )}

      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          competitor share
        </h2>
        <ul className="mt-3 space-y-1 font-mono text-[11px]">
          {Object.entries(report.shareOfVoice.competitorShare)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([k, v]) => (
              <li
                key={k}
                className="flex items-center justify-between border-b border-zinc-900 py-1"
              >
                <span className="text-zinc-300">{k}</span>
                <span className="nums text-zinc-500">{pct(v)}</span>
              </li>
            ))}
          {Object.keys(report.shareOfVoice.competitorShare).length === 0 && (
            <li className="text-zinc-500">no competitor mentions in window</li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          top cited sources
        </h2>
        <ul className="mt-3 space-y-1 font-mono text-[11px]">
          {report.citedSources.slice(0, 10).map((s) => (
            <li key={s.id} className="flex items-center gap-2 border-b border-zinc-900 py-1">
              <span className="text-zinc-500">{s.ownership}</span>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-zinc-300 hover:underline"
              >
                {s.url}
              </a>
              <span className="nums text-zinc-500">{s.mentionRunCount}</span>
            </li>
          ))}
          {report.citedSources.length === 0 && (
            <li className="text-zinc-500">no indexed sources yet</li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          top intent opportunities
        </h2>
        <ul className="mt-3 space-y-1 font-mono text-[11px]">
          {report.intentOpportunities.slice(0, 10).map((item) => (
            <li key={item.id} className="flex items-center gap-2 border-b border-zinc-900 py-1">
              <span className="nums w-8 text-zinc-500">{item.score}</span>
              <span className="text-zinc-500">{item.intentStage}</span>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-zinc-300 hover:underline"
              >
                {item.sourceTitle}
              </a>
            </li>
          ))}
          {report.intentOpportunities.length === 0 && (
            <li className="text-zinc-500">no intent items yet</li>
          )}
        </ul>
      </div>
    </section>
  );
}

type VisibilityReport = NonNullable<Awaited<ReturnType<typeof api.mentionReport>>['report']>;

function AiVisibilityReportView({ report }: { report: VisibilityReport }) {
  const { score } = report;
  const trendArrow =
    report.trend.direction === 'up' ? '↑' : report.trend.direction === 'down' ? '↓' : '→';
  const trendColor =
    report.trend.direction === 'up'
      ? 'text-cyan-400'
      : report.trend.direction === 'down'
        ? 'text-zinc-400'
        : 'text-zinc-500';
  return (
    <div className="space-y-8">
      {/* Score hero */}
      <div className="flex flex-col gap-6 border border-zinc-800 p-6 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <div className="nums text-6xl font-medium tabular-nums text-cyan-400">{score.score}</div>
          <div className="text-2xl text-zinc-500">/ 100</div>
          <div className="ml-2 border border-zinc-700 px-2 py-0.5 font-mono text-sm text-zinc-300">
            {score.grade}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Meter label="mentioned" value={score.components.mention} />
          <Meter label="recommended" value={score.components.recommendation} />
          <Meter label="cited" value={score.components.citation} />
          <Meter label="cross-engine" value={score.components.consistency} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-zinc-500">
        <span>
          engines:{' '}
          <span className="text-zinc-300">
            {score.platformsCovered}/{score.platformsTotal}
          </span>{' '}
          cover you
        </span>
        <span>{report.platforms.length ? report.platforms.join(' · ') : 'single endpoint'}</span>
        <span className={trendColor}>
          {trendArrow} mention {report.trend.deltaMentionRate >= 0 ? '+' : ''}
          {(report.trend.deltaMentionRate * 100).toFixed(1)} pts
        </span>
        <span>{report.generatedForRuns} answers analyzed</span>
      </div>

      {/* Recommendations */}
      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          what to fix
        </h2>
        <ul className="mt-3 space-y-2">
          {report.recommendations.map((rec) => (
            <li
              key={`${rec.area}:${rec.title}`}
              className="flex gap-3 border-l-2 border-zinc-700 pl-3"
            >
              <PriorityChip priority={rec.priority} />
              <div>
                <div className="text-sm text-zinc-200">{rec.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{rec.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Per-persona */}
      {report.perPersona.length > 0 && (
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            visibility by persona
          </h2>
          <table className="mt-3 w-full font-mono text-[11px]">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-600">
                <th className="py-1 font-normal">persona</th>
                <th className="py-1 text-right font-normal">runs</th>
                <th className="py-1 text-right font-normal">mentioned</th>
                <th className="py-1 text-right font-normal">recommended</th>
                <th className="py-1 text-right font-normal">cited</th>
              </tr>
            </thead>
            <tbody>
              {report.perPersona.map((p) => (
                <tr key={p.persona} className="border-b border-zinc-900">
                  <td className="py-1 text-zinc-300">{p.persona}</td>
                  <td className="nums py-1 text-right text-zinc-500">{p.runs}</td>
                  <td className="nums py-1 text-right text-zinc-400">{pct(p.mentionRate)}</td>
                  <td className="nums py-1 text-right text-zinc-400">
                    {pct(p.recommendationRate)}
                  </td>
                  <td className="nums py-1 text-right text-zinc-400">{pct(p.citationRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Citation gaps */}
      {report.citationGaps.length > 0 && (
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            sources AI trusts that aren&apos;t you
          </h2>
          <ul className="mt-3 space-y-1 font-mono text-[11px]">
            {report.citationGaps.slice(0, 12).map((g) => (
              <li
                key={g.host}
                className="flex items-center justify-between border-b border-zinc-900 py-1"
              >
                <span className="flex items-center gap-2">
                  <span className="text-zinc-600">
                    {g.ownership === 'competitor' ? 'competitor' : 'third-party'}
                  </span>
                  <span className="text-zinc-300">{g.host}</span>
                </span>
                <span className="nums text-zinc-500">{g.citations} cites</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {label}
        </span>
        <span className="nums text-[11px] text-zinc-300">{pct(value)}</span>
      </div>
      <div className="mt-1 h-1 w-full bg-zinc-800">
        <div className="h-1 bg-cyan-400/70" style={{ width: `${clamped * 100}%` }} />
      </div>
    </div>
  );
}

function PriorityChip({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const cls =
    priority === 'high'
      ? 'border-cyan-400/60 text-cyan-400'
      : priority === 'medium'
        ? 'border-zinc-600 text-zinc-300'
        : 'border-zinc-800 text-zinc-500';
  return (
    <span
      className={`mt-0.5 h-fit shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${cls}`}
    >
      {priority}
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-800 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 nums text-2xl text-zinc-100">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
      {text}
    </div>
  );
}

function pct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}
