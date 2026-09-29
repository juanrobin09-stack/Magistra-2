// Connecteur local Magistra : protocole entre le SITE WEB officiel (navigateur) et l'APPLICATION WINDOWS.
//
//   site web ──HTTP boucle locale, requêtes signées──▶ connecteur (application Windows) ──▶ moteur IA ──▶ modèle
//
// Le navigateur n'obtient JAMAIS d'accès à Ollama : le connecteur n'expose qu'un petit nombre de routes Magistra
// (présence, état, génération en flux, arrêt, appairage) ; il ne relaie aucune autre requête.
//
// Module partagé par le navigateur (src/lib/localConnector) et l'application (electron/connector) : constantes,
// formats et chaînes canoniques seulement, sans dépendance Node ni DOM. La cryptographie est faite de chaque côté
// (WebCrypto dans le navigateur, node:crypto dans l'application) sur les chaînes définies ici.
//
// Appairage (aucun secret de longue durée dans une adresse) :
//   1. le site tire `pairingId` (16 octets) et `verifier` (32 octets), calcule `challenge` = SHA-256(verifier) et ouvre
//      magistra://pair?v=1&id=<pairingId>&challenge=<challenge>&origin=<origine du site> ;
//   2. l'application vérifie que l'origine fait partie des origines officielles, puis demande l'accord de l'enseignant ;
//   3. le site envoie POST /v1/pair { pairingId, verifier, clientPublicKey } (clé publique ECDH P-256 d'une paire
//      générée NON EXTRACTIBLE dans le navigateur) ; le connecteur vérifie SHA-256(verifier) = challenge, l'en-tête
//      Origin (= origine de la demande), l'accord donné et le délai, puis répond { clientId, connectorPublicKey } ;
//   4. chaque côté calcule le secret ECDH puis la clé HMAC-SHA-256 par HKDF (sel = pairingId, info = HKDF_INFO) :
//      la clé n'a jamais circulé ; dans le navigateur elle est NON EXTRACTIBLE (IndexedDB), dans l'application elle
//      est chiffrée par le système (DPAPI sous Windows).
//
// Requêtes authentifiées : en-têtes X-Magistra-Client / -Timestamp / -Nonce / -Signature, avec
// Signature = HMAC(clé, canonicalRequest(...)). Le connecteur prouve à son tour qu'il détient la clé :
// X-Magistra-Proof = HMAC(clé, canonicalProof(...)) — un autre programme qui occuperait le port ne peut pas se faire
// passer pour Magistra.
//
// Encodage de tous les octets : base64url sans remplissage.

import type { AINotice, Capabilities } from './types.js';

export const CONNECTOR_PROTOCOL_VERSION = 1;

/** Adresse d'écoute : boucle locale IPv4 uniquement (jamais 0.0.0.0, jamais le réseau). */
export const CONNECTOR_HOST = '127.0.0.1';

/**
 * Ports dédiés, essayés dans cet ordre par l'application (le premier libre) et par le site (recherche). Aucune adresse
 * n'est jamais affichée ni saisie : le site les connaît, l'application les ouvre seule.
 */
export const CONNECTOR_PORTS: readonly number[] = [47831, 47832, 47833];

/**
 * Origines officielles du site Magistra : les SEULES autorisées à appairer et à utiliser le connecteur de
 * l'application installée. Une origine absente de cette liste est refusée (aucune réponse lisible, aucun appairage).
 * Nom de domaine personnalisé : l'ajouter ici, puis publier une nouvelle version de l'application.
 */
export const OFFICIAL_WEB_ORIGINS: readonly string[] = ['https://magistra-2.vercel.app'];

/** Schéma d'URL enregistré par l'installateur Windows (ouvre l'application depuis le site). */
export const CONNECTOR_URL_SCHEME = 'magistra';
/** Ouvre (ou met au premier plan) l'application, sans rien demander d'autre. */
export const OPEN_APP_URL = 'magistra://open';

export const CONNECTOR_ROUTES = {
  /** GET, sans authentification (origine officielle exigée) : présence de Magistra. */
  hello: '/v1/hello',
  /** POST : fin d'appairage (vérificateur) ; DELETE (signé) : ce navigateur retire sa propre autorisation. */
  pair: '/v1/pair',
  /** GET, signé : état du moteur et capacités. */
  status: '/v1/status',
  /** POST, signé : génération en flux NDJSON (GenerationEvent par ligne). */
  generate: '/v1/generate',
  /** POST, signé : arrêt d'une génération de ce navigateur. */
  cancel: '/v1/cancel',
} as const;

