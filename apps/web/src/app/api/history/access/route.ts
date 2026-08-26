import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { HISTORY_ACCESS_COOKIE, HISTORY_ACCESS_TTL_SECONDS } from '@high-signal/shared';
import { fetchApiResponse } from '@/lib/api';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { turnstileToken?: unknown };
  if (
    typeof body.turnstileToken !== 'string' ||
    body.turnstileToken.length === 0 ||
    body.turnstileToken.length > 2048
  ) {
    return NextResponse.json({ error: 'verification_required' }, { status: 400 });
  }

  const incomingHeaders = await headers();
  const upstreamHeaders = new Headers({ 'Content-Type': 'application/json' });
  const remoteIp = incomingHeaders.get('cf-connecting-ip');
  if (remoteIp) upstreamHeaders.set('CF-Connecting-IP', remoteIp);

  let upstream: Response;
  try {
    upstream = await fetchApiResponse('/history/access', {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ turnstileToken: body.turnstileToken }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 403 });
  }

  const access = (await upstream.json()) as { grant?: unknown; expiresAt?: unknown };
  if (typeof access.grant !== 'string' || typeof access.expiresAt !== 'string') {
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true, expiresAt: access.expiresAt });
  response.cookies.set(HISTORY_ACCESS_COOKIE, access.grant, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: HISTORY_ACCESS_TTL_SECONDS,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
