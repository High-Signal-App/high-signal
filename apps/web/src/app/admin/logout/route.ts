import { cookies } from 'next/headers';

import { ADMIN_COOKIE } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Clears the operator session. POST-only so a stray link cannot sign you out. */
export async function POST(req: Request) {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.redirect(new URL('/', req.url), 303);
}