export type ConnectorRoute = (typeof CONNECTOR_ROUTES)[keyof typeof CONNECTOR_ROUTES];

/** Méthodes autorisées par route (toute autre méthode : 405 ; toute autre route : 404). */
export const CONNECTOR_ROUTE_METHODS: Readonly<Record<ConnectorRoute, readonly string[]>> = {
  [CONNECTOR_ROUTES.hello]: ['GET'],
  [CONNECTOR_ROUTES.pair]: ['POST', 'DELETE'],
  [CONNECTOR_ROUTES.status]: ['GET'],
  [CONNECTOR_ROUTES.generate]: ['POST'],
  [CONNECTOR_ROUTES.cancel]: ['POST'],
};

/** Routes qui exigent une requête signée (méthode comprise). */
export function isSignedRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (path === CONNECTOR_ROUTES.pair) return m === 'DELETE';
  return path === CONNECTOR_ROUTES.status || path === CONNECTOR_ROUTES.generate || path === CONNECTOR_ROUTES.cancel;
}

export const CONNECTOR_HEADERS = {
  client: 'X-Magistra-Client',
  timestamp: 'X-Magistra-Timestamp',
  nonce: 'X-Magistra-Nonce',
  signature: 'X-Magistra-Signature',
  /** Réponse : preuve que le connecteur détient la clé de ce navigateur. */
  proof: 'X-Magistra-Proof',
  /** Réponse de /v1/generate : identifiant de la génération (pour /v1/cancel). */
  job: 'X-Magistra-Job',
} as const;

/** En-têtes de requête autorisés en CORS (en plus des en-têtes simples). */
export const CONNECTOR_ALLOWED_REQUEST_HEADERS: readonly string[] = [
  'Content-Type', CONNECTOR_HEADERS.client, CONNECTOR_HEADERS.timestamp, CONNECTOR_HEADERS.nonce, CONNECTOR_HEADERS.signature,
];
/** En-têtes de réponse lisibles par le site. */
export const CONNECTOR_EXPOSED_RESPONSE_HEADERS: readonly string[] = [CONNECTOR_HEADERS.proof, CONNECTOR_HEADERS.job];

export const CONNECTOR_LIMITS = {
  /** Corps de /v1/generate (demande + extraits de documents) : REQUEST_LIMITS.bodyBytes plus une marge. */
  generateBodyBytes: 1_100_000,
  /** Corps des autres routes (appairage, arrêt). */
  smallBodyBytes: 4_096,
  /** Écart toléré entre l'horloge du navigateur et celle de l'application (même ordinateur). */
  clockSkewMs: 120_000,
  /** Durée de vie d'une demande d'appairage (de l'ouverture de magistra://pair à la fin de l'appairage). */
  pairingTtlMs: 5 * 60_000,
  /** Essais de vérificateur tolérés par demande d'appairage (au-delà : demande annulée). */
  maxVerifierAttempts: 5,
  /** Navigateurs appairés au plus (au-delà : le plus ancien est retiré). */
  maxClients: 10,
  /** Échecs d'authentification tolérés par minute avant blocage temporaire (429). */
  maxAuthFailuresPerMinute: 30,
  /** Longueur maximale d'une URL magistra:// acceptée. */
  maxUrlLength: 1_024,
} as const;

// ─── Formats ────────────────────────────────────────────────────────────────

