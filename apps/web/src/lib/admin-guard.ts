/** Request-bound Cloudflare Access gate for the single operator. */

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { verifyOperator } from '@/lib/access';

/**
 * True when the caller presents a valid admin cookie. Pass `request` from route
 * handlers; server components can omit it and read the ambient cookie store.
 */
export async function hasAdminSession(request?: Request): Promise<boolean> {
  const requestHeaders = request ? request.headers : new Headers(await headers());
  return Boolean(await verifyOperator(requestHeaders));
}

/**
 * Access redirects normal browser traffic before it reaches the Worker. A
 * request that bypasses the edge receives a generic 404 from server-rendered
 * pages; route handlers return an explicit 401 at their own boundary.
 */
export async function requireAdminSession(): Promise<void> {
  if (await hasAdminSession()) return;
  notFound();
}
