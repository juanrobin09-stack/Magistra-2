// Cryptographie du connecteur local côté NAVIGATEUR (WebCrypto) : ECDH P-256, HKDF-SHA-256, HMAC-SHA-256, SHA-256,
// base64url sans remplissage. Interopérable octet pour octet avec electron/connector/crypto.ts (node:crypto) :
//   - clé publique ECDH : format brut non compressé 0x04 ‖ X ‖ Y (65 octets), exportKey('raw') ;
//   - secret ECDH : coordonnée X du point partagé (32 octets), deriveBits({ name: 'ECDH' }, …, 256) ;
//   - clé HMAC : HKDF-SHA-256(secret, sel = UTF-8(pairingId), info = UTF-8(CONNECTOR_CRYPTO.hkdfInfo), 32 octets) ;
//   - signature et preuve : HMAC-SHA-256 de la chaîne canonique (UTF-8), 32 octets en base64url ;
//   - défi d'appairage : SHA-256 des 32 OCTETS du vérificateur (et non de son texte base64url), en base64url.
//
// Aucune clé ne sort jamais du navigateur : la clé privée ECDH et la clé HMAC sont NON EXTRACTIBLES (le script de la
// page lui-même ne peut pas en lire les octets) ; seule la clé HMAC est conservée (IndexedDB, clone d'un CryptoKey).
// Aucune fonction de ce module ne journalise de clé, de vérificateur, de signature ni de preuve.

import { canonicalProof, canonicalRequest, CONNECTOR_CRYPTO, CONNECTOR_FORMATS, type CanonicalRequestParts } from '@shared/localConnector';

/** Clé publique P-256 brute non compressée. */
export const PUBLIC_KEY_BYTES = 65;
/** HMAC-SHA-256 et SHA-256. */
export const MAC_BYTES = 32;
/** Identifiant de demande d'appairage. */
export const PAIRING_ID_BYTES = 16;
/** Vérificateur d'appairage (secret du navigateur, envoyé uniquement dans le corps de POST /v1/pair). */
export const VERIFIER_BYTES = 32;
/** Nonce de requête signée. */
export const NONCE_BYTES = 16;

const B64URL_RE = /^[A-Za-z0-9_-]*$/;
const encoder = new TextEncoder();

/** WebCrypto utilisable (contexte sécurisé : https, ou http sur la boucle locale en développement). */
export function isWebCryptoAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.generateKey === 'function' && typeof globalThis.crypto.getRandomValues === 'function';
}

function subtle(): SubtleCrypto {
  if (!isWebCryptoAvailable()) throw new Error('WebCrypto indisponible');
  return globalThis.crypto.subtle;
}

/** Texte → octets UTF-8. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

// ─── base64url ──────────────────────────────────────────────────────────────

/** Octets → base64url sans remplissage. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url sans remplissage → octets, en mode STRICT : alphabet base64url uniquement, forme canonique (aucun bit de
 * remplissage parasite, aucune longueur impossible), longueur décodée exacte si `expectedBytes` est donné.
 * Entrée invalide → null (jamais d'exception, jamais de décodage « tolérant »).
 */
export function fromBase64Url(text: unknown, expectedBytes?: number): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || !B64URL_RE.test(text) || text.length % 4 === 1) return null;
  let binary: string;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Forme canonique : ré-encoder doit redonner exactement le texte reçu.
  if (toBase64Url(bytes) !== text) return null;
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) return null;
  return bytes;
}

// ─── Aléa, empreintes ───────────────────────────────────────────────────────

/** Octets aléatoires cryptographiques. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!isWebCryptoAvailable()) throw new Error('WebCrypto indisponible');
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Jeton aléatoire cryptographique de `length` octets, en base64url. */
export function randomToken(length: number): string {
  return toBase64Url(randomBytes(length));
}

/** SHA-256 d'octets ou d'une chaîne (encodée en UTF-8). */
export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/** SHA-256 en base64url (empreinte du corps d'une requête signée). */
export async function sha256Base64Url(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return toBase64Url(await sha256(data));
}

// ─── Appairage ──────────────────────────────────────────────────────────────

export interface PairingSecrets {
  /** Identifiant de la demande (16 octets) : dans l'URL magistra://pair et dans le corps de POST /v1/pair. */
  pairingId: string;
  /** Secret (32 octets) : JAMAIS dans une URL, uniquement dans le corps de POST /v1/pair. */
  verifier: string;
  /** SHA-256 des octets du vérificateur : seul l'engagement voyage dans l'URL magistra://pair. */
  challenge: string;
}

/** Tire une demande d'appairage : identifiant, vérificateur secret et défi (engagement sur le vérificateur). */
export async function createPairingSecrets(): Promise<PairingSecrets> {
  const verifierBytes = randomBytes(VERIFIER_BYTES);
  const challenge = toBase64Url(await sha256(verifierBytes));
  return { pairingId: randomToken(PAIRING_ID_BYTES), verifier: toBase64Url(verifierBytes), challenge };
}

