// Vérificateur Clerk sans CLERK_JWT_KEY : un jeton valide n'est jamais refusé à cause d'un autre jeton
// (démarrage à froid, jeton expiré, panne passagère de l'API Clerk), tout en gardant la protection
// contre l'amplification pour les identifiants de clé réellement inconnus.

import { describe, expect, it } from 'vitest';
import { createClerkVerifier } from '../../server/auth.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenWith = (kid: string, extra = '') => `${b64({ alg: 'RS256', kid })}.${b64({ sub: 'user_x' })}.signature${extra}`;
const config = { secretKey: 'sk_test_x', authorizedParties: [] } as never;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('vérificateur Clerk : un jeton valide n’est jamais refusé à cause d’un autre (sans CLERK_JWT_KEY)', () => {
  it('démarrage à froid : 4 requêtes simultanées avec le même identifiant de clé valide réussissent toutes', async () => {
    let calls = 0;
    const verifier = createClerkVerifier(config, {
      verify: (async () => { calls++; await wait(20); return { sub: 'user_abc123' }; }) as never,
      now: () => 0,
    });
    const results = await Promise.allSettled([1, 2, 3, 4].map(i => verifier(tokenWith('ins_valide000001', String(i)))));
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    // Chaque jeton est vérifié (signatures différentes) ; les trois derniers attendent la première vérification.
    expect(calls).toBe(4);
  });

  it('un jeton expiré puis un jeton valide du même identifiant, une seconde plus tard, réussissent', async () => {
    let clock = 0;
    const outcomes: unknown[] = [Object.assign(new Error('expiré'), { reason: 'token-expired' }), { sub: 'user_abc123' }];
    const verifier = createClerkVerifier(config, {
      verify: (async () => { const o = outcomes.shift(); if (o instanceof Error) throw o; return o; }) as never,
      now: () => clock,
    });
    await expect(verifier(tokenWith('ins_valide000001', 'a'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    clock += 1_000;
    await expect(verifier(tokenWith('ins_valide000001', 'b'))).resolves.toBe('user_abc123');
  });

  it('une panne passagère de l’API Clerk ne verrouille pas la vraie clé', async () => {
    const outcomes: unknown[] = [Object.assign(new Error('réseau'), { reason: 'jwk-remote-failed-to-load' }), { sub: 'user_abc123' }];
    const verifier = createClerkVerifier(config, {
      verify: (async () => { const o = outcomes.shift(); if (o instanceof Error) throw o; return o; }) as never,
      now: () => 0,
    });
    await expect(verifier(tokenWith('ins_valide000001', 'a'))).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(verifier(tokenWith('ins_valide000001', 'b'))).resolves.toBe('user_abc123');
  });

  it('un identifiant inconnu de Clerk garde son verrou d’une minute, même avec des demandes simultanées', async () => {
    let calls = 0;
    const verifier = createClerkVerifier(config, {
      verify: (async () => { calls++; await wait(10); throw Object.assign(new Error('kid inconnu'), { reason: 'jwk-failed-to-resolve' }); }) as never,
      now: () => 0,
    });
    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(i => verifier(tokenWith(`ins_forge${String(i).padStart(6, '0')}`))));
    expect(results.every(r => r.status === 'rejected')).toBe(true);
    expect(calls).toBe(1);
    // Même identifiant forgé, rejoué : toujours aucun appel Clerk supplémentaire.
    await expect(verifier(tokenWith('ins_forge000000', 'x'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls).toBe(1);
  });
});
