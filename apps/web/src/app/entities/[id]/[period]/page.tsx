import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  BackLink,
  FeedList,
  PageShell,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import {
  BreadcrumbJsonLd,
  EntityMonthJsonLd,
} from "@/components/seo/structured-data";
import { api, type SignalRow } from "@/lib/api";
import { signalHeadline } from "@/lib/signal-format";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function periodWindow(period: string): { start: Date; end: Date } | null {
  if (!PERIOD_RE.test(period)) return null;
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // 0-indexed for Date
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}): Promise<Metadata> {
  const { id, period } = await params;
  return {
    title: `${id} signals — ${period} archive`,
    description: `Every published High Signal call on ${id} during ${period}, with citations and directional confidence inline.`,
    alternates: { canonical: `${SITE_URL}/entities/${id}/${period}` },
  };
}

export default async function EntityMonthPage({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}) {
  const { id, period } = await params;
  const window = periodWindow(period);
  if (!window) notFound();

  let entity: { id: string; name: string; ticker: string | null } | null = null;
  let allSignals: SignalRow[] = [];
  try {
    const detail = await api.entity(id);
    entity = detail.entity;
    allSignals = detail.signals;
  } catch {
    /* api offline or entity missing */
  }
  if (!entity) notFound();

  // Filter signals to this month (UTC). The API returns the entity's full
  // signal history; we slice client-side because the volume per entity
  // is small (<1000) and the API doesn't accept a date filter on the
  // entity sub-route.
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  const monthSignals = allSignals.filter((s) => {
    const ts = typeof s.publishedAt === "number" ? s.publishedAt : Date.parse(String(s.publishedAt));
    return ts >= startMs && ts < endMs;
  });

  const ups = monthSignals.filter((s) => s.direction === "up").length;
  const downs = monthSignals.filter((s) => s.direction === "down").length;
  const types = Array.from(new Set(monthSignals.map((s) => s.signalType)));

  return (
    <PageShell>
      <BackLink href={`/entities/${id}`}>{`back to ${entity.name}`}</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: "Home", path: "/" },
          { name: "Entities", path: "/entities" },
          { name: entity.name, path: `/entities/${id}` },
          { name: period, path: `/entities/${id}/${period}` },
        ]}
      />
      <EntityMonthJsonLd
        entityName={entity.name}
        entityId={id}
        period={period}
        signalCount={monthSignals.length}
      />

      <SectionHeader
        eyebrow={`${entity.name}${entity.ticker ? ` · ${entity.ticker}` : ""} · archive`}
        title={`${period}`}
      >
        Every published High Signal call on <strong>{entity.name}</strong> during {period}. The
        archive is regenerated whenever a signal is added, edited, killed, or scored.
      </SectionHeader>

      <StatGrid
        items={[
          { label: "signals this month", value: monthSignals.length.toString(), sub: "published only" },
          { label: "up calls", value: ups.toString(), sub: "directional bullish" },
          { label: "down calls", value: downs.toString(), sub: "directional bearish" },
          { label: "distinct types", value: types.length.toString(), sub: "signal taxonomies seen" },
        ]}
      />

      <FeedList
        eyebrow={`signals — ${period}`}
        empty={`No published signals on ${entity.name} during ${period}.`}
        items={monthSignals.map((s) => ({
          href: `/signals/${s.slug}`,
          kicker: `${new Date(s.publishedAt).toISOString().slice(0, 10)} · ${s.signalType} · ${s.direction} · ${s.confidence}`,
          title: signalHeadline(s.bodyMd, s.slug),
          body: null,
        }))}
      />
    </PageShell>
  );
}
