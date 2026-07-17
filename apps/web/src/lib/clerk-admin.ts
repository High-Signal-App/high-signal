import { createClerkClient } from '@clerk/nextjs/server';
import { getRequestAuth } from '@/lib/require-auth';

const ALLOWED_EMAILS = (process.env.ADMIN_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export interface AdminIdentity {
  userId: string;
  email: string;
}

export async function requireAdmin(
  request?: Request
): Promise<
  | { ok: true; identity: AdminIdentity }
  | { ok: false; status: 401 | 403; body: { error: string; email?: string } }
> {
  const auth = await getRequestAuth(request);
  const userId = auth && 'userId' in auth ? auth.userId : null;
  if (!userId) return { ok: false, status: 401, body: { error: 'unauthorized' } };

  const client = createClerkClient({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  const user = await client.users.getUser(userId);
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email) return { ok: false, status: 403, body: { error: 'missing_email' } };

  if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
    return { ok: false, status: 403, body: { error: 'forbidden', email } };
  }

  return { ok: true, identity: { userId, email } };
}
