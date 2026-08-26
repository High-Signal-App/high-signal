import 'server-only';

import { cookies } from 'next/headers';
import { HISTORY_ACCESS_COOKIE } from '@high-signal/shared';
import { fetchApiResponse } from '@/lib/api';

export async function verifiedHistoryGrant(): Promise<string | null> {
  const grant = (await cookies()).get(HISTORY_ACCESS_COOKIE)?.value;
  if (!grant) return null;
  try {
    const response = await fetchApiResponse('/history/access', {
      headers: { Authorization: `Bearer ${grant}` },
      cache: 'no-store',
    });
    return response.ok ? grant : null;
  } catch {
    return null;
  }
}

export async function hasHistoryAccess(): Promise<boolean> {
  return (await verifiedHistoryGrant()) !== null;
}
