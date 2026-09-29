// Cryptographie du connecteur local (côté application) : ECDH P-256, HKDF-SHA-256, HMAC-SHA-256, SHA-256,
// base64url sans remplissage et comparaisons à temps constant. Module PUR Node (aucun import d'Electron).
//
// Interopérable avec WebCrypto (navigateur) sur les MÊMES octets :
//   - clé publique ECDH : format brut non compressé 0x04 ‖ X ‖ Y (65 octets), celui de exportKey('raw') ;
//   - secret ECDH : coordonnée X du point partagé (32 octets), celle de deriveBits({ name: 'ECDH' }, …, 256) ;
//   - clé HMAC : HKDF-SHA-256(secret, sel = UTF-8(pairingId), info = UTF-8(CONNECTOR_CRYPTO.hkdfInfo), 32 octets),
//     celle de deriveKey({ name: 'HKDF', … }, …, { name: 'HMAC', hash: 'SHA-256', length: 256 }) ;
//   - signature et preuve : HMAC-SHA-256 de la chaîne canonique (UTF-8), 32 octets en base64url ;
//   - accusé de réception d'appairage : SHA-256 de canonicalPairAck(pairingId, challenge) (UTF-8), en base64url.
//
// Aucune fonction de ce module ne journalise de clé, de secret, de vérificateur ni de signature.

import { createECDH, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalPairAck, CONNECTOR_CRYPTO } from '../../shared/localConnector.js';

/** Longueur d'une clé publique P-256 brute non compressée. */
export const PUBLIC_KEY_BYTES = 65;
/** Longueur d'un HMAC-SHA-256 et d'un SHA-256. */
export const MAC_BYTES = 32;

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Octets → base64url sans remplissage. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url');
}

/**
 * base64url sans remplissage → octets, en mode STRICT : alphabet base64url uniquement, aucune forme non canonique
 * (bits de remplissage non nuls, longueur impossible), longueur décodée exacte si `expectedBytes` est donné.
 * Toute entrée invalide → null (jamais d'exception, jamais de décodage « tolérant » comme Buffer.from).
 */
export function fromBase64Url(text: unknown, expectedBytes?: number): Buffer | null {
  if (typeof text !== 'string' || !B64URL_RE.test(text) || text.length % 4 === 1) return null;
  const bytes = Buffer.from(text, 'base64url');
  // Forme canonique : ré-encoder doit redonner exactement le texte reçu (refuse les bits parasites).
  if (bytes.toString('base64url') !== text) return null;
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) return null;
  return bytes;
}

/** Jeton aléatoire cryptographique de `bytes` octets, en base64url. */
export function randomToken(bytes: number): string {
  return toBase64Url(randomBytes(bytes));
}

/** SHA-256 d'octets ou d'une chaîne (encodée en UTF-8). */
export function sha256(data: string | Uint8Array): Buffer {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest();
}

/** SHA-256 en base64url (empreinte du corps d'une requête signée, défi d'appairage). */
export function sha256Base64Url(data: string | Uint8Array): string {
  return toBase64Url(sha256(data));
}

/**
 * Accusé de réception d'une demande d'appairage (réponses de POST /v1/pair) : prouve au site que CETTE application a
 * reçu l'URL magistra://pair, seule à porter le défi (texte exact du paramètre « challenge »).
 */
export function pairAck(pairingId: string, challenge: string): string {
  return sha256Base64Url(canonicalPairAck(pairingId, challenge));
}

/** HMAC-SHA-256 d'un message texte (UTF-8). */
export function hmacSha256(key: Uint8Array, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest();
}

/** HMAC-SHA-256 en base64url (en-têtes X-Magistra-Signature et X-Magistra-Proof). */
export function hmacBase64Url(key: Uint8Array, message: string): string {
  return toBase64Url(hmacSha256(key, message));
}

/**
 * Égalité à temps constant de deux suites d'octets. Des longueurs différentes rendent faux sans comparer le contenu
 * (la longueur n'est pas secrète : tous les formats comparés ici ont une longueur fixe connue).
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

/**
 * Vérifie une signature HMAC-SHA-256 reçue en base64url sur `message`. Signature mal formée → faux.
 * La comparaison porte sur les octets (à temps constant), jamais sur les textes.
 */
export function verifyHmac(key: Uint8Array, message: string, signature: unknown): boolean {
  const received = fromBase64Url(signature, MAC_BYTES);
  if (!received) return false;
  return constantTimeEqual(hmacSha256(key, message), received);
}

/** Paire ECDH P-256 éphémère du connecteur (une par appairage ; la clé privée n'est jamais exportée ni conservée). */
export interface ConnectorKeyPair {
  /** Clé publique brute non compressée (65 octets). */
  readonly publicKey: Buffer;
  /**
   * Secret partagé avec la clé publique brute du navigateur : coordonnée X (32 octets). Lève si la clé du
   * navigateur n'est pas un point valide de la courbe P-256 (OpenSSL vérifie l'appartenance à la courbe).
   */
  computeSecret(peerPublicKey: Uint8Array): Buffer;
}

export function generateConnectorKeyPair(): ConnectorKeyPair {
  const ecdh = createECDH('prime256v1');
  const publicKey = ecdh.generateKeys();
  return {
    publicKey,
    computeSecret: peer => ecdh.computeSecret(peer),
  };
}

/**
 * Clé publique P-256 reçue du navigateur : 65 octets, préfixe 0x04 (non compressée) ; la validité du point sur la
 * courbe est vérifiée au calcul du secret. Renvoie les octets, ou null si le format est incorrect.
 */
export function parsePublicKey(text: unknown): Buffer | null {
  const bytes = fromBase64Url(text, PUBLIC_KEY_BYTES);
  if (!bytes || bytes[0] !== 0x04) return null;
  return bytes;
}

/** HKDF-SHA-256 : secret ECDH → clé HMAC-SHA-256 (32 octets), sel = UTF-8(pairingId), info = CONNECTOR_CRYPTO.hkdfInfo. */
export function deriveHmacKey(sharedSecret: Uint8Array, pairingId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.from(pairingId, 'utf8'), Buffer.from(CONNECTOR_CRYPTO.hkdfInfo, 'utf8'), CONNECTOR_CRYPTO.keyBytes));
}

/**
 * Fin d'appairage côté connecteur : paire éphémère, secret ECDH avec la clé du navigateur, clé HMAC dérivée.
 * Lève une erreur si la clé du navigateur est invalide (format ou point hors de la courbe).
 */
export function deriveClientKey(clientPublicKey: Uint8Array, pairingId: string): { key: Buffer; connectorPublicKey: string } {
  const pair = generateConnectorKeyPair();
  const secret = pair.computeSecret(clientPublicKey);
  try {
    return { key: deriveHmacKey(secret, pairingId), connectorPublicKey: toBase64Url(pair.publicKey) };
  } finally {
    secret.fill(0);
  }
}
