import { api, type SignalRow } from "@/lib/api";
import { isBackfillSignal } from "@/lib/signal-format";

export const dynamic = "force-dynamic";

function isWithinLast24h(publishedAt: SignalRow["publishedAt"]): boolean {
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) && Date.now() - t < 24 * 60 * 60 * 1000;
}

/** JSON twin of /signals/today — last 24h of signals, freshest first. */
export async function GET() {
  let all: SignalRow[] = [];
  try {
    const r = await api.signals({});
    all = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* offline */
  }
  const today = all.filter((s) => isWithinLast24h(s.publishedAt));
  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: today.length,
      signals: today,
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
