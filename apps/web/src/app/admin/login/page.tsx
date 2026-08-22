import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasAdminSession } from '@/lib/admin-guard';
import {
  ADMIN_COOKIE,
  SESSION_TTL_MS,
  checkPassword,
  mintSessionValue,
  readSecret,
} from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

async function signIn(formData: FormData) {
  'use server';

  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/review');

  if (!(await checkPassword(password))) {
    redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}` as Route);
  }

  const value = await mintSessionValue(Date.now());
  if (!value) {
    redirect(`/admin/login?error=unconfigured&next=${encodeURIComponent(next)}` as Route);
  }

  (await cookies()).set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  redirect((next.startsWith('/') ? next : '/review') as Route);
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; next?: string }>;
}) {
  const params = (await searchParams) ?? {};
  if (await hasAdminSession()) redirect((params.next ?? '/review') as Route);

  const configured = Boolean(
    (await readSecret('ADMIN_PASSWORD')) && (await readSecret('ADMIN_SESSION_SECRET'))
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        operator access
      </div>
      <h1 className="mt-3 text-2xl font-medium tracking-tight">Admin</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
        Everything readable on High Signal is public. This gate only controls who can publish, kill,
        or correct signals.
      </p>

      {!configured ? (
        <p className="mt-6 border border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-muted)]">
          Admin access is not configured. Set <code>ADMIN_PASSWORD</code> and{' '}
          <code>ADMIN_SESSION_SECRET</code> to enable it.
        </p>
      ) : (
        <form action={signIn} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={params.next ?? '/review'} />
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-sans text-sm normal-case tracking-normal text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          {params.error ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
              {params.error === 'unconfigured' ? 'admin secret missing' : 'incorrect password'}
            </p>
          ) : null}
          <button
            type="submit"
            className="border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-black"
          >
            sign in
          </button>
        </form>
      )}

      <a
        href="/"
        className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
      >
        back home
      </a>
    </main>
  );
}
