import { Hono } from 'hono';
import { HISTORY_ACCESS_ACTION } from '@high-signal/shared';
import { bearerGrant, createHistoryGrant, verifyHistoryGrant } from '../lib/history-access';
import { verifyTurnstile } from '../lib/turnstile';

type Env = {
  TURNSTILE_HOSTNAMES?: string;
  TURNSTILE_SECRET?: string;
};

export const historyRoute = new Hono<{ Bindings: Env }>();

historyRoute.post('/access', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { turnstileToken?: unknown };
  const verified = await verifyTurnstile({
    token: body.turnstileToken,
    action: HISTORY_ACCESS_ACTION,
    remoteIp: c.req.header('CF-Connecting-IP') ?? 'unknown',
    secret: c.env.TURNSTILE_SECRET,
    hostnameList: c.env.TURNSTILE_HOSTNAMES,
  });
  if (!verified || !c.env.TURNSTILE_SECRET?.trim()) {
    c.header('Cache-Control', 'private, no-store');
    return c.json({ error: 'verification_failed' }, 403);
  }

  const access = await createHistoryGrant(c.env.TURNSTILE_SECRET);
  c.header('Cache-Control', 'private, no-store');
  return c.json(access);
});

historyRoute.get('/access', async (c) => {
  const valid = await verifyHistoryGrant(
    bearerGrant(c.req.header('authorization')),
    c.env.TURNSTILE_SECRET
  );
  c.header('Cache-Control', 'private, no-store');
  return c.json({ valid }, valid ? 200 : 403);
});
