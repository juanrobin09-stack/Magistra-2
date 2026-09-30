// Cryptographie du connecteur local côté navigateur (WebCrypto) : vecteurs connus, interopérabilité octet pour
// octet avec node:crypto (côté application), clés NON extractibles, formats stricts.

import { createECDH, createHash, createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildPairingUrl, canonicalPairAck, canonicalProof, canonicalRequest, canonicalRevoked, CONNECTOR_CRYPTO, CONNECTOR_FORMATS, formatPairCode,
  PAIR_CODE_RE, parseAppUrl,
} from '@shared/localConnector';
import {
  constantTimeEqualText, createPairingSecrets, deriveHmacKey, expectedPairAck, fromBase64Url, generateClientKeyPair, hmacSign,
  hmacVerify, isNonExtractableHmacKey, pairingCode, sha256Base64Url, signRequest, toBase64Url, verifyPairAck, verifyProof,
  verifyRevokedMark,
} from '@/lib/localConnector/webCrypto';
import { pairCode, revokedMark } from '../../electron/connector/crypto';

// Vecteur fixe (calculé avec node:crypto) : clés privées déterministes des deux côtés.
const BROWSER_D = 'BRIfLDlGU2BteoeUoa67yNXi7_wJFiMwPUpXZHF-i5g';
const BROWSER_PUB = 'BCs_uBlQuHMbFvx0iCZZIFEOiDlRKAE3QfGB2QJ8U90pr3chyXVBeWw2C-I_mXM6r17FcVGghwUX-BcRClwrXUg';
const CONNECTOR_PUB = 'BNYp5b-MkMMRRUQbHH_jdGWsi1qMzb62I2Gi4mUAeY5dfVsUHe85zi0NrULdo4zfxxRjnj1_rEbgsDamLUnxCuE';
const PAIRING_ID = 'AAECAwQFBgcICQoLDA0ODw';
const CLIENT_ID = 'AAECAwQFBgcICQoLDA0ODw';
const NONCE = 'EBESExQVFhcYGRobHB0eHw';
/** Hôte du port visé (inclus dans l'accusé, la signature et la preuve). */
const HOST = '127.0.0.1:47831';
const OTHER_HOST = '127.0.0.1:47832';
const EXPECTED_PROOF = 'SsezZ7hYgYEp20l5RDfBB2WmkVS0t-_VXaks5VpCcc4';

async function importFixedBrowserKey(): Promise<CryptoKey> {
  const pub = Buffer.from(BROWSER_PUB, 'base64url');
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: BROWSER_D, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)), ext: false },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Côté application (node:crypto), comme electron/connector/crypto.ts. */
function nodeDerive(browserPublicKey: string, pairingId: string) {
  const ecdh = createECDH('prime256v1');
  const publicKey = ecdh.generateKeys();
  const secret = ecdh.computeSecret(Buffer.from(browserPublicKey, 'base64url'));
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(pairingId, 'utf8'), Buffer.from(CONNECTOR_CRYPTO.hkdfInfo, 'utf8'), 32));
  return { key, connectorPublicKey: b64(publicKey) };
}

