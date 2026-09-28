// Validation des identifiants manipulés par le serveur.

import { MagistraError } from '../shared/errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identifiants Clerk (« user_2RfWKJ… ») : bornés, sans caractère de contrôle ni séparateur d'URL. */
const USER_ID_PATTERN = /^[A-Za-z0-9_\-.:|@]{1,191}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Valide un identifiant de contenu (UUID) ; lève INVALID_REQUEST sinon. */
export function requireUuid(value: unknown): string {
  if (!isUuid(value)) throw new MagistraError('INVALID_REQUEST', 'Identifiant de contenu invalide.');
  return value.toLowerCase();
}

export function isValidUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_PATTERN.test(value);
}

/** Garde-fou : un identifiant d'utilisateur provient toujours d'un jeton vérifié. */
export function requireUserId(value: unknown): string {
  if (!isValidUserId(value)) throw new MagistraError('UNAUTHENTICATED');
  return value;
}
