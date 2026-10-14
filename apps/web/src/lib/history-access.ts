import 'server-only';

import { cookies } from 'next/headers';
import { HISTORY_ACCESS_COOKIE } from '@high-signal/shared';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE'] ?? 'https://api.highsignal.app';

export async function verifiedHistoryGrant(): Promise<string | null> {
  const grant = (await cookies()).get(HISTORY_ACCESS_COOKIE)?.value;
  if (!grant) return null;
  try {
    // Keep bearer validation off the generic cached/service-binding fetch path.
    const response = await fetch(`${API_BASE.replace(/\/$/, '')}/history/access`, {
      headers: { Authorization: `Bearer ${grant}` },
      cache: 'no-store',
    });
    return response.ok ? grant : null;
  } catch {
    return null;
  }
}
