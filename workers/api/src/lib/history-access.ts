import {
  HISTORY_ACCESS_ACTION,
  HISTORY_ACCESS_TTL_SECONDS,
} from '@high-signal/shared';

const encoder = new TextEncoder();
const GRANT_PREFIX = 'high-signal-history-v1';
const GRANT_SALT = encoder.encode('high-signal-history-access');
const GRANT_INFO = encoder.encode('grant-signing-v1');

type HistoryGrantPayload = {
  v: 1;
  scope: typeof HISTORY_ACCESS_ACTION;
  issuedAt: number;
  expiresAt: number;
};

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey(secret: string) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: GRANT_SALT, info: GRANT_INFO },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
}

export async function createHistoryGrant(
  secret: string,
  now = new Date()
): Promise<{ grant: string; expiresAt: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: HistoryGrantPayload = {
    v: 1,
    scope: HISTORY_ACCESS_ACTION,
    issuedAt,
    expiresAt: issuedAt + HISTORY_ACCESS_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const message = `${GRANT_PREFIX}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(message)
  );
  return {
    grant: `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export async function verifyHistoryGrant(
  grant: string | null | undefined,
  secret: string | null | undefined,
  now = new Date()
): Promise<boolean> {
  const normalizedSecret = secret?.trim();
  if (!normalizedSecret || !grant || grant.length > 2048) return false;
  const [encodedPayload, encodedSignature, extra] = grant.split('.');
  if (!encodedPayload || !encodedSignature || extra) return false;

  const payloadBytes = decodeBase64Url(encodedPayload);
  const signatureBytes = decodeBase64Url(encodedSignature);
  if (!payloadBytes || !signatureBytes) return false;
  const signatureBuffer = Uint8Array.from(signatureBytes).buffer;

  const validSignature = await crypto.subtle.verify(
    'HMAC',
    await signingKey(normalizedSecret),
    signatureBuffer,
    encoder.encode(`${GRANT_PREFIX}.${encodedPayload}`)
  );
  if (!validSignature) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as HistoryGrantPayload;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return (
      payload.v === 1 &&
      payload.scope === HISTORY_ACCESS_ACTION &&
      Number.isInteger(payload.issuedAt) &&
      Number.isInteger(payload.expiresAt) &&
      payload.issuedAt <= nowSeconds + 60 &&
      payload.expiresAt > nowSeconds &&
      payload.expiresAt - payload.issuedAt === HISTORY_ACCESS_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

export function bearerGrant(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}