describe('base64url', () => {
  it('aller-retour exact, sans remplissage', () => {
    for (let n = 0; n <= 70; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const text = toBase64Url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
      expect(text).not.toMatch(/[=+/]/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
  });

  it('décodage STRICT : alphabet, forme canonique, longueur', () => {
    expect(fromBase64Url('ab+c')).toBeNull();
    expect(fromBase64Url('ab/c')).toBeNull();
    expect(fromBase64Url('abc=')).toBeNull();
    expect(fromBase64Url('a')).toBeNull(); // longueur impossible
    expect(fromBase64Url('AB')).toBeNull(); // bits de remplissage non nuls (forme non canonique de « AA »)
    expect(fromBase64Url('AA')).toEqual(new Uint8Array([0]));
    expect(fromBase64Url(b64(new Uint8Array(16)), 16)).toHaveLength(16);
    expect(fromBase64Url(b64(new Uint8Array(16)), 32)).toBeNull();
    expect(fromBase64Url(42)).toBeNull();
    expect(fromBase64Url(' AA')).toBeNull();
  });
});

describe('empreintes et HMAC', () => {
  it('SHA-256 (vecteur connu) : corps vide', async () => {
    expect(await sha256Base64Url('')).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
    expect(await sha256Base64Url('abc')).toBe(createHash('sha256').update('abc').digest('base64url'));
  });

  it('HMAC-SHA-256 : RFC 4231, cas 2', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('Jefe'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const expected = Buffer.from('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', 'hex').toString('base64url');
    expect(await hmacSign(key, 'what do ya want for nothing?')).toBe(expected);
    expect(await hmacVerify(key, 'what do ya want for nothing?', expected)).toBe(true);
    expect(await hmacVerify(key, 'what do ya want for nothing!', expected)).toBe(false);
    expect(await hmacVerify(key, 'what do ya want for nothing?', expected.slice(0, -1))).toBe(false);
    expect(await hmacVerify(key, 'what do ya want for nothing?', null)).toBe(false);
  });
});

describe('appairage', () => {
  it('secrets : formats exacts ; défi = SHA-256 des OCTETS du vérificateur ; le vérificateur n’est jamais dans l’URL', async () => {
    const secrets = await createPairingSecrets();
    expect(secrets.pairingId).toMatch(CONNECTOR_FORMATS.pairingId);
    expect(secrets.verifier).toMatch(CONNECTOR_FORMATS.verifier);
    expect(secrets.challenge).toMatch(CONNECTOR_FORMATS.challenge);
    expect(secrets.challenge).toBe(createHash('sha256').update(Buffer.from(secrets.verifier, 'base64url')).digest('base64url'));
    const url = buildPairingUrl({ pairingId: secrets.pairingId, challenge: secrets.challenge, origin: 'https://magistra-2.vercel.app' });
    expect(url).not.toContain(secrets.verifier);
    expect(parseAppUrl(url)).toEqual({ kind: 'pair', pairingId: secrets.pairingId, challenge: secrets.challenge, origin: 'https://magistra-2.vercel.app' });
    const other = await createPairingSecrets();
    expect(other.verifier).not.toBe(secrets.verifier);
    expect(other.pairingId).not.toBe(secrets.pairingId);
  });

  it('accusé de réception : vecteur fixe (identique côté application), comparaison stricte et sans sortie anticipée', async () => {
    // Même vecteur que tests/electron/connectorPairing.test.ts (node:crypto).
    const challenge = 'ctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ';
    expect(await sha256Base64Url(fromBase64Url('ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8', 32)!)).toBe(challenge);
    const ack = await expectedPairAck(PAIRING_ID, challenge, HOST);
    expect(ack).toBe('FWJesznvhJom9M3AmmF_LgZOj3jjb8aI2tJHW6xP1BM');
    expect(ack).toBe(createHash('sha256').update(canonicalPairAck(PAIRING_ID, challenge, HOST), 'utf8').digest('base64url'));
    expect(ack).toMatch(CONNECTOR_FORMATS.ack);

    expect(verifyPairAck(ack, ack)).toBe(true);
    expect(verifyPairAck(ack, `${ack.slice(0, -1)}A`)).toBe(false);
    expect(verifyPairAck(ack, await expectedPairAck(PAIRING_ID, b64(Buffer.alloc(32, 9)), HOST))).toBe(false); // autre défi
    expect(verifyPairAck(ack, await expectedPairAck('EBESExQVFhcYGRobHB0eHw', challenge, HOST))).toBe(false); // autre demande
    expect(verifyPairAck(ack, await expectedPairAck(PAIRING_ID, challenge, OTHER_HOST))).toBe(false); // autre port (relais)
    for (const wrong of [undefined, null, 42, '', ack.slice(1), `${ack}=`, ` ${ack.slice(1)}`, ack.replace(/./, '+')]) {
      expect(verifyPairAck(ack, wrong)).toBe(false);
    }
    expect(constantTimeEqualText('abc', 'abc')).toBe(true);
    expect(constantTimeEqualText('abc', 'abd')).toBe(false);
    expect(constantTimeEqualText('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualText('', '')).toBe(true);
  });

  it('code de vérification : vecteur fixe identique côté application, lisible (« 6KR-RJM »), propre à chaque défi', async () => {
    const challenge = 'ctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ';
    expect(await pairingCode(challenge)).toBe('6KR-RJM');
    expect(pairCode(challenge)).toBe('6KR-RJM');
    expect(await pairingCode(b64(Buffer.alloc(32, 9)))).not.toBe('6KR-RJM');
    for (let i = 0; i < 20; i++) {
      const { challenge: random } = await createPairingSecrets();
      const code = await pairingCode(random);
      expect(code).toMatch(PAIR_CODE_RE);
      expect(code).toBe(pairCode(random));
    }
    // 30 bits : 6 symboles de 5 bits, sans 0/O ni 1/I.
    expect(formatPairCode(new Uint8Array([0, 0, 0, 0]))).toBe('222-222');
    expect(formatPairCode(new Uint8Array([255, 255, 255, 255]))).toBe('ZZZ-ZZZ');
    expect(formatPairCode(new Uint8Array(3))).toBe('');
  });

  it('marque de retrait : calculée par l’application avec la clé, vérifiée par le site ; rien d’autre ne la remplace', async () => {
    const pair = await generateClientKeyPair();
    const pairingId = b64(crypto.getRandomValues(new Uint8Array(16)));
    const app = nodeDerive(pair.publicKey, pairingId);
    const key = await deriveHmacKey(pair.privateKey, app.connectorPublicKey, pairingId);
    const mark = revokedMark(app.key, CLIENT_ID);
    expect(mark).toBe(createHmac('sha256', app.key).update(canonicalRevoked(CLIENT_ID), 'utf8').digest('base64url'));
    expect(await verifyRevokedMark(key, CLIENT_ID, mark)).toBe(true);
    expect(await verifyRevokedMark(key, 'EBESExQVFhcYGRobHB0eHw', mark)).toBe(false); // autre navigateur
    expect(await verifyRevokedMark(key, CLIENT_ID, revokedMark(Buffer.alloc(32, 7), CLIENT_ID))).toBe(false); // autre clé
    // Une preuve (autre chaîne signée) ne vaut jamais marque de retrait.
    const proof = createHmac('sha256', app.key).update(canonicalProof(CLIENT_ID, NONCE, HOST), 'utf8').digest('base64url');
    expect(await verifyRevokedMark(key, CLIENT_ID, proof)).toBe(false);
    for (const wrong of [null, '', 'pas-une-marque', `${mark}=`, mark.slice(1)]) expect(await verifyRevokedMark(key, CLIENT_ID, wrong)).toBe(false);
  });

  it('paire ECDH : clé publique brute non compressée (65 octets, 0x04) ; clé privée NON extractible', async () => {
    const pair = await generateClientKeyPair();
    expect(pair.publicKey).toMatch(CONNECTOR_FORMATS.publicKey);
    expect(Buffer.from(pair.publicKey, 'base64url')[0]).toBe(0x04);
    expect(pair.privateKey.extractable).toBe(false);
    expect(pair.privateKey.usages).toEqual(['deriveBits']);
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
  });

  it('vecteur fixe : clé dérivée identique à celle de node:crypto (preuve attendue)', async () => {
    const key = await deriveHmacKey(await importFixedBrowserKey(), CONNECTOR_PUB, PAIRING_ID);
    expect(await hmacSign(key, canonicalProof(CLIENT_ID, NONCE, HOST))).toBe(EXPECTED_PROOF);
    expect(await verifyProof(key, CLIENT_ID, NONCE, HOST, EXPECTED_PROOF)).toBe(true);
    expect(await verifyProof(key, CLIENT_ID, NONCE, OTHER_HOST, EXPECTED_PROOF)).toBe(false);
  });

  it('interopérabilité avec node:crypto (clés aléatoires) : signature et preuve vérifiées de chaque côté', async () => {
    const pair = await generateClientKeyPair();
    const pairingId = b64(crypto.getRandomValues(new Uint8Array(16)));
    const app = nodeDerive(pair.publicKey, pairingId);
    const key = await deriveHmacKey(pair.privateKey, app.connectorPublicKey, pairingId);

    const parts = {
      method: 'post', host: HOST, path: '/v1/generate', origin: 'https://magistra-2.vercel.app', clientId: CLIENT_ID,
      timestamp: '1790000000000', nonce: NONCE, bodySha256: await sha256Base64Url('{"sujet":"é"}'),
    };
    const signature = await signRequest(key, parts);
    expect(signature).toMatch(CONNECTOR_FORMATS.mac);
    expect(signature).toBe(createHmac('sha256', app.key).update(canonicalRequest(parts), 'utf8').digest('base64url'));
    // Signature liée au port visé : relayée vers un autre port (Host réécrit), elle ne vaut plus.
    expect(signature).not.toBe(createHmac('sha256', app.key).update(canonicalRequest({ ...parts, host: OTHER_HOST }), 'utf8').digest('base64url'));

    const proof = createHmac('sha256', app.key).update(canonicalProof(CLIENT_ID, NONCE, HOST), 'utf8').digest('base64url');
    expect(await verifyProof(key, CLIENT_ID, NONCE, HOST, proof)).toBe(true);
    expect(await verifyProof(key, CLIENT_ID, NONCE, OTHER_HOST, proof)).toBe(false); // autre port (relais)
    expect(await verifyProof(key, CLIENT_ID, 'AAAAAAAAAAAAAAAAAAAAAA', HOST, proof)).toBe(false); // autre requête
    expect(await verifyProof(key, CLIENT_ID, NONCE, HOST, b64(Buffer.alloc(32, 1)))).toBe(false); // autre clé
    expect(await verifyProof(key, CLIENT_ID, NONCE, HOST, null)).toBe(false);
    expect(await verifyProof(key, CLIENT_ID, NONCE, HOST, 'pas-une-preuve')).toBe(false);
  });

  it('clé HMAC dérivée NON extractible, pour signer et vérifier seulement', async () => {
    const pair = await generateClientKeyPair();
    const app = nodeDerive(pair.publicKey, PAIRING_ID);
    const key = await deriveHmacKey(pair.privateKey, app.connectorPublicKey, PAIRING_ID);
    expect(key.extractable).toBe(false);
    expect(key.type).toBe('secret');
    expect([...key.usages].sort()).toEqual(['sign', 'verify']);
    expect(isNonExtractableHmacKey(key)).toBe(true);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', key)).rejects.toThrow();

    const extractable = await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
    expect(isNonExtractableHmacKey(extractable)).toBe(false);
    expect(isNonExtractableHmacKey({ type: 'secret', extractable: false, algorithm: { name: 'HMAC', hash: { name: 'SHA-256' } }, usages: ['sign'] })).toBe(false);
    expect(isNonExtractableHmacKey(null)).toBe(false);
  });

  it('clé publique du connecteur invalide (format ou point hors courbe) : refusée', async () => {
    const pair = await generateClientKeyPair();
    await expect(deriveHmacKey(pair.privateKey, 'court', PAIRING_ID)).rejects.toThrow();
    await expect(deriveHmacKey(pair.privateKey, b64(Buffer.alloc(65, 7)), PAIRING_ID)).rejects.toThrow();
    const notOnCurve = Buffer.alloc(65, 1);
    notOnCurve[0] = 0x04;
    await expect(deriveHmacKey(pair.privateKey, b64(notOnCurve), PAIRING_ID)).rejects.toThrow();
  });
});
