// Authentification : l'identité de l'utilisateur est TOUJOURS déduite du jeton de session Clerk
// vérifié côté serveur (claim « sub »). Aucun identifiant envoyé par le navigateur (corps, paramètre
// d'URL, en-tête personnalisé) n'est jamais pris en compte.

import { verifyToken } from '@clerk/backend';
import { isMagistraError, MagistraError } from '../shared/errors.js';
import type { ClerkConfig } from './config.js';
import { isValidUserId } from './ids.js';

/**
 * Vérifie un jeton et renvoie l'identifiant de l'utilisateur.
 * Lève une MagistraError (UNAUTHENTICATED, ou SERVER_MISCONFIGURED si la vérification est impossible).
 * Injectable : les tests fournissent un vérificateur factice.
 */
export type TokenVerifier = (token: string) => Promise<string>;

const MAX_TOKEN_LENGTH = 16_384;

/** Extrait le jeton d'un en-tête « Authorization: Bearer … ». */
export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ \t]+([A-Za-z0-9\-_.~+/=]+)[ \t]*$/i.exec(header);
  if (!match) return null;
  const token = match[1];
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Raisons d'échec imputables à la configuration du serveur, pas à l'utilisateur. */
const SERVER_SIDE_REASONS = new Set([
  'secret-key-invalid',
  'jwk-local-missing',
  'jwk-remote-failed-to-load',
  'jwk-remote-invalid',
  'jwk-failed-to-resolve',
]);

/** Algorithmes de signature acceptés (Clerk signe en RSA ; « none » et HS* sont refusés). */
const ALLOWED_ALGS = new Set(['RS256', 'RS384', 'RS512']);
/** Forme d'un identifiant de clé Clerk (« ins_… »). */
const CLERK_KID = /^ins_[A-Za-z0-9]{8,64}$/;
/** Au plus un rechargement des clés publiques par minute pour un identifiant de clé inconnu. */
const UNKNOWN_KID_INTERVAL_MS = 60_000;

/** Lit l'en-tête d'un JWT sans le vérifier (filtrage préalable, avant tout appel réseau). */
export function readJwtHeader(token: string): { alg?: string; kid?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || parts[0].length > 1_024) return null;
  try {
    const json = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const header = JSON.parse(json) as unknown;
    if (!header || typeof header !== 'object') return null;
    const h = header as { alg?: unknown; kid?: unknown };
    return {
      alg: typeof h.alg === 'string' ? h.alg : undefined,
      kid: typeof h.kid === 'string' ? h.kid : undefined,
    };
  } catch {
    return null;
  }
}

export interface ClerkVerifierDeps {
  verify?: typeof verifyToken;
  now?: () => number;
}

export function createClerkVerifier(config: ClerkConfig, deps: ClerkVerifierDeps = {}): TokenVerifier {
  const verify = deps.verify ?? verifyToken;
  const now = deps.now ?? (() => Date.now());
  // Protection contre l'amplification : sans clé publique locale (CLERK_JWT_KEY), chaque identifiant
  // de clé inconnu provoquerait un appel à l'API Clerk. On ne l'autorise qu'une fois par minute.
  // Le créneau n'est consommé que pour un identifiant que Clerk ne connaît pas (« jwk-failed-to-resolve ») : un
  // jeton valide n'est jamais refusé à cause d'un autre jeton (démarrage à froid avec plusieurs requêtes
  // simultanées, jeton expiré ou panne passagère de l'API Clerk juste avant).
  const knownKids = new Set<string>();
  let lastUnknownKidLookup = Number.NEGATIVE_INFINITY;
  /** Vérification en cours par identifiant de clé : les autres demandes du même identifiant l'attendent. */
  const inflight = new Map<string, Promise<void>>();

  return async token => {
    const header = readJwtHeader(token);
    if (!header || !header.alg || !ALLOWED_ALGS.has(header.alg)) throw new MagistraError('UNAUTHENTICATED');
    const remote = !config.jwtKey;
    /** Libère le créneau pris pour un identifiant inconnu (keepLock : il reste consommé jusqu'à la prochaine minute). */
    let settle: ((keepLock: boolean) => void) | undefined;
    if (remote) {
      const kid = header.kid;
      if (!kid || !CLERK_KID.test(kid)) throw new MagistraError('UNAUTHENTICATED');
      for (;;) {
        if (knownKids.has(kid)) break;
        const other = inflight.get(kid);
        if (other) {
          // Même identifiant déjà en cours de vérification : on attend son résultat (aucun appel Clerk de plus).
          await other;
          continue;
        }
        if (now() - lastUnknownKidLookup < UNKNOWN_KID_INTERVAL_MS) throw new MagistraError('UNAUTHENTICATED');
        const previous = lastUnknownKidLookup;
        lastUnknownKidLookup = now();
        let done!: () => void;
        const pending = new Promise<void>(resolve => {
          done = resolve;
        });
        inflight.set(kid, pending);
        settle = keepLock => {
          if (!keepLock) lastUnknownKidLookup = previous;
          if (inflight.get(kid) === pending) inflight.delete(kid);
          done();
        };
        break;
      }
    }
    let payload: Record<string, unknown>;
    try {
      payload = (await verify(token, {
        secretKey: config.secretKey,
        jwtKey: config.jwtKey,
        authorizedParties: config.authorizedParties,
      })) as Record<string, unknown>;
      if (remote && header.kid) knownKids.add(header.kid);
      settle?.(true);
    } catch (err) {
      const reason = (err as { reason?: unknown } | null)?.reason;
      // Jeton expiré, signature invalide, panne passagère de l'API Clerk : la vraie clé ne doit pas être verrouillée.
      settle?.(reason === 'jwk-failed-to-resolve');
      if (typeof reason === 'string' && SERVER_SIDE_REASONS.has(reason)) {
        if (reason === 'jwk-remote-failed-to-load') {
          throw new MagistraError('INTERNAL', 'Vérification de la session momentanément impossible. Réessayez.', { cause: err });
        }
        if (reason === 'jwk-failed-to-resolve') throw new MagistraError('UNAUTHENTICATED', undefined, { cause: err });
        throw new MagistraError('SERVER_MISCONFIGURED', undefined, { cause: err });
      }
      throw new MagistraError('UNAUTHENTICATED', undefined, { cause: err });
    }
    // Session en attente (tâche Clerk non terminée) : considérée comme non connectée.
    if (payload.sts !== undefined && payload.sts !== 'active') throw new MagistraError('UNAUTHENTICATED');
    if (!isValidUserId(payload.sub)) throw new MagistraError('UNAUTHENTICATED');
    return payload.sub;
  };
}

/** Authentifie une requête à partir de ses en-têtes ; renvoie l'identifiant vérifié. */
export async function authenticate(
  headers: Record<string, string | string[] | undefined>,
  verifier: TokenVerifier,
): Promise<string> {
  const token = extractBearerToken(headers.authorization);
  if (!token) throw new MagistraError('UNAUTHENTICATED');
  let userId: string;
  try {
    userId = await verifier(token);
  } catch (err) {
    if (isMagistraError(err)) throw err;
    throw new MagistraError('UNAUTHENTICATED', undefined, { cause: err });
  }
  if (!isValidUserId(userId)) throw new MagistraError('UNAUTHENTICATED');
  return userId;
}
