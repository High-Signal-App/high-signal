import { api, type Region } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get('region')?.trim();
  const ownerId = url.searchParams.get('owner')?.trim();
  const productId = url.searchParams.get('product')?.trim();

  const snapshot = await api.brief({
    region: region ? (region as Region) : undefined,
    ownerId: ownerId || undefined,
    productId: productId || undefined,
  });

  return Response.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
