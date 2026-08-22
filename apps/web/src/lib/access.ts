/** Cloudflare Access JWT verification for the single High Signal operator. */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

interface AccessConfig {
  audience: string;
  teamDomain: string;
}

interface OperatorClaims extends JWTPayload {
  email: string;
}

type VerificationKey = Parameters<typeof jwtVerify>[1];

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

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

async function readWorkerValue(name: string): Promise<string> {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const value = (await cloudflareEnv())?.[name];
  return typeof value === 'string' ? value : '';
}

function normalizeTeamDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) return null;
  return domain;
}

async function readAccessConfig(): Promise<AccessConfig | null> {
  const audience = (await readWorkerValue('CF_ACCESS_AUD')).trim();
  const teamDomain = normalizeTeamDomain(await readWorkerValue('CF_ACCESS_TEAM_DOMAIN'));
  if (!audience || !teamDomain) return null;
  return { audience, teamDomain };
}

function remoteKeyFor(teamDomain: string) {
  let key = jwksByTeam.get(teamDomain);
  if (!key) {
    key = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, key);
  }
  return key;
}

/**
 * Verify signature, issuer, audience, and expiry. Returning null is deliberate:
 * missing configuration, JWKS failures, and malformed/expired tokens all fail
 * closed without leaking validation details to callers.
 */
async function verifyAccessToken(
  token: string | undefined,
  config: AccessConfig,
  key?: VerificationKey
): Promise<OperatorClaims | null> {
  if (!token) return null;
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  if (!teamDomain || !config.audience.trim()) return null;

  try {
    const issuer = `https://${teamDomain}`;
    const { payload } = await jwtVerify(token, key ?? remoteKeyFor(teamDomain), {
      audience: config.audience,
      issuer: [issuer, `${issuer}/`],
    });
    const email = payload['email'];
    if (typeof email !== 'string' || !email.trim()) return null;
    return { ...payload, email };
  } catch {
    return null;
  }
}

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [cookieName, ...value] = part.trim().split('=');
    if (cookieName === name && value.length > 0) return value.join('=');
  }
  return undefined;
}

/** Prefer Access's origin assertion header; browser cookie is a safe fallback. */
function accessTokenFromHeaders(headers: Headers): string | undefined {
  return (
    headers.get('cf-access-jwt-assertion') ?? parseCookie(headers.get('cookie'), 'CF_Authorization')
  );
}

export async function verifyOperator(headers: Headers): Promise<OperatorClaims | null> {
  const config = await readAccessConfig();
  if (!config) return null;
  return verifyAccessToken(accessTokenFromHeaders(headers), config);
}
