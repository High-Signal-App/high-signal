import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * JSON twin of /track-record. The public hit-rate ledger is a moat —
 * making it machine-readable lets backtest tools, dashboards, and
 * academic write-ups cite it directly without scraping.
 */
export async function GET() {
  let buckets: Awaited<ReturnType<typeof api.trackRecord>>["buckets"] = [];
  try {
    const r = await api.trackRecord();
    buckets = r.buckets;
  } catch {
    /* offline */
  }
  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), buckets }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
      },
    },
  );
}
