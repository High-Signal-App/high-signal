import { api } from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

/**
 * JSON twin of /signals/rss. Convenient for callers that want
 * the signal feed without an RSS parser.
 */
export async function GET() {
  let signals: Awaited<ReturnType<typeof api.signals>>['signals'] = [];
  try {
    const r = await api.signals();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* API offline — degrade to empty array. */
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), signals }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
