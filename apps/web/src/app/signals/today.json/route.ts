import { api, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";
import {
  buildDailyBroadInsights,
  buildDailySourceCoverage,
  DAILY_INTELLIGENCE_LAYER,
  resolveAcceptedRefreshDate,
  readSourceRefreshes,
} from "@/lib/daily-intelligence";

export const dynamic = "force-dynamic";

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : utcDate();
}

function signalCategory(signal: SignalRow): SignalContentCategory {
  return (
    signal.contentCategory ??
    assessSignalQuality({
      signalType: signal.signalType,
      confidence: signal.confidence,
      evidenceUrls: signal.evidenceUrls,
      bodyMd: signal.bodyMd,
    }).contentCategory
  );
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

function signalTitle(signal: SignalRow) {
  const line = signal.bodyMd
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  return (line ?? `${signal.primaryEntityId} ${signal.signalType}`).replace(/^#+\s*/, "");
}

/** JSON twin of /signals/today — one UTC date of signals, freshest first. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = safeDate(url.searchParams.get("date"));
  const category = url.searchParams.get("category") as SignalContentCategory | null;
  let all: SignalRow[] = [];
  try {
    const r = await api.signals({ date, limit: 200 });
    all = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* offline */
  }
  const today = all.filter((s) => !category || signalCategory(s) === category);
  const refreshes = await readSourceRefreshes();
  const sourceReadDate = resolveAcceptedRefreshDate(refreshes, date) ?? date;
  const allBroadInsights = buildDailyBroadInsights(refreshes, sourceReadDate);
  const broadInsights = allBroadInsights.filter(
    (item) => !category || item.contentCategory === category,
  );
  const sourceCoverage = buildDailySourceCoverage(refreshes, sourceReadDate);
  const categoryCounts = countBy([
    ...all.map((signal) => signalCategory(signal)),
    ...allBroadInsights.map((item) => item.contentCategory),
  ]);
  const intentCounts = countBy(broadInsights.map((item) => item.intent));
  const sentimentCounts = countBy(broadInsights.map((item) => item.sentiment));
  const items = [
    ...today.map((signal) => ({
      kind: "signal" as const,
      id: signal.slug,
      title: signalTitle(signal),
      href: `/signals/${signal.slug}`,
      contentCategory: signalCategory(signal),
      confidence: signal.confidence,
      observedAt: signal.publishedAt,
      sourceCount: signal.evidenceUrls.length,
    })),
    ...broadInsights.map((item) => ({
      kind: "broad-insight" as const,
      id: item.id,
      title: item.title,
      href: item.href,
      contentCategory: item.contentCategory,
      confidence: item.confidence,
      observedAt: item.observedAt,
      sourceCount: item.sourceCount,
      intent: item.intent,
      sentiment: item.sentiment,
      urgency: item.urgency,
      qualityScore: item.qualityScore,
    })),
  ].sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      date,
      requestedDate: date,
      sourceReadDate,
      sourceDateShifted: sourceReadDate !== date,
      category,
      count: today.length,
      totalCount: today.length + broadInsights.length,
      broadInsightCount: broadInsights.length,
      categoryCounts,
      intentCounts,
      sentimentCounts,
      intelligenceLayer: DAILY_INTELLIGENCE_LAYER,
      sourceCoverage,
      items,
      signals: today,
      broadInsights,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
