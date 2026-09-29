// Cryptographie du connecteur local : vecteurs connus, base64url strict, comparaisons, et INTEROPÉRABILITÉ avec
// WebCrypto (globalThis.crypto.subtle de Node, même API que le navigateur) : la clé HMAC dérivée d'un côté par
// ECDH + HKDF (clé NON EXTRACTIBLE côté navigateur) signe exactement comme celle dérivée par l'application.

import { describe, expect, it } from 'vitest';
import { canonicalProof, canonicalRequest, CONNECTOR_CRYPTO, CONNECTOR_FORMATS } from '../../shared/localConnector.js';
import {
  constantTimeEqual, deriveClientKey, deriveHmacKey, fromBase64Url, generateConnectorKeyPair, hmacBase64Url, hmacSha256, parsePublicKey,
  randomToken, sha256, sha256Base64Url, toBase64Url, verifyHmac,
} from '../../electron/connector/crypto.js';

const subtle = globalThis.crypto.subtle;
const utf8 = (text: string) => new TextEncoder().encode(text);
/** Octets décodés, copiés dans un ArrayBuffer ordinaire (type BufferSource attendu par WebCrypto). */
const decoded = (text: string, bytes: number) => Uint8Array.from(fromBase64Url(text, bytes)!);

/** Côté navigateur, exactement comme le site : paire ECDH dont la clé privée n'est PAS extractible. */
async function browserKeyPair() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  return { pair, publicRaw };
}

/** deriveBits → HKDF → clé HMAC-SHA-256 non extractible (celle que le site conserve en IndexedDB). */
async function browserHmacKey(privateKey: CryptoKey, connectorPublicKey: string, pairingId: string): Promise<CryptoKey> {
  const peer = await subtle.importKey('raw', decoded(connectorPublicKey, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(pairingId), info: utf8(CONNECTOR_CRYPTO.hkdfInfo) },
    hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

describe('base64url strict', () => {
  it('encode sans remplissage et relit exactement', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01]);
    const text = toBase64Url(bytes);
    expect(text).toBe('-_-_AAE');
    expect([...fromBase64Url(text, 5)!]).toEqual([...bytes]);
    // Vue partielle d'un tampon : seuls les octets de la vue sont encodés.
    const view = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5);
    expect(toBase64Url(view)).toBe(toBase64Url(new Uint8Array([1, 2, 3])));
  });

  it('refuse remplissage, alphabet base64 classique, longueur impossible, forme non canonique, mauvaise taille', () => {
    expect(fromBase64Url('AAE=')).toBeNull();
    expect(fromBase64Url('+/+/')).toBeNull();
    expect(fromBase64Url('A')).toBeNull();
    expect(fromBase64Url('AB')).toBeNull(); // bits de remplissage non nuls
    expect(fromBase64Url('AA')).not.toBeNull();
    expect(fromBase64Url('AAAA', 2)).toBeNull();
    expect(fromBase64Url('AA AA')).toBeNull();
    expect(fromBase64Url(42)).toBeNull();
    expect(fromBase64Url(undefined)).toBeNull();
  });

  it('jetons aléatoires aux formats du protocole', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomToken(16)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(CONNECTOR_FORMATS.clientId.test(id)).toBe(true);
    expect(CONNECTOR_FORMATS.verifier.test(randomToken(32))).toBe(true);
  });
});

