import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Public JSON listing of every entity in the High Signal corpus. Lets
 * subscribers build their own watchlists / dashboards without scraping
 * the /entities HTML.
 */
export async function GET() {
  let entities: Awaited<ReturnType<typeof api.entities>>['entities'] = [];
  try {
    const r = await api.entities();
    entities = r.entities;
  } catch {
    /* offline — return empty list */
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), entities }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
    },
  });
}
