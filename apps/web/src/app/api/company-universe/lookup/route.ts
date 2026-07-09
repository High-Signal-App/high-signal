import { fetchJson } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await fetchJson('/company-universe/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'lookup_failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
