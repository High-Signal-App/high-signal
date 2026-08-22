#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { verifyOperator } from '../src/lib/access';

async function main() {
  const audience = 'high-signal-aud';
  const teamDomain = 'high-signal.cloudflareaccess.com';
  const issuer = `https://${teamDomain}`;
  process.env['CF_ACCESS_AUD'] = audience;
  process.env['CF_ACCESS_TEAM_DOMAIN'] = teamDomain;

  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ keys: [{ ...jwk, alg: 'RS256', kid: 'test-key', use: 'sig' }] });

  async function token(
    overrides: { audience?: string; expiresIn?: string; issuer?: string; email?: string } = {}
  ) {
    return new SignJWT({ email: overrides.email ?? 'operator@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(privateKey);
  }

  const valid = await token();
  assert.equal(
    (await verifyOperator(new Headers({ 'Cf-Access-Jwt-Assertion': valid })))?.email,
    'operator@example.com'
  );
  assert.equal(
    await verifyOperator(
      new Headers({ 'Cf-Access-Jwt-Assertion': await token({ audience: 'wrong' }) })
    ),
    null
  );
  assert.equal(
    await verifyOperator(
      new Headers({ 'Cf-Access-Jwt-Assertion': await token({ expiresIn: '-1s' }) })
    ),
    null
  );
  assert.equal(
    await verifyOperator(
      new Headers({
        'Cf-Access-Jwt-Assertion': await token({ issuer: 'https://attacker.example' }),
      })
    ),
    null
  );
  assert.equal(
    await verifyOperator(new Headers({ 'Cf-Access-Jwt-Assertion': await token({ email: '' }) })),
    null
  );

  const attackerKeys = await generateKeyPair('RS256');
  const forged = await new SignJWT({ email: 'operator@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'forged' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(attackerKeys.privateKey);
  assert.equal(await verifyOperator(new Headers({ 'Cf-Access-Jwt-Assertion': forged })), null);

  assert.equal(
    (await verifyOperator(new Headers({ Cookie: `CF_Authorization=${valid}` })))?.email,
    'operator@example.com'
  );
  assert.equal(await verifyOperator(new Headers()), null);

  globalThis.fetch = originalFetch;
  console.log('Cloudflare Access JWT contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
