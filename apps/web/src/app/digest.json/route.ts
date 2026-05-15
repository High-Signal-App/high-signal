import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** JSON twin of /digest/rss — weekly cohort of signals. */
export async function GET() {
  let since = "";
  let signals: Awaited<ReturnType<typeof api.digestWeekly>>["signals"] = [];
  try {
    const r = await api.digestWeekly();
    signals = r.signals;
    since = r.since;
  } catch {
    /* offline */
  }

  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), since, signals }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