/** base64url sans remplissage de n octets : longueur exacte ceil(4n/3). */
function b64urlPattern(bytes: number): RegExp {
  return new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`);
}

export const CONNECTOR_FORMATS = {
  /** Identifiant de demande d'appairage : 16 octets. */
  pairingId: b64urlPattern(16),
  /** Vérificateur (secret du navigateur, jamais dans une URL) : 32 octets. */
  verifier: b64urlPattern(32),
  /** SHA-256 du vérificateur : 32 octets. */
  challenge: b64urlPattern(32),
  /** Identifiant d'un navigateur appairé (attribué par le connecteur) : 16 octets. */
  clientId: b64urlPattern(16),
  /** Nonce de requête : 16 octets. */
  nonce: b64urlPattern(16),
  /** HMAC-SHA-256 (signature, preuve) : 32 octets. */
  mac: b64urlPattern(32),
  /** Clé publique ECDH P-256 au format brut non compressé (0x04 ‖ X ‖ Y) : 65 octets. */
  publicKey: b64urlPattern(65),
  /** Horodatage en millisecondes (entier décimal). */
  timestamp: /^\d{13}$/,
  /** Identifiant de génération (UUID). */
  jobId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
} as const;

/** Algorithme ECDH et paramètres HKDF → clé HMAC-SHA-256 de 32 octets. */
export const CONNECTOR_CRYPTO = {
  curve: 'P-256',
  hash: 'SHA-256',
  hkdfInfo: 'magistra-connector-v1 hmac-sha256',
  keyBytes: 32,
} as const;

const CANONICAL_PREFIX = 'MAGISTRA-CONNECTOR-1';

export interface CanonicalRequestParts {
  method: string;
  /** Chemin exact de la route (sans requête ni fragment), par exemple « /v1/status ». */
  path: string;
  /** Origine du site (en-tête Origin) : la signature ne vaut que pour elle. */
  origin: string;
  clientId: string;
  timestamp: string;
  nonce: string;
  /** SHA-256 du corps exact envoyé (octets UTF-8), en base64url ; corps vide : SHA-256 de la chaîne vide. */
  bodySha256: string;
}

/** Chaîne signée par le navigateur pour chaque requête authentifiée. */
export function canonicalRequest(p: CanonicalRequestParts): string {
  return [CANONICAL_PREFIX, p.method.toUpperCase(), p.path, p.origin, p.clientId, p.timestamp, p.nonce, p.bodySha256].join('\n');
}

/** Chaîne signée par le connecteur dans X-Magistra-Proof (réponse à la requête portant ce nonce). */
export function canonicalProof(clientId: string, nonce: string): string {
  return [`${CANONICAL_PREFIX}-PROOF`, clientId, nonce].join('\n');
}

// ─── URL magistra:// ────────────────────────────────────────────────────────

export interface PairingUrlParams {
  pairingId: string;
  challenge: string;
  /** Origine officielle qui demande l'appairage (vérifiée à nouveau sur l'en-tête Origin de POST /v1/pair). */
  origin: string;
}

export type ParsedAppUrl = ({ kind: 'pair' } & PairingUrlParams) | { kind: 'open' };

export function buildPairingUrl(p: PairingUrlParams): string {
  const q = new URLSearchParams({ v: String(CONNECTOR_PROTOCOL_VERSION), id: p.pairingId, challenge: p.challenge, origin: p.origin });
  return `${CONNECTOR_URL_SCHEME}://pair?${q.toString()}`;
}

