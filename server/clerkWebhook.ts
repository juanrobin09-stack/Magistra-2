// Webhook Clerk (POST /api/clerk-webhook) : efface les données Magistra d'un compte supprimé chez Clerk
// (évènement « user.deleted »), par exemple depuis « Gérer mon compte ».
//
// Clerk envoie ses webhooks par Svix. Authentification par signature uniquement (jamais par jeton
// de session) :
//   contenu signé = `${svix-id}.${svix-timestamp}.${corps brut}` ;
//   signature     = base64(HMAC-SHA256(clé, contenu signé)), clé = base64 décodé de CLERK_WEBHOOK_SECRET
//                   (format « whsec_<base64> ») ;
//   en-tête svix-signature = une ou plusieurs entrées « v1,<signature> » séparées par des espaces.
// Un message dont l'horodatage s'écarte de plus de 5 minutes est refusé (protection contre le rejeu) ;
// la suppression elle-même est idempotente.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MagistraError } from '../shared/errors.js';

/** Écart maximal (secondes) entre l'horodatage signé et l'heure du serveur. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
/** Taille maximale du corps d'un webhook (octets). */
export const WEBHOOK_BODY_LIMIT = 256 * 1024;

const SECRET_PREFIX = 'whsec_';

/** Clé HMAC décodée depuis CLERK_WEBHOOK_SECRET (« whsec_<base64> ») ; null si le format est invalide. */
export function parseWebhookSecret(raw: string): Uint8Array | null {
  const encoded = raw.startsWith(SECRET_PREFIX) ? raw.slice(SECRET_PREFIX.length) : raw;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length >= 16 ? new Uint8Array(key) : null;
}

/** Signature Svix (base64) d'un message. */
export function signWebhook(key: Uint8Array, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  // Svix envoie « svix-* » ; les en-têtes « webhook-* » (Standard Webhooks) sont équivalents.
  const value = headers[`svix-${name}`] ?? headers[`webhook-${name}`];
  return typeof value === 'string' ? value.trim() : undefined;
}

function invalidSignature(message = 'Signature du webhook invalide.'): MagistraError {
  return new MagistraError('UNAUTHENTICATED', message);
}

/**
 * Vérifie l'authenticité d'un webhook ; lève INVALID_REQUEST (en-têtes absents) ou UNAUTHENTICATED
 * (signature invalide, horodatage hors délai).
 */
export function verifyWebhook(
  key: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  nowSeconds: number,
): void {
  const id = header(headers, 'id');
  const timestamp = header(headers, 'timestamp');
  const signatures = header(headers, 'signature');
  if (!id || !timestamp || !signatures || id.length > 256 || signatures.length > 4_096) {
    throw new MagistraError('INVALID_REQUEST', 'En-têtes de webhook manquants.');
  }
  if (!/^\d{1,12}$/.test(timestamp)) throw invalidSignature();
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    throw invalidSignature('Webhook expiré ou horodatage invalide.');
  }
  const expected = Buffer.from(signWebhook(key, id, timestamp, body), 'base64');
  const valid = signatures.split(/\s+/).some(entry => {
    const comma = entry.indexOf(',');
    if (comma < 0 || entry.slice(0, comma) !== 'v1') return false;
    const candidate = Buffer.from(entry.slice(comma + 1), 'base64');
    // La longueur d'une signature n'est pas secrète ; la comparaison des octets se fait en temps constant.
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!valid) throw invalidSignature();
}
