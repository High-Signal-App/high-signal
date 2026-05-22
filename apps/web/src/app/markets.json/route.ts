import { buildMarketWatchSnapshot } from "@/lib/market-watch";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(JSON.stringify(buildMarketWatchSnapshot()), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
