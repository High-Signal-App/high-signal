import Link from "next/link";
import type { Route } from "next";
import { api } from "@/lib/api";
import { requireSignedIn } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brand visibility — High Signal" };

type Tab = "visibility" | "sources" | "trends" | "report";

const TABS: Tab[] = ["visibility", "sources", "trends", "report"];

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
  const tab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "visibility";
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
                ? "border-[var(--color-accent)] bg-white/[0.04] text-white"
                : "border-zinc-800 text-zinc-400 hover:bg-white/[0.02]"
            }`}
          >
            {t}
          </Link>
        ))}
        <span className="ml-auto font-mono text-[10px] text-zinc-500">window: {windowDays}d</span>
      </div>

      <div className="mt-8">
        {tab === "visibility" && (
          <VisibilityTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
        {tab === "sources" && <SourcesTab ownerId={ownerId} brandId={brandId} />}
        {tab === "trends" && (
          <TrendsTab ownerId={ownerId} brandId={brandId} windowDays={windowDays} />
        )}
        {tab === "report" && (
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
  let cells: Awaited<ReturnType<typeof api.visibilityMatrix>>["cells"] = [];
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
          {cells.map((c, i) => (
            <tr key={i}>
              <td className="border-b border-zinc-900 py-2 text-zinc-200">{c.prompt}</td>
              <td className="border-b border-zinc-900 py-2 text-zinc-300">{c.platform}</td>
              <td className="border-b border-zinc-900 py-2">
                <span className={c.brandMentioned ? "text-emerald-400" : "text-zinc-500"}>
                  {c.brandMentioned ? "mentioned" : "—"}
                </span>
              </td>
              <td className="border-b border-zinc-900 py-2 text-zinc-400">
                {c.competitors.slice(0, 3).join(", ") || "—"}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">{c.citationsCount}</td>
              <td className="border-b border-zinc-900 py-2 text-right font-mono text-[10px] text-zinc-500">
                {new Date(c.runAt).toISOString().slice(0, 16).replace("T", " ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function SourcesTab({ ownerId, brandId }: { ownerId: string; brandId: string }) {
  let sources: Awaited<ReturnType<typeof api.citedSources>>["sources"] = [];
  try {
    const r = await api.citedSources(ownerId, brandId);
    sources = r.sources;
  } catch {
    return <EmptyState text="no cited-sources index yet — POST /products/mentions/<id>/cited-sources/refresh" />;
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
                s.ownership === "owned"
                  ? "border-emerald-500/40 text-emerald-300"
                  : s.ownership === "competitor"
                    ? "border-amber-500/40 text-amber-300"
                    : "border-zinc-700 text-zinc-400"
              }`}
            >
              {s.ownership}
            </span>
            <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-zinc-300 hover:underline">
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
  let points: Awaited<ReturnType<typeof api.mentionTrends>>["points"] = [];
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
        <Tile label="delta vs first" value={`${delta >= 0 ? "+" : ""}${pct(delta)}`} />
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
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">{p.runs}</td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">{pct(p.mentionRate)}</td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">
                {pct(p.recommendationRate)}
              </td>
              <td className="nums border-b border-zinc-900 py-2 text-right text-zinc-300">{p.citedHosts}</td>
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
  let report;
  try {
    report = await api.mentionReport(ownerId, brandId, windowDays);
  } catch {
    return <EmptyState text="no report data" />;
  }
  return (
    <section className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="runs" value={String(report.summary.runs)} />
        <Tile label="mention rate" value={pct(report.summary.brandMentionRate)} />
        <Tile label="citation rate" value={pct(report.summary.brandCitationRate)} />
        <Tile label="trend points" value={String(report.summary.trendPoints)} />
      </div>

      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          competitor share
        </h2>
        <ul className="mt-3 space-y-1 font-mono text-[11px]">
          {Object.entries(report.shareOfVoice.competitorShare)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([k, v]) => (
              <li key={k} className="flex items-center justify-between border-b border-zinc-900 py-1">
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
              <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-zinc-300 hover:underline">
                {s.url}
              </a>
              <span className="nums text-zinc-500">{s.mentionRunCount}</span>
            </li>
          ))}
          {report.citedSources.length === 0 && <li className="text-zinc-500">no indexed sources yet</li>}
        </ul>
      </div>
    </section>
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
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
