import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { istDay, isProtectedHistoryDay, recentHistoryStart } from '@high-signal/shared';
import { createHistoryGrant, verifyHistoryGrant } from '../lib/history-access';
import { historyRoute } from '../routes/history';

const SECRET = 'test-turnstile-secret-that-is-long-enough';
const NOW = new Date('2026-08-26T06:00:00.000Z');

afterEach(() => vi.unstubAllGlobals());

describe('history day boundary', () => {
  it('uses the IST operator day and leaves today plus yesterday public', () => {
    expect(istDay(NOW)).toBe('2026-08-26');
    expect(isProtectedHistoryDay('2026-08-26', NOW)).toBe(false);
    expect(isProtectedHistoryDay('2026-08-25', NOW)).toBe(false);
    expect(isProtectedHistoryDay('2026-08-24', NOW)).toBe(true);
    expect(recentHistoryStart(NOW).toISOString()).toBe('2026-08-24T18:30:00.000Z');
  });
});

describe('history grants', () => {
  it('accepts an intact bounded grant and rejects tampering or expiry', async () => {
    const { grant } = await createHistoryGrant(SECRET, NOW);
    await expect(verifyHistoryGrant(grant, SECRET, NOW)).resolves.toBe(true);
    await expect(verifyHistoryGrant(`${grant}x`, SECRET, NOW)).resolves.toBe(false);
    await expect(
      verifyHistoryGrant(grant, SECRET, new Date('2026-08-26T18:00:01.000Z'))
    ).resolves.toBe(false);
  });
});

describe('history access route', () => {
  const env = {
    TURNSTILE_SECRET: SECRET,
    TURNSTILE_HOSTNAMES: 'highsignal.app,www.highsignal.app',
  };
  const app = new Hono<{ Bindings: typeof env }>();
  app.route('/history', historyRoute);

  it('issues a grant only after action and hostname validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          success: true,
          action: 'history_access',
          hostname: 'highsignal.app',
        })
      )
    );
    const response = await app.request(
      'http://test/history/access',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken: 'fresh-token' }),
      },
      env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = (await response.json()) as { grant: string };

    const check = await app.request(
      'http://test/history/access',
      { headers: { Authorization: `Bearer ${body.grant}` } },
      env
    );
    expect(check.status).toBe(200);
    await expect(check.json()).resolves.toEqual({ valid: true });
  });

  it('fails closed when Turnstile rejects the challenge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false }))
    );
    const response = await app.request(
      'http://test/history/access',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken: 'bad-token' }),
      },
      env
    );
    expect(response.status).toBe(403);
  });
});
