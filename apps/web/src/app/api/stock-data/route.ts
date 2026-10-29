import { fetchApiResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const entity = new URL(request.url).searchParams.get('entity');
  try {
    const response = await fetchApiResponse(
      `/v1/stock-data${entity ? `?entity=${encodeURIComponent(entity)}` : ''}`,
      { cache: 'no-store' }
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: 'stock_data_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
