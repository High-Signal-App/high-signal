import { createClerkClient } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

// biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access here.
const publishableKey = process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'];
// biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access here.
const secretKey = process.env['CLERK_SECRET_KEY'];

function requestFromHeaders(headerList: Headers) {
  const proto = headerList.get('x-forwarded-proto') ?? 'https';
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost';
  return new Request(`${proto}://${host}/`, { headers: headerList });
}

export async function getRequestAuth(request?: Request) {
  if (!publishableKey || !secretKey) return null;

  try {
    const clerk = createClerkClient({ publishableKey, secretKey });
    const authRequest = request ?? requestFromHeaders(await headers());
    const state = await clerk.authenticateRequest(authRequest, { publishableKey, secretKey });
    return state.toAuth();
  } catch {
    return null;
  }
}

export async function requireSignedIn() {
  const auth = await getRequestAuth();
  const userId = auth && 'userId' in auth ? auth.userId : null;
  if (!userId) redirect('/sign-in' as Route);
  return {
    userId,
    orgId: auth && 'orgId' in auth ? auth.orgId : null,
  };
}
