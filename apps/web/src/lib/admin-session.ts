/**
 * Single-operator admin session — the replacement for Clerk.
 *
 * A password check mints a timestamped HMAC cookie. The /api/admin proxy
 * verifies that cookie before injecting the worker-internal ADMIN_TOKEN, so the
 * token itself never reaches the browser — the same property the Clerk-fronted
 * proxy had, without the vendor.
 *
 * Fails closed: with ADMIN_SESSION_SECRET or ADMIN_PASSWORD unset, no session
 * can be minted and every check returns false.
 *
 * This module is deliberately free of `next/*` imports so it can be unit-tested
 * as a plain script (scripts/admin-session.test.ts). The request-bound gate
 * lives in `admin-guard.ts`.
 *
 * HMAC construction mirrors `visibilityReportToken` in
 * packages/shared/src/mentions/openlens-visibility.ts.
 */

export const ADMIN_COOKIE = 'hs_admin';

/** 12 hours. Short enough that a stolen cookie ages out within a working day. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

async function cloudflareEnv(): Promise<Record<string, unknown> | undefined> {
  try {
    const mod = await import('@opennextjs/cloudflare');
    const cfctx = (
      mod as unknown as {
        getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
      }
    ).getCloudflareContext?.();
    return cfctx?.env;
  } catch {
    return undefined;
  }
}

/**
 * Secrets live on the Worker env in production and in process.env for local
 * `next dev`. Check both — the deployed admin proxy has always read ADMIN_TOKEN
 * off the Cloudflare context rather than process.env.
 */
export async function readSecret(name: string): Promise<string> {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const value = (await cloudflareEnv())?.[name];
  return typeof value === 'string' ? value : '';
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Cookie value is `<expiryMs>.<hmac>`; null when no secret is configured. */
export async function mintSessionValue(nowMs: number): Promise<string | null> {
  const secret = await readSecret('ADMIN_SESSION_SECRET');
  if (!secret) return null;
  const expiry = nowMs + SESSION_TTL_MS;
  return `${expiry}.${await sign(secret, `admin:${expiry}`)}`;
}

export async function isValidSessionValue(
  value: string | undefined,
  nowMs: number
): Promise<boolean> {
  if (!value) return false;
  const separator = value.indexOf('.');
  if (separator <= 0) return false;
  const expiryRaw = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= nowMs) return false;

  const secret = await readSecret('ADMIN_SESSION_SECRET');
  if (!secret) return false;
  return constantTimeEqual(await sign(secret, `admin:${expiry}`), signature);
}

/**
 * Compare via HMAC rather than string equality so the comparison is
 * fixed-length and does not leak the password length through timing.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = await readSecret('ADMIN_PASSWORD');
  if (!expected || !candidate) return false;
  const key = (await readSecret('ADMIN_SESSION_SECRET')) || expected;
  return constantTimeEqual(await sign(key, `pw:${expected}`), await sign(key, `pw:${candidate}`));
}

export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf('=');
    if (equals > 0 && trimmed.slice(0, equals) === name) return trimmed.slice(equals + 1);
  }
  return undefined;
}
