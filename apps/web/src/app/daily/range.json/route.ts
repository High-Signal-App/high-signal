import { safeReadDomain, safeReadLayer } from "@/lib/daily-read-filters";
import { buildDailyRangeSummary } from "@/lib/daily-range";
import {
  DAILY_INTELLIGENCE_LAYER,
  dailyAnnotationRuntime,
  defaultDailyAnnotationOptions,
  readSourceRefreshes,
} from "@/lib/daily-intelligence";
import productGraph from "../../../../../../data/personal-product-graph.json";
import type { PersonalProductProfile, SignalContentCategory } from "@high-signal/shared";

export const dynamic = "force-dynamic";

function safeDays(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") as SignalContentCategory | null;
  const layer = safeReadLayer(url.searchParams.get("layer"));
  const domain = safeReadDomain(url.searchParams.get("domain"));
  const requirement = url.searchParams.get("requirement") !== "no";
  const includeTasks = url.searchParams.get("includeTasks") === "yes";
  const refreshes = await readSourceRefreshes();
  const products = productGraph.products as PersonalProductProfile[];
  const annotationRuntime = await dailyAnnotationRuntime();
  const summary = await buildDailyRangeSummary({
    records: refreshes,
    filters: {
      category: category ?? "",
      layer,
      domain,
      requirement,
    },
    products,
    annotationOptions: defaultDailyAnnotationOptions(),
    from: safeDate(url.searchParams.get("from")),
    to: safeDate(url.searchParams.get("to")) ?? safeDate(url.searchParams.get("date")),
    days: safeDays(url.searchParams.get("days")),
    includeTasks,
  });

  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      ...summary,
      category,
      layer,
      domain,
      requirement,
      includeTasks,
      intelligenceLayer: DAILY_INTELLIGENCE_LAYER,
      annotationRuntime,
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
