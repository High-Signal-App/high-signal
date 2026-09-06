import { NextResponse, after } from 'next/server';
import { headers } from 'next/headers';
import { HISTORY_ACCESS_COOKIE, HISTORY_ACCESS_TTL_SECONDS } from '@high-signal/shared';
import { ping } from '@/lib/ping';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE'] ?? 'https://api.highsignal.app';

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
  // Coarse enough to be non-identifying, specific enough to tell a real reader
  // from a scraper. The client IP is deliberately never logged.
  const country = incomingHeaders.get('cf-ipcountry') ?? 'unknown';
  const upstreamHeaders = new Headers({ 'Content-Type': 'application/json' });
  const remoteIp = incomingHeaders.get('cf-connecting-ip');
  if (remoteIp) upstreamHeaders.set('CF-Connecting-IP', remoteIp);

  let upstream: Response;
  try {
    // A Turnstile token is single-use. Send it straight to the public API
    // endpoint instead of the service-binding path, which can reject a POST
    // before the API Worker receives it and cannot safely be retried.
    upstream = await fetch(`${API_BASE.replace(/\/$/, '')}/history/access`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ turnstileToken: body.turnstileToken }),
      cache: 'no-store',
    });
  } catch {
    console.error('[history-access] verification API unavailable');
    after(() =>
      ping.error('history.unavailable', {
        title: 'history unlock could not reach the verification API',
        icon: '🚨',
        props: { country, reason: 'fetch_failed' },
      })
    );
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }
  if (!upstream.ok) {
    const unavailable = upstream.status >= 500;
    after(() =>
      unavailable
        ? ping.error('history.unavailable', {
            title: 'history unlock rejected by the verification API',
            icon: '🚨',
            props: { country, reason: 'upstream_error', status: upstream.status },
          })
        : ping.warn('history.blocked', {
            title: 'history unlock failed verification',
            icon: '🛑',
            props: { country, status: upstream.status },
          })
    );
    return NextResponse.json(
      { error: unavailable ? 'verification_unavailable' : 'verification_failed' },
      { status: unavailable ? 503 : 403 }
    );
  }

  const access = (await upstream.json()) as { grant?: unknown; expiresAt?: unknown };
  if (typeof access.grant !== 'string' || typeof access.expiresAt !== 'string') {
    after(() =>
      ping.error('history.unavailable', {
        title: 'history unlock got a malformed grant',
        icon: '🚨',
        props: { country, reason: 'malformed_grant' },
      })
    );
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }

  after(() =>
    ping('history.unlocked', {
      title: 'someone unlocked the history archive',
      icon: '🔓',
      props: { country },
    })
  );

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