export interface ClientKeyPair {
  /** Clé privée ECDH P-256 NON EXTRACTIBLE (dérivation seulement). */
  privateKey: CryptoKey;
  /** Clé publique brute non compressée (65 octets), en base64url : envoyée au connecteur. */
  publicKey: string;
}

/** Paire ECDH P-256 éphémère du navigateur (une par appairage) ; la clé privée n'est jamais exportable. */
export async function generateClientKeyPair(): Promise<ClientKeyPair> {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: CONNECTOR_CRYPTO.curve }, false, ['deriveBits']);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toBase64Url(raw) };
}

/**
 * Fin d'appairage côté navigateur : secret ECDH avec la clé publique du connecteur, puis clé HMAC-SHA-256 dérivée par
 * HKDF (sel = pairingId). La clé obtenue est NON EXTRACTIBLE, utilisable pour signer et vérifier seulement.
 * Lève une erreur si la clé du connecteur est mal formée ou n'est pas un point de la courbe P-256.
 */
export async function deriveHmacKey(privateKey: CryptoKey, connectorPublicKey: string, pairingId: string): Promise<CryptoKey> {
  const peerBytes = fromBase64Url(connectorPublicKey, PUBLIC_KEY_BYTES);
  if (!peerBytes || peerBytes[0] !== 0x04) throw new TypeError('Clé publique du connecteur invalide.');
  const s = subtle();
  // L'import vérifie que le point appartient à la courbe (sinon : exception).
  const peer = await s.importKey('raw', peerBytes, { name: 'ECDH', namedCurve: CONNECTOR_CRYPTO.curve }, false, []);
  const secret = new Uint8Array(await s.deriveBits({ name: 'ECDH', public: peer }, privateKey, CONNECTOR_CRYPTO.keyBytes * 8));
  try {
    const material = await s.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return await s.deriveKey(
      { name: 'HKDF', hash: CONNECTOR_CRYPTO.hash, salt: utf8(pairingId), info: utf8(CONNECTOR_CRYPTO.hkdfInfo) },
      material,
      { name: 'HMAC', hash: CONNECTOR_CRYPTO.hash, length: CONNECTOR_CRYPTO.keyBytes * 8 },
      false,
      ['sign', 'verify'],
    );
  } finally {
    // Le secret ECDH ne sert plus : effacé de la mémoire accessible au script (au mieux).
    secret.fill(0);
  }
}

/**
 * Clé HMAC utilisable par le connecteur local : secrète, HMAC, NON extractible, pour signer et vérifier.
 * Refuse toute autre forme (clé relue d'IndexedDB altérée ou d'une ancienne version).
 */
export function isNonExtractableHmacKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false;
  const key = value as Partial<CryptoKey>;
  const algorithm = key.algorithm as Partial<HmacKeyAlgorithm> | undefined;
  return key.type === 'secret'
    && key.extractable === false
    && algorithm?.name === 'HMAC'
    && algorithm.hash?.name === CONNECTOR_CRYPTO.hash
    && Array.isArray(key.usages) && key.usages.includes('sign') && key.usages.includes('verify');
}

// ─── Signatures ─────────────────────────────────────────────────────────────

/** HMAC-SHA-256 d'un message texte (UTF-8), en base64url. */
export async function hmacSign(key: CryptoKey, message: string): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().sign('HMAC', key, utf8(message))));
}

/**
 * Vérifie un HMAC-SHA-256 reçu en base64url. Valeur mal formée → faux. La comparaison est faite par WebCrypto
 * (subtle.verify), sur les octets, jamais sur les textes.
 */
export async function hmacVerify(key: CryptoKey, message: string, mac: unknown): Promise<boolean> {
  const bytes = fromBase64Url(mac, MAC_BYTES);
  if (!bytes) return false;
  try {
    return await subtle().verify('HMAC', key, bytes, utf8(message));
  } catch {
    return false;
  }
}

/** X-Magistra-Signature d'une requête authentifiée. */
export function signRequest(key: CryptoKey, parts: CanonicalRequestParts): Promise<string> {
  return hmacSign(key, canonicalRequest(parts));
}

/**
 * X-Magistra-Proof de la réponse : le connecteur prouve qu'il détient la clé de CE navigateur, pour CETTE requête
 * (nonce). Absente, mal formée ou fausse → faux : la réponse ne vient pas de l'application Magistra appairée.
 */
export async function verifyProof(key: CryptoKey, clientId: string, nonce: string, proof: string | null): Promise<boolean> {
  if (!proof || !CONNECTOR_FORMATS.mac.test(proof)) return false;
  return hmacVerify(key, canonicalProof(clientId, nonce), proof);
}
