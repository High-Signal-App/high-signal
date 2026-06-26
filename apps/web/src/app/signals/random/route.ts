import { redirect } from 'next/navigation';

import { api } from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';

export const dynamic = 'force-dynamic';

/**
 * /signals/random — bounces to a random published signal. Useful for
 * share links and "explore" entry points.
 */
export async function GET() {
  try {
    const { signals } = await api.signals();
    const publicSignals = signals.filter((signal) => !isBackfillSignal(signal));
    if (publicSignals.length === 0) {
      redirect('/signals');
    }
    const pick = publicSignals[Math.floor(Math.random() * publicSignals.length)];
    redirect(`/signals/${pick.slug}`);
  } catch {
    redirect('/signals');
  }
}
