import { api, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";
import { assessSignalQuality, type SignalContentCategory } from "@high-signal/shared";
import {
  buildDailyBroadInsights,
  buildDailySourceCoverage,
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
  const broadInsights = buildDailyBroadInsights(refreshes, date).filter(
    (item) => !category || item.contentCategory === category,
  );
  const sourceCoverage = buildDailySourceCoverage(refreshes);
  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      date,
      category,
      count: today.length,
      broadInsightCount: broadInsights.length,
      sourceCoverage,
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
