// Vérification réelle des jetons de session Clerk (@clerk/backend, clé PEM locale, sans réseau).

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authenticate, createClerkVerifier, extractBearerToken } from '../../server/auth.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' });
  const payload = b64({ iss: 'https://exemple.clerk.accounts.dev', sid: 'sess_1', iat: now - 5, nbf: now - 10, exp: now + 60, ...claims });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('createClerkVerifier (jwtKey)', () => {
  const verify = createClerkVerifier({ jwtKey: PEM.replace(/\n/g, '\\n').replace(/\\n/g, '\n'), authorizedParties: ['https://magistra.univ.fr'] });

  it('renvoie le claim sub d’un jeton valide', async () => {
    await expect(verify(jwt({ sub: 'user_2abc', azp: 'https://magistra.univ.fr' }))).resolves.toBe('user_2abc');
  });

  it('refuse un jeton signé par une autre clé', async () => {
    await expect(verify(jwt({ sub: 'user_2abc', azp: 'https://magistra.univ.fr' }, other.privateKey))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuse un jeton expiré', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verify(jwt({ sub: 'user_2abc', azp: 'https://magistra.univ.fr', exp: now - 120, iat: now - 600, nbf: now - 600 }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuse un jeton émis pour une autre origine (authorizedParties)', async () => {
    await expect(verify(jwt({ sub: 'user_2abc', azp: 'https://site-malveillant.example' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuse un jeton modifié (sub remplacé)', async () => {
    const token = jwt({ sub: 'user_A', azp: 'https://magistra.univ.fr' });
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64({ sub: 'user_B', azp: 'https://magistra.univ.fr', exp: Math.floor(Date.now() / 1000) + 60 })}.${s}`;
    await expect(verify(forged)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuse un jeton « alg: none »', async () => {
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'user_A', exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    await expect(verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuse une session en attente (sts ≠ active)', async () => {
    await expect(verify(jwt({ sub: 'user_2abc', azp: 'https://magistra.univ.fr', sts: 'pending' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('les clés PEM saisies avec des « \\n » littéraux sont acceptées par la configuration', async () => {
    const { loadConfig } = await import('../../server/config.js');
    const cfg = loadConfig({ CLERK_JWT_KEY: PEM.replace(/\n/g, '\\n') });
    const v = createClerkVerifier(cfg.clerk!);
    await expect(v(jwt({ sub: 'user_2abc' }))).resolves.toBe('user_2abc');
  });
});

describe('authenticate', () => {
  it('extrait uniquement un jeton Bearer bien formé', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer a b')).toBeNull();
    expect(extractBearerToken(['Bearer a', 'Bearer b'])).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(`Bearer ${'a'.repeat(20_000)}`)).toBeNull();
  });

  it('refuse un identifiant renvoyé par le vérificateur s’il est mal formé', async () => {
    await expect(authenticate({ authorization: 'Bearer x' }, async () => 'user A; DROP')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(authenticate({ authorization: 'Bearer x' }, async () => { throw new Error('boom'); })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(authenticate({ authorization: 'Bearer x' }, async () => 'user_ok')).resolves.toBe('user_ok');
  });
});

describe('vérificateur Clerk : pas d’amplification vers l’API Clerk (non-régression)', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenWith = (header: Record<string, unknown>) => `${b64(header)}.${b64({ sub: 'user_x' })}.signature`;

  it('refuse sans appel réseau les jetons mal formés, « none », HS256 ou à kid hors format', async () => {
    let calls = 0;
    const verifier = createClerkVerifier({ secretKey: 'sk_test_x', authorizedParties: [] } as never, {
      verify: (async () => { calls++; return { sub: 'user_abc123' }; }) as never,
    });
    for (const t of ['pas-un-jwt', tokenWith({ alg: 'none', kid: 'ins_abcdefghij' }), tokenWith({ alg: 'HS256', kid: 'ins_abcdefghij' }), tokenWith({ alg: 'RS256', kid: '../../x' })]) {
      await expect(verifier(t)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect(calls).toBe(0);
  });

  it('au plus un rechargement des clés par minute pour des identifiants de clé inconnus', async () => {
    let calls = 0;
    let clock = 0;
    const verifier = createClerkVerifier({ secretKey: 'sk_test_x', authorizedParties: [] } as never, {
      verify: (async () => { calls++; throw Object.assign(new Error('kid inconnu'), { reason: 'jwk-failed-to-resolve' }); }) as never,
      now: () => clock,
    });
    for (let i = 0; i < 50; i++) {
      await expect(verifier(tokenWith({ alg: 'RS256', kid: `ins_inconnu${String(i).padStart(4, '0')}` }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect(calls).toBe(1);
    clock += 61_000;
    await expect(verifier(tokenWith({ alg: 'RS256', kid: 'ins_nouveau00001' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toBe(2);
  });

  it('un identifiant de clé déjà validé n’est jamais bloqué', async () => {
    let clock = 0;
    const verifier = createClerkVerifier({ secretKey: 'sk_test_x', authorizedParties: [] } as never, {
      verify: (async () => ({ sub: 'user_abc123' })) as never,
      now: () => clock,
    });
    const good = tokenWith({ alg: 'RS256', kid: 'ins_connu0000001' });
    await expect(verifier(good)).resolves.toBe('user_abc123');
    // Une autre clé inconnue dans la même minute est refusée sans appel réseau…
    await expect(verifier(tokenWith({ alg: 'RS256', kid: 'ins_autre0000001' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // … mais la clé déjà validée reste acceptée à tout moment.
    clock += 1_000;
    await expect(verifier(good)).resolves.toBe('user_abc123');
  });
});
