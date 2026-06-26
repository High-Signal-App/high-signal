import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * JSON twin of /sectors. Lets external dashboards plot net-direction
 * and hit-rate by sector without scraping the HTML.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 60), 7), 365);

  let data: Awaited<ReturnType<typeof api.sectors>> = { days, sectors: [] };
  try {
    data = await api.sectors(days);
  } catch {
    /* offline */
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), ...data }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
    },
  });
}
