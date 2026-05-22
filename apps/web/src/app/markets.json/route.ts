import { buildMarketWatchSnapshot } from "@/lib/market-watch";

export const dynamic = "force-dynamic";

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return new Response(JSON.stringify(buildMarketWatchSnapshot(new Date(), safeDate(url.searchParams.get("date")))), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
