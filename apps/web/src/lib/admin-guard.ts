/**
 * Request-bound admin gate. Split from `admin-session.ts` so the crypto core
 * stays importable outside Next (see scripts/admin-session.test.ts).
 */

import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ADMIN_COOKIE, isValidSessionValue, parseCookie } from '@/lib/admin-session';

/**
 * True when the caller presents a valid admin cookie. Pass `request` from route
 * handlers; server components can omit it and read the ambient cookie store.
 */
export async function hasAdminSession(request?: Request): Promise<boolean> {
  const value = request
    ? parseCookie(request.headers.get('cookie'), ADMIN_COOKIE)
    : (await cookies()).get(ADMIN_COOKIE)?.value;
  return isValidSessionValue(value, Date.now());
}

/** Server-component gate. Redirects to the login page when unauthenticated. */
export async function requireAdminSession(returnTo?: string): Promise<void> {
  if (await hasAdminSession()) return;
  const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
  redirect(`/admin/login${next}` as Route);
}