/** Origine https exacte (schéma://hôte[:port], sans chemin), ou origine de développement http sur la boucle locale. */
export function isWellFormedOrigin(value: string): boolean {
  if (value.length > 200) return false;
  try {
    const u = new URL(value);
    if (u.origin !== value) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Analyse STRICTE d'une URL magistra:// reçue par l'application (ligne de commande, deuxième instance, macOS).
 * Toute forme inattendue (autre action, paramètre inconnu ou en double, format invalide) → null : rien n'est fait.
 * L'origine n'est ici que bien formée ; son appartenance aux origines officielles est vérifiée par l'application.
 */
export function parseAppUrl(raw: unknown): ParsedAppUrl | null {
  if (typeof raw !== 'string' || raw.length > CONNECTOR_LIMITS.maxUrlLength) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${CONNECTOR_URL_SCHEME}:` || u.username || u.password || u.port || u.hash) return null;
  // Windows ajoute parfois une barre oblique finale (« magistra://open/ »).
  if (u.pathname !== '' && u.pathname !== '/') return null;
  const action = u.hostname.toLowerCase();
  const keys = [...u.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  if (action === 'open') return keys.length === 0 ? { kind: 'open' } : null;
  if (action !== 'pair') return null;
  const expected = ['challenge', 'id', 'origin', 'v'];
  if (keys.length !== expected.length || [...keys].sort().join() !== expected.join()) return null;
  const v = u.searchParams.get('v');
  const pairingId = u.searchParams.get('id') ?? '';
  const challenge = u.searchParams.get('challenge') ?? '';
  const origin = u.searchParams.get('origin') ?? '';
  if (v !== String(CONNECTOR_PROTOCOL_VERSION)) return null;
  if (!CONNECTOR_FORMATS.pairingId.test(pairingId) || !CONNECTOR_FORMATS.challenge.test(challenge)) return null;
  if (!isWellFormedOrigin(origin)) return null;
  return { kind: 'pair', pairingId, challenge, origin };
}

/** Nom d'hôte affiché à l'enseignant (« magistra-2.vercel.app ») : jamais d'adresse de la boucle locale côté site. */
export function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

// ─── Corps des requêtes et réponses ─────────────────────────────────────────

/** GET /v1/hello (origine officielle seulement). Aucune configuration, aucun chemin, aucune adresse. */
export interface ConnectorHello {
  app: 'magistra';
  protocol: typeof CONNECTOR_PROTOCOL_VERSION;
  /** Version de l'application Magistra installée. */
  version: string;
}

/** POST /v1/pair */
export interface PairCompleteRequest {
  pairingId: string;
  verifier: string;
  /** Clé publique ECDH P-256 du navigateur (brute, non compressée, base64url). */
  clientPublicKey: string;
}

/**
 * Réponse de POST /v1/pair :
 *  - 202 { status: 'pending' } : l'enseignant n'a pas encore répondu dans l'application (le site réessaie) ;
 *  - 200 { status: 'approved', … } : appairage terminé ;
 *  - 403 CONNECTOR_PAIRING_REFUSED, 410 CONNECTOR_PAIRING_EXPIRED, 404 NOT_FOUND (demande inconnue ou épuisée),
 *    401 UNAUTHENTICATED (vérificateur faux), 403 FORBIDDEN (origine différente de celle de la demande).
 */
export type PairCompleteResponse =
  | { status: 'pending' }
  | { status: 'approved'; clientId: string; connectorPublicKey: string; version: string };

/** GET /v1/status (signé). Jamais d'adresse, de port, de chemin ni de réglage du moteur. */
export interface ConnectorStatus {
  version: string;
  engine: {
    /** Une génération peut être lancée (moteur installé, modèle présent ; le moteur arrêté est démarré à la demande). */
    ready: boolean;
    /**
     * Vrai si le moteur actif de l'application est sur cet ordinateur. Faux : l'application est réglée sur un serveur
     * distant ; le connecteur refuse alors de générer (LOCAL_ENGINE_REMOTE) — jamais de relais silencieux vers un tiers.
     */
    local: boolean;
    /** Nom du modèle affiché (« Magistra Standard »…). */
    label: string;
    notReady?: AINotice;
    warning?: AINotice;
  };
  capabilities: Pick<Capabilities, 'maxDocumentChars' | 'research'>;
  /** Une génération est déjà en cours dans l'application (fenêtre ou site). */
  busy: boolean;
}

/** POST /v1/cancel (signé). */
export interface ConnectorCancelRequest {
  jobId: string;
}

// ─── Gestion dans l'application (fenêtre ⇄ processus principal) ─────────────

/** Navigateur autorisé, tel qu'affiché dans les réglages de l'application (aucun secret). */
export interface ConnectorClientInfo {
  clientId: string;
  /** Site autorisé (« magistra-2.vercel.app »). */
  site: string;
  /** Navigateur déduit de l'en-tête User-Agent à l'appairage (« Google Chrome », « Microsoft Edge »…). */
  browser: string;
  pairedAt: string;
  lastUsedAt?: string;
}

/** État du connecteur affiché dans les réglages de l'application. Jamais d'adresse ni de port. */
export interface ConnectorAppStatus {
  /** L'enseignant autorise le site Magistra à utiliser l'IA de cet ordinateur (réglage, activé par défaut). */
  enabled: boolean;
  /** Le connecteur écoute (faux si désactivé ou si aucun port dédié n'est libre). */
  listening: boolean;
  /** Cause lisible quand `enabled` est vrai mais `listening` faux. */
  problem?: string;
  /**
   * Faux si le système ne permet pas de chiffrer les clés sur le disque : les autorisations durent alors jusqu'à la
   * fermeture de l'application.
   */
  persistent: boolean;
  clients: ConnectorClientInfo[];
}