describe('empreintes et HMAC', () => {
  it('SHA-256 : vecteur connu (« abc ») et corps vide', () => {
    expect(sha256('abc').toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Base64Url('')).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
    expect(sha256Base64Url(utf8('é'))).toBe(sha256Base64Url('é'));
  });

  it('HMAC-SHA-256 : vecteur RFC 4231 (cas 2)', () => {
    expect(hmacSha256(utf8('Jefe'), 'what do ya want for nothing?').toString('hex'))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('vérification à temps constant : bonne signature seulement', () => {
    const key = new Uint8Array(32).fill(7);
    const mac = hmacBase64Url(key, 'message');
    expect(CONNECTOR_FORMATS.mac.test(mac)).toBe(true);
    expect(verifyHmac(key, 'message', mac)).toBe(true);
    expect(verifyHmac(key, 'message ', mac)).toBe(false);
    expect(verifyHmac(new Uint8Array(32).fill(8), 'message', mac)).toBe(false);
    expect(verifyHmac(key, 'message', `${mac.slice(0, -1)}A`)).toBe(false);
    expect(verifyHmac(key, 'message', mac.slice(1))).toBe(false);
    expect(verifyHmac(key, 'message', null)).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('ECDH P-256 + HKDF : interopérabilité avec WebCrypto', () => {
  it('le navigateur (WebCrypto) et l’application (node:crypto) dérivent la même clé HMAC', async () => {
    const pairingId = randomToken(16);
    const browser = await browserKeyPair();
    expect(browser.publicRaw).toHaveLength(65);
    expect(browser.publicRaw[0]).toBe(0x04);

    const app = deriveClientKey(parsePublicKey(toBase64Url(browser.publicRaw))!, pairingId);
    expect(app.key).toHaveLength(CONNECTOR_CRYPTO.keyBytes);
    expect(CONNECTOR_FORMATS.publicKey.test(app.connectorPublicKey)).toBe(true);

    const browserKey = await browserHmacKey(browser.pair.privateKey, app.connectorPublicKey, pairingId);
    // Clé non extractible côté navigateur : personne ne peut la lire, même le site.
    expect(browserKey.extractable).toBe(false);
    await expect(subtle.exportKey('raw', browserKey)).rejects.toThrow();

    // Signature d'une requête par le navigateur, vérifiée par l'application…
    const request = canonicalRequest({
      method: 'post', path: '/v1/generate', origin: 'https://magistra-2.vercel.app', clientId: randomToken(16),
      timestamp: String(Date.now()), nonce: randomToken(16), bodySha256: sha256Base64Url('{"sujet":"Les fractions"}'),
    });
    const signature = toBase64Url(new Uint8Array(await subtle.sign('HMAC', browserKey, utf8(request))));
    expect(verifyHmac(app.key, request, signature)).toBe(true);
    expect(hmacBase64Url(app.key, request)).toBe(signature);

    // … et preuve de l'application, vérifiée par le navigateur.
    const proofText = canonicalProof('client', 'nonce');
    const proof = decoded(hmacBase64Url(app.key, proofText), 32);
    expect(await subtle.verify('HMAC', browserKey, proof, utf8(proofText))).toBe(true);
    expect(await subtle.verify('HMAC', browserKey, proof, utf8(canonicalProof('client', 'autre')))).toBe(false);
  });

  it('HKDF : mêmes octets que WebCrypto (sel = UTF-8 de pairingId, info du protocole)', async () => {
    const secret = new Uint8Array(32).map((_, i) => i * 7);
    const pairingId = 'AAECAwQFBgcICQoLDA0ODw';
    const hkdf = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: utf8(pairingId), info: utf8(CONNECTOR_CRYPTO.hkdfInfo) }, hkdf, 256,
    ));
    expect(toBase64Url(deriveHmacKey(secret, pairingId))).toBe(toBase64Url(bits));
    // Un autre identifiant d'appairage donne une autre clé.
    expect(toBase64Url(deriveHmacKey(secret, 'BAECAwQFBgcICQoLDA0ODw'))).not.toBe(toBase64Url(bits));
  });

  it('chaque appairage a sa propre paire éphémère (clés publiques différentes)', () => {
    const a = generateConnectorKeyPair();
    const b = generateConnectorKeyPair();
    expect(a.publicKey).toHaveLength(65);
    expect(a.publicKey.equals(b.publicKey)).toBe(false);
  });

  it('clé publique du navigateur invalide : format refusé, point hors de la courbe refusé', async () => {
    const { publicRaw } = await browserKeyPair();
    expect(parsePublicKey(toBase64Url(publicRaw))).not.toBeNull();
    // Forme compressée (33 octets), mauvais préfixe, mauvaise taille.
    expect(parsePublicKey(toBase64Url(publicRaw.subarray(0, 33)))).toBeNull();
    const wrongPrefix = Uint8Array.from(publicRaw);
    wrongPrefix[0] = 0x02;
    expect(parsePublicKey(toBase64Url(wrongPrefix))).toBeNull();
    expect(parsePublicKey('pas-une-cle')).toBeNull();
    // Point hors de la courbe : Y modifié.
    const offCurve = Uint8Array.from(publicRaw);
    offCurve[64] ^= 0x01;
    expect(() => deriveClientKey(parsePublicKey(toBase64Url(offCurve))!, randomToken(16))).toThrow();
  });
});
