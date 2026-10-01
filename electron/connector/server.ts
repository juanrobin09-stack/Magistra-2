// Serveur HTTP du connecteur local : le site web Magistra (navigateur de l'enseignant) utilise l'IA de cet ordinateur.
// Module PUR Node (aucun import d'Electron) : testé avec un vrai serveur sur un port éphémère.
//
//   site web ──HTTP boucle locale, requêtes signées──▶ ce serveur ──▶ GenerationManager ──▶ moteur IA ──▶ modèle
//
// Le navigateur n'obtient JAMAIS d'accès au moteur (Ollama) : cinq routes Magistra seulement (CONNECTOR_ROUTES), aucun
// relais, aucun fichier, aucune commande, aucun réglage ; toute autre route → 404, toute autre méthode → 405.
//
// Contrôles, dans cet ordre, pour CHAQUE requête (voir shared/localConnector.ts) :
//   1. pair distant = boucle locale (127.0.0.1 / ::ffff:127.0.0.1) ; écoute sur 127.0.0.1 UNIQUEMENT ;
//   2. en-tête Host EXACTEMENT « 127.0.0.1:<port d'écoute> » (anti DNS rebinding) → sinon 403 sans CORS ;
//   3. en-tête Origin présent, unique et EXACTEMENT dans la liste autorisée → sinon 403 sans CORS (« null », absent,
//      autre site, localhost…). Jamais « Access-Control-Allow-Origin: * », jamais « Allow-Credentials » ;
//   4. route exacte (chemin sans requête, sans normalisation : « /v1/../v1/hello » → 404), puis méthode (405) ;
//   5. OPTIONS : pré-vérification CORS (méthode et en-têtes demandés autorisés, accès au réseau privé de Chrome) ;
//      blocage temporaire (429) d'un navigateur appairé après trop de signatures, horodatages ou nonces faux : routes
//      signées seulement, pour CE navigateur seul ; hello et POST /v1/pair ne sont jamais bloqués ;
//   6. POST : Content-Type application/json (charset utf-8 toléré) → sinon 415 ; taille annoncée bornée → 413 ;
//   7. routes signées : format des en-têtes → navigateur connu ET appairé pour CETTE origine (401
//      CONNECTOR_UNPAIRED, avec la marque de retrait X-Magistra-Revoked si CETTE application l'a retiré) → horodatage
//      (±clockSkewMs, et jamais antérieur au début de l'écoute) → nonce jamais vu (401 UNAUTHENTICATED), puis lecture du corps
//      (bornée, avec délai : 413 / 408) → autorisation TOUJOURS valable (retirée pendant la lecture : 401
//      CONNECTOR_UNPAIRED) → signature HMAC sur les octets exacts du corps et l'hôte joint (401 UNAUTHENTICATED) ;
//      les contrôles sans corps sont faits AVANT la lecture : une requête non authentifiable ne fait rien lire ;
//      appairage (POST /v1/pair, non signé) : deux temps (pairing.ts) — l'accusé de réception `ack` prouve d'abord au
//      site que CETTE application a reçu l'URL magistra://pair et écoute sur CE port ; le vérificateur ne vient
//      qu'ensuite ;
//   8. toutes les réponses : Cache-Control: no-store, X-Content-Type-Options: nosniff, Vary: Origin, et, pour une
//      origine autorisée, Access-Control-Allow-Origin exact + Access-Control-Expose-Headers ; après une
//      authentification réussie (erreurs comprises) : X-Magistra-Proof = HMAC(clé, canonicalProof(client, nonce, hôte)).
// Accusé, signature et preuve portent l'hôte du port d'écoute (connectorHost) : un programme qui relaie les requêtes
// du site depuis un autre port dédié n'obtient rien d'utilisable (voir shared/localConnector.ts).
// Corps d'erreur : ApiErrorBody, messages en français sans trace, adresse, port, chemin, réglage ni secret.
// Journal : jamais de clé, de vérificateur, de signature ni de contenu de requête.

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { defaultMessage, MagistraError, toMagistraError, type ErrorCode } from '../../shared/errors.js';
import {
  canonicalProof, canonicalRequest, CONNECTOR_ALLOWED_REQUEST_HEADERS, CONNECTOR_EXPOSED_RESPONSE_HEADERS, CONNECTOR_FORMATS,
  CONNECTOR_HEADERS, CONNECTOR_HOST, CONNECTOR_LIMITS, CONNECTOR_PROTOCOL_VERSION, CONNECTOR_ROUTE_METHODS, CONNECTOR_ROUTES,
  connectorHost, isSignedRoute, type ConnectorHello, type ConnectorRoute, type ConnectorStatus, type PairCompleteResponse,
} from '../../shared/localConnector.js';
import type { GenerationEvent } from '../../shared/types.js';
import type { ExternalGenerationHandle, ExternalGenerationOptions } from '../generation.js';
import type { ConnectorClientKey } from './clients.js';
import { deriveClientKey, hmacBase64Url, parsePublicKey, sha256Base64Url, verifyHmac } from './crypto.js';
import type { PairingAck, PairingCompletion } from './pairing.js';
import { publicEvent, publicMessage } from './status.js';
import { browserFromUserAgent } from './userAgent.js';

// ─── Dépendances ────────────────────────────────────────────────────────────

/** Navigateurs autorisés (ConnectorClientStore). */
export interface ConnectorClientDirectory {
  find(clientId: string): ConnectorClientKey | undefined;
  touch(clientId: string): void;
  /** `evicted` : navigateurs retirés pour rester sous maxClients (leurs générations doivent être arrêtées). */
  add(input: { origin: string; browser: string; key: Uint8Array }): Promise<{ clientId: string; evicted?: readonly string[] }>;
  /** Retrait : effectif en mémoire dès l'appel (partie synchrone), puis enregistré. */
  revoke(clientId: string): Promise<boolean>;
  /** Marque de retrait d'un navigateur retiré par cette application pour ce site (sinon undefined). */
  revokedMark(clientId: string, origin: string): string | undefined;
}

/** Demandes d'appairage (PairingRegistry) ; `host` : connectorHost(port d'écoute), inclus dans l'accusé. */
export interface ConnectorPairing {
  acknowledge(input: { pairingId: string; origin: string; host: string }): PairingAck;
  complete(input: { pairingId: string; verifier: string; origin: string; host: string }): PairingCompletion;
}

/** Générations du site (GenerationManager). */
export interface ConnectorGenerations {
  startExternal(raw: unknown, options: ExternalGenerationOptions): ExternalGenerationHandle;
  cancelExternal(jobId: string, owner: string): boolean;
  cancelOwner(owner: string): void;
}

export interface ConnectorServerOptions {
  /** Version de l'application (hello, status, appairage). */
  version: string;
  /** Origines autorisées : origines officielles (et, en développement seulement, origines de la boucle locale). */
  allowedOrigins: readonly string[];
  /** Ports essayés dans l'ordre (le premier libre). 0 : port éphémère (tests). */
  ports: readonly number[];
  clients: ConnectorClientDirectory;
  pairing: ConnectorPairing;
  generations: ConnectorGenerations;
  /** GET /v1/status (déjà filtré : ni adresse, ni port, ni réglage). */
  status: () => Promise<ConnectorStatus>;
  /** Appelé après un appairage réussi ou un retrait par le navigateur (réglages de l'application). */
  onClientsChanged?: () => void;
  now?: () => number;
  /** Horloge monotone, en millisecondes (défaut : performance.now) : durée de l'écoute, insensible aux réglages de l'heure. */
  monotonic?: () => number;
  /** Journal (aucun secret, aucun contenu). */
  log?: (message: string) => void;
  /** Délais (tests). */
  timeouts?: Partial<ConnectorTimeouts>;
}

export interface ConnectorTimeouts {
  /** Réception des en-têtes. */
  headersMs: number;
  /** Réception de la requête complète (en-têtes et corps). */
  requestMs: number;
  /** Lecture du corps par le connecteur (réponse 408 lisible par le site, avant la coupure de requestMs). */
  bodyMs: number;
  /** Connexion inactive entre deux requêtes. */
  keepAliveMs: number;
  /** Intervalle de vérification des délais par Node. */
  checkIntervalMs: number;
}

const DEFAULT_TIMEOUTS: ConnectorTimeouts = { headersMs: 10_000, requestMs: 30_000, bodyMs: 20_000, keepAliveMs: 5_000, checkIntervalMs: 1_000 };
const MAX_HEADERS_COUNT = 40;
const MAX_CONNECTIONS = 32;
/** Blocage après trop d'échecs d'authentification. */
const BLOCK_MS = 60_000;
const FAILURE_WINDOW_MS = 60_000;
/** Navigateurs suivis au plus pour le blocage (au-delà, le plus ancien est oublié) : la mémoire reste bornée. */
const MAX_TRACKED_CLIENTS = 64;
/** Recul de l'horloge du système au-delà duquel il est journalisé (une fois par écoute). */
const CLOCK_BACK_LOG_MS = 5_000;
/** Nonces mémorisés au plus (au-delà : refus temporaire, jamais d'oubli prématuré qui permettrait un rejeu). */
const MAX_NONCES = 20_000;
const NONCE_PURGE_THRESHOLD = 2_000;
const PREFLIGHT_MAX_AGE = '600';

const ROUTES = new Set<string>(Object.values(CONNECTOR_ROUTES));
const ALLOWED_REQUEST_HEADERS = new Set(CONNECTOR_ALLOWED_REQUEST_HEADERS.map(h => h.toLowerCase()));
const JSON_CONTENT_TYPE_RE = /^application\/json[ \t]*(?:;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8")[ \t]*)?$/i;

/** Statut HTTP propre au connecteur (contrat : 409 pour une génération déjà en cours). */
const STATUS_OVERRIDES: Partial<Record<ErrorCode, number>> = {
  GENERATION_BUSY: 409,
  LOCAL_ENGINE_REMOTE: 409,
  DOCUMENT_TOO_LARGE: 413,
};
const RETRY_AFTER_SECONDS: Partial<Record<ErrorCode, number>> = { GENERATION_BUSY: 10 };

// ─── Contexte d'une requête ─────────────────────────────────────────────────

interface RequestContext {
  /** Origine autorisée de la requête (en-têtes CORS) ; null avant le contrôle 3 ou si refusée. */
  origin: string | null;
  /** Hôte joint, connectorHost(port d'écoute) (contrôle 2) : inclus dans l'accusé, la signature et la preuve. */
  host?: string;
  /** Preuve à joindre à toutes les réponses après authentification réussie. */
  proof?: string;
  /**
   * Corps annoncé mais pas (entièrement) lu : la connexion est fermée après la réponse, plutôt que de lire et jeter
   * le reste. Vrai dès qu'un corps est annoncé, faux une fois le corps lu en entier.
   */
  closeConnection?: boolean;
}

interface Authenticated {
  client: ConnectorClientKey;
  timestamp: string;
  nonce: string;
  signature: string;
}

class HttpError extends Error {
  readonly status: number;
  readonly error: MagistraError;
  readonly headers: Record<string, string>;
  constructor(status: number, error: MagistraError, headers: Record<string, string> = {}) {
    super(error.code);
    this.status = status;
    this.error = error;
    this.headers = headers;
  }
}

/**
 * Échec d'authentification. Il n'est compté pour le blocage temporaire (429) que s'il porte `countedFor` : l'identifiant
 * d'un navigateur DÉJÀ appairé pour cette origine (signature, horodatage ou nonce faux). Un échec sans secret
 * (en-têtes absents, navigateur inconnu) n'est jamais compté : n'importe quel programme local pourrait le répéter
 * pour bloquer le site.
 */
class AuthFailure extends HttpError {
  readonly countedFor: string | null;

  constructor(status: number, error: MagistraError, headers: Record<string, string> = {}, countedFor: string | null = null) {
    super(status, error, headers);
    this.countedFor = countedFor;
  }
}

function isLoopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

/** Valeur UNIQUE d'un en-tête (absent ou répété → null). */
function singleHeader(req: IncomingMessage, name: string): string | null {
  const values = (req.headersDistinct as Record<string, string[] | undefined>)[name.toLowerCase()];
  return values && values.length === 1 ? values[0] : null;
}

function declaredLength(headers: IncomingHttpHeaders): number | null {
  const raw = headers['content-length'];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
}

function hasBody(req: IncomingMessage): boolean {
  const length = declaredLength(req.headers);
  return (length !== null && length > 0) || req.headers['transfer-encoding'] !== undefined;
}

function invalid(message = 'Demande invalide.'): HttpError {
  return new HttpError(400, new MagistraError('INVALID_REQUEST', message));
}

function tooLarge(): HttpError {
  return new HttpError(413, new MagistraError('DOCUMENT_TOO_LARGE', 'Demande trop volumineuse : retirez des documents ou raccourcissez les textes.'));
}

/** Corps JSON (objet) : analyse stricte, jamais de message d'analyse (qui citerait le contenu). */
function parseJsonObject(body: Buffer): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw invalid('Corps de requête JSON invalide.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Corps de requête JSON invalide.');
  return value as Record<string, unknown>;
}

/** Objet ayant EXACTEMENT ces clés, toutes des chaînes. */
function exactStrings<K extends string>(obj: Record<string, unknown>, keys: readonly K[]): Record<K, string> {
  const present = Object.keys(obj);
  if (present.length !== keys.length || !keys.every(k => typeof obj[k] === 'string')) throw invalid();
  return obj as Record<K, string>;
}

// ─── Serveur ────────────────────────────────────────────────────────────────

export class ConnectorServer {
  private readonly options: ConnectorServerOptions;
  private readonly timeouts: ConnectorTimeouts;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private server: Server | null = null;
  private listeningPort: number | null = null;
  /**
   * Début de l'écoute actuelle (horloge du serveur, commune au navigateur : même ordinateur). Une requête signée AVANT
   * n'a jamais pu être destinée à cette écoute : captée par un programme qui occupait ce port auparavant (autre
   * session Windows), elle ne peut pas être rejouée ici (les nonces vus ne sont mémorisés que depuis cette écoute).
   */
  private listeningSince = Number.POSITIVE_INFINITY;
  /** Même instant, sur l'horloge monotone. */
  private listeningSinceMono = 0;
  /** Recul de l'horloge du système déjà journalisé pour cette écoute. */
  private clockBackLogged = false;
  private readonly monotonic: () => number;
  private readonly sockets = new Set<Socket>();
  /** Échecs d'authentification récents et blocage en cours, PAR navigateur appairé. */
  private readonly failures = new Map<string, { times: number[]; blockedUntil: number }>();
  /** « clientId.nonce » → instant après lequel l'horodatage de la requête serait de toute façon refusé. */
  private readonly nonces = new Map<string, number>();

  constructor(options: ConnectorServerOptions) {
    this.options = options;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.now = options.now ?? Date.now;
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.log = options.log ?? (message => console.warn(`[magistra] ${message}`));
  }

  /** Port d'écoute ; null si le serveur n'écoute pas. */
  get port(): number | null {
    return this.listeningPort;
  }

  /**
   * Écoute sur 127.0.0.1, sur le premier port libre de la liste (port occupé ou réservé par le système : suivant).
   * Renvoie le port, ou null si aucun n'est disponible.
   */
  async start(): Promise<number | null> {
    if (this.server) return this.listeningPort;
    for (const port of this.options.ports) {
      const server = this.createHttpServer();
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => {
            server.off('listening', onListening);
            reject(err);
          };
          const onListening = () => {
            server.off('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen({ host: CONNECTOR_HOST, port, exclusive: true });
        });
      } catch (err) {
        // Port occupé (EADDRINUSE) ou réservé par Windows (EACCES : plages exclues par Hyper-V…) : port suivant.
        const code = (err as NodeJS.ErrnoException).code ?? 'inconnu';
        this.log(`Connecteur local : port ${port} indisponible (${code}).`);
        server.close(() => undefined);
        continue;
      }
      server.on('error', err => this.log(`Connecteur local : erreur du serveur (${(err as NodeJS.ErrnoException).code ?? err.name}).`));
      this.server = server;
      this.listeningPort = (server.address() as AddressInfo).port;
      this.listeningSince = this.now();
      this.listeningSinceMono = this.monotonic();
      this.clockBackLogged = false;
      return this.listeningPort;
    }
    return null;
  }

  /** Arrête d'écouter et coupe toutes les connexions (les générations du site en cours sont alors interrompues). */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.listeningPort = null;
    this.listeningSince = Number.POSITIVE_INFINITY;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
    });
  }

  private createHttpServer(): Server {
    const server = createServer(
      { connectionsCheckingInterval: this.timeouts.checkIntervalMs, requireHostHeader: true, joinDuplicateHeaders: false },
      (req, res) => {
        void this.handle(req, res);
      },
    );
    server.headersTimeout = this.timeouts.headersMs;
    server.requestTimeout = this.timeouts.requestMs;
    server.keepAliveTimeout = this.timeouts.keepAliveMs;
    server.maxHeadersCount = MAX_HEADERS_COUNT;
    server.maxConnections = MAX_CONNECTIONS;
    server.on('connection', (socket: Socket) => {
      // 1. Boucle locale uniquement (l'écoute sur 127.0.0.1 le garantit déjà : double contrôle).
      if (!isLoopbackPeer(socket.remoteAddress)) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    server.on('clientError', (err: NodeJS.ErrnoException, socket: Socket) => {
      if (!socket.writable) {
        socket.destroy();
        return;
      }
      const [status, message] = err.code === 'ERR_HTTP_REQUEST_TIMEOUT'
        ? ['408 Request Timeout', 'Requête reçue trop lentement.']
        : err.code === 'HPE_HEADER_OVERFLOW'
          // Node 22.23 et suivants (donc Electron) refusent eux-mêmes une requête au-delà de maxHeadersCount.
          ? ['431 Request Header Fields Too Large', 'Trop d’en-têtes dans la requête.']
          : ['400 Bad Request', defaultMessage('INVALID_REQUEST')];
      // Même forme que les autres refus (sendError) : erreur JSON, sans aucun en-tête CORS.
      const body = JSON.stringify({ error: { code: 'INVALID_REQUEST', message, retryable: false } });
      // Réponse écrite, puis connexion DÉTRUITE (comme le gestionnaire par défaut de Node) : le serveur accepte les
      // connexions à moitié fermées, et un client qui ne fermerait jamais son côté garderait sinon sa place parmi les
      // MAX_CONNECTIONS indéfiniment (connecteur injoignable pour le site).
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nVary: Origin\r\n`
          + `Content-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
        () => socket.destroy(),
      );
    });
    return server;
  }

  // ─── Réponses ─────────────────────────────────────────────────────────────

  private headersFor(ctx: RequestContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    };
    if (ctx.origin) {
      headers['Access-Control-Allow-Origin'] = ctx.origin;
      headers['Access-Control-Expose-Headers'] = CONNECTOR_EXPOSED_RESPONSE_HEADERS.join(', ');
    }
    if (ctx.proof) headers[CONNECTOR_HEADERS.proof] = ctx.proof;
    if (ctx.closeConnection) headers.Connection = 'close';
    return headers;
  }

  private sendJson(res: ServerResponse, ctx: RequestContext, status: number, body: unknown, extra: Record<string, string> = {}): void {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      ...this.headersFor(ctx),
      ...extra,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(payload)),
    });
    res.end(payload);
  }

  private sendError(res: ServerResponse, ctx: RequestContext, err: unknown): void {
    let status: number;
    let error: MagistraError;
    let extra: Record<string, string> = {};
    if (err instanceof HttpError) {
      status = err.status;
      error = err.error;
      extra = err.headers;
    } else {
      error = toMagistraError(err);
      status = STATUS_OVERRIDES[error.code] ?? error.status;
      if (error.code === 'INTERNAL') {
        // Jamais le message d'origine (il pourrait citer le contenu de la requête) : type et code seulement.
        const e = err as { name?: unknown; code?: unknown };
        this.log(`Connecteur local : erreur interne (${String(e?.name ?? typeof err)}${e?.code ? ` ${String(e.code)}` : ''}).`);
      }
      const retry = RETRY_AFTER_SECONDS[error.code];
      if (retry) extra = { 'Retry-After': String(retry) };
    }
    this.sendJson(res, ctx, status, { error: { code: error.code, message: publicMessage(error.code, error.message), retryable: error.retryable } }, extra);
  }

  /** Refus avant le contrôle de l'origine : aucun en-tête CORS, connexion fermée. */
  private refuseWithoutCors(res: ServerResponse): void {
    this.sendError(res, { origin: null, closeConnection: true }, new HttpError(403, new MagistraError('FORBIDDEN')));
  }

  // ─── Limitation des échecs d'authentification ─────────────────────────────

  /** Durée restante (ms) du blocage de CE navigateur ; 0 s'il n'est pas bloqué. */
  private blockedFor(clientId: string): number {
    const entry = this.failures.get(clientId);
    return entry ? Math.max(0, entry.blockedUntil - this.now()) : 0;
  }

  private recordFailure(clientId: string): void {
    const now = this.now();
    for (const [id, e] of this.failures) if (e.blockedUntil <= now && e.times.every(t => now - t >= FAILURE_WINDOW_MS)) this.failures.delete(id);
    const entry = this.failures.get(clientId) ?? { times: [], blockedUntil: 0 };
    this.failures.delete(clientId);
    entry.times = entry.times.filter(t => now - t < FAILURE_WINDOW_MS);
    entry.times.push(now);
    if (entry.times.length > CONNECTOR_LIMITS.maxAuthFailuresPerMinute) {
      entry.blockedUntil = now + BLOCK_MS;
      entry.times = [];
      this.log('Connecteur local : trop d’échecs d’authentification pour un navigateur, accès suspendu pendant une minute.');
    }
    this.failures.set(clientId, entry);
    while (this.failures.size > MAX_TRACKED_CLIENTS) this.failures.delete(this.failures.keys().next().value as string);
  }

  private purgeNonces(): void {
    const now = this.now();
    for (const [key, expires] of this.nonces) if (expires <= now) this.nonces.delete(key);
  }

  // ─── Traitement d'une requête ─────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ctx: RequestContext = { origin: null, closeConnection: hasBody(req) };
    // Une écriture après la déconnexion du navigateur ne doit jamais faire tomber l'application.
    res.on('error', () => undefined);
    req.on('error', () => undefined);
    try {
      // 1. Pair distant.
      if (!isLoopbackPeer(req.socket.remoteAddress)) {
        req.socket.destroy();
        return;
      }
      // Au-delà de MAX_HEADERS_COUNT en-têtes, Node ignore les suivants EN SILENCE (ni headersDistinct ni rawHeaders ne
      // les contiennent) : un Host ou un Origin répété, ou un Transfer-Encoding, pourrait s'y cacher. Une requête qui
      // a pu être tronquée est refusée (sans CORS, connexion fermée) ; un navigateur envoie une vingtaine d'en-têtes.
      if (req.rawHeaders.length >= 2 * MAX_HEADERS_COUNT) {
        this.sendError(res, { origin: null, closeConnection: true }, new HttpError(431, new MagistraError('INVALID_REQUEST', 'Trop d’en-têtes dans la requête.')));
        return;
      }
      // 2. Hôte exact (anti DNS rebinding).
      const port = this.listeningPort;
      if (port === null || singleHeader(req, 'host') !== connectorHost(port)) {
        this.refuseWithoutCors(res);
        return;
      }
      const host = connectorHost(port);
      ctx.host = host;
      // 3. Origine exacte parmi les origines autorisées.
      const origin = singleHeader(req, 'origin');
      if (!origin || !this.options.allowedOrigins.includes(origin)) {
        this.refuseWithoutCors(res);
        return;
      }
      ctx.origin = origin;

      // 4. Route exacte, puis méthode.
      const path = req.url ?? '';
      if (!ROUTES.has(path)) throw new HttpError(404, new MagistraError('NOT_FOUND', 'Service introuvable.'));
      const route = path as ConnectorRoute;
      const method = req.method ?? '';
      const allowed = CONNECTOR_ROUTE_METHODS[route];
      // 5. Pré-vérification CORS.
      if (method === 'OPTIONS') {
        this.preflight(req, res, ctx, allowed);
        return;
      }
      if (!allowed.includes(method)) {
        throw new HttpError(405, new MagistraError('INVALID_REQUEST', 'Méthode non autorisée pour cette adresse.'), { Allow: [...allowed, 'OPTIONS'].join(', ') });
      }
      // Seul un navigateur appairé qui a multiplié les signatures fausses est suspendu (routes signées) ; hello et
      // POST /v1/pair ne sont jamais bloqués, et un échec sans secret ne compte pour personne.
      if (isSignedRoute(method, route)) {
        const clientId = singleHeader(req, CONNECTOR_HEADERS.client);
        const wait = clientId ? this.blockedFor(clientId) : 0;
        if (wait > 0) {
          throw new HttpError(429, new MagistraError('RATE_LIMITED'), { 'Retry-After': String(Math.ceil(wait / 1000)) });
        }
      }

      // 6. Format et taille annoncée du corps.
      const limit = route === CONNECTOR_ROUTES.generate ? CONNECTOR_LIMITS.generateBodyBytes : CONNECTOR_LIMITS.smallBodyBytes;
      if (method === 'POST') {
        const contentType = singleHeader(req, 'content-type');
        if (!contentType || !JSON_CONTENT_TYPE_RE.test(contentType.trim())) {
          throw new HttpError(415, new MagistraError('INVALID_REQUEST', 'Format de requête invalide : JSON attendu.'));
        }
      } else if (hasBody(req)) {
        throw invalid('Cette requête ne doit pas avoir de corps.');
      }
      const declared = declaredLength(req.headers);
      if (declared !== null && declared > limit) throw tooLarge();

      // 7a. Authentification sans le corps.
      const signed = isSignedRoute(method, route);
      const auth = signed ? this.preAuthenticate(req, origin) : null;

      // 6b. Lecture du corps (bornée, avec délai).
      const body = await this.readBody(req, limit, ctx);

      // 7b. Autorisation toujours valable, puis signature sur les octets exacts du corps et l'hôte joint.
      if (auth) this.verifySignature(auth, method, route, origin, host, body, ctx);

      await this.dispatch(req, res, ctx, route, method, body, auth);
    } catch (err) {
      if (err instanceof AuthFailure && err.countedFor) this.recordFailure(err.countedFor);
      this.sendError(res, ctx, err);
    }
  }

  private preflight(req: IncomingMessage, res: ServerResponse, ctx: RequestContext, allowed: readonly string[]): void {
    const requestedMethod = singleHeader(req, 'access-control-request-method');
    // Plusieurs lignes d'en-tête valent une liste unique : TOUS les en-têtes demandés doivent être autorisés.
    const requestedHeaders = ((req.headersDistinct as Record<string, string[] | undefined>)['access-control-request-headers'] ?? [])
      .join(',')
      .split(',')
      .map(h => h.trim().toLowerCase())
      .filter(Boolean);
    if (!requestedMethod || !allowed.includes(requestedMethod) || !requestedHeaders.every(h => ALLOWED_REQUEST_HEADERS.has(h))) {
      this.sendError(res, ctx, new HttpError(403, new MagistraError('FORBIDDEN')));
      return;
    }
    const headers: Record<string, string> = {
      ...this.headersFor(ctx),
      'Access-Control-Allow-Methods': allowed.join(', '),
      'Access-Control-Allow-Headers': CONNECTOR_ALLOWED_REQUEST_HEADERS.join(', '),
      'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
    };
    // Ancien mécanisme « Private Network Access » de Chrome (site public → boucle locale) ; sans effet ailleurs.
    if (singleHeader(req, 'access-control-request-private-network')?.toLowerCase() === 'true') {
      headers['Access-Control-Allow-Private-Network'] = 'true';
    }
    res.writeHead(204, headers);
    res.end();
  }

  /** En-têtes d'authentification, navigateur, horodatage, nonce : tout sauf la signature (qui exige le corps). */
  private preAuthenticate(req: IncomingMessage, origin: string): Authenticated {
    const unauthenticated = () => new AuthFailure(401, new MagistraError('UNAUTHENTICATED', 'Requête non authentifiée.'));
    const clientId = singleHeader(req, CONNECTOR_HEADERS.client);
    const timestamp = singleHeader(req, CONNECTOR_HEADERS.timestamp);
    const nonce = singleHeader(req, CONNECTOR_HEADERS.nonce);
    const signature = singleHeader(req, CONNECTOR_HEADERS.signature);
    if (!clientId || !timestamp || !nonce || !signature
      || !CONNECTOR_FORMATS.clientId.test(clientId) || !CONNECTOR_FORMATS.timestamp.test(timestamp)
      || !CONNECTOR_FORMATS.nonce.test(nonce) || !CONNECTOR_FORMATS.mac.test(signature)) {
      throw unauthenticated();
    }
    const client = this.options.clients.find(clientId);
    // Navigateur inconnu, autorisation retirée, ou appairé pour un autre site : il doit se reconnecter.
    if (!client || client.origin !== origin) throw this.unpaired(clientId, origin);
    // À partir d'ici le navigateur est connu : ses échecs sont comptés (pour lui seul).
    const counted = () => new AuthFailure(401, new MagistraError('UNAUTHENTICATED', 'Requête non authentifiée.'), {}, clientId);
    if (Math.abs(this.now() - Number(timestamp)) > CONNECTOR_LIMITS.clockSkewMs) throw counted();
    // Signée avant le début de cette écoute : rejeu d'une requête captée par le programme qui occupait ce port.
    if (Number(timestamp) < this.listeningStart()) throw counted();
    if (this.nonces.has(`${clientId}.${nonce}`)) throw counted();
    return { client, timestamp, nonce, signature };
  }

  /**
   * Début de l'écoute exprimé dans l'horloge ACTUELLE du système. Si l'heure a reculé depuis (synchronisation de
   * Windows, réglage manuel), le navigateur — même ordinateur, même horloge — signe avec des heures antérieures au
   * début noté : comparées à lui, toutes ses requêtes seraient refusées (401, puis 429) jusqu'à ce que l'horloge le
   * rattrape. La durée de l'écoute est donc mesurée par l'horloge monotone ; une heure avancée ne recule jamais ce début.
   * Après un recul, une requête signée avant l'écoute avec une heure que l'horloge reparcourt redevient recevable
   * (±CONNECTOR_LIMITS.clockSkewMs) : il faudrait qu'un programme l'ait captée sur ce port avant l'écoute ET que
   * l'heure recule (droits d'administrateur) ; les nonces déjà vus restent refusés.
   */
  private listeningStart(): number {
    if (!Number.isFinite(this.listeningSince)) return this.listeningSince;
    const start = Math.min(this.listeningSince, this.now() - (this.monotonic() - this.listeningSinceMono));
    if (!this.clockBackLogged && this.listeningSince - start > CLOCK_BACK_LOG_MS) {
      this.clockBackLogged = true;
      this.log('Connecteur local : l’horloge du système a reculé depuis le début de l’écoute ; les requêtes du site restent acceptées.');
    }
    return start;
  }

  /**
   * 401 CONNECTOR_UNPAIRED, avec la marque de retrait si CETTE application a retiré ce navigateur : sans elle, le site
   * ne peut pas distinguer un retrait d'une autre application Magistra (autre session Windows) qui ne le connaît pas.
   */
  private unpaired(clientId: string, origin: string): AuthFailure {
    const mark = this.options.clients.revokedMark(clientId, origin);
    return new AuthFailure(401, new MagistraError('CONNECTOR_UNPAIRED'), mark ? { [CONNECTOR_HEADERS.revoked]: mark } : {});
  }

  /**
   * Le navigateur est-il TOUJOURS autorisé, avec la même clé ? L'autorisation a pu être retirée (réglages de
   * l'application, DELETE /v1/pair d'un autre onglet) ou évincée (au-delà de maxClients) pendant la lecture du corps :
   * sa clé est alors effacée sur place (32 octets nuls, connus de tous) et ne doit plus rien vérifier.
   */
  private stillAuthorized(auth: Authenticated, origin: string): void {
    const current = this.options.clients.find(auth.client.clientId);
    if (!current || current.origin !== origin || current.key !== auth.client.key) throw this.unpaired(auth.client.clientId, origin);
  }

  private verifySignature(auth: Authenticated, method: string, route: ConnectorRoute, origin: string, host: string, body: Buffer, ctx: RequestContext): void {
    this.stillAuthorized(auth, origin);
    const message = canonicalRequest({
      method,
      host,
      path: route,
      origin,
      clientId: auth.client.clientId,
      timestamp: auth.timestamp,
      nonce: auth.nonce,
      bodySha256: sha256Base64Url(body),
    });
    if (!verifyHmac(auth.client.key, message, auth.signature)) {
      throw new AuthFailure(401, new MagistraError('UNAUTHENTICATED', 'Requête non authentifiée.'), {}, auth.client.clientId);
    }
    // Nonce mémorisé SEULEMENT après une signature valide (une requête forgée ne remplit pas la mémoire), avec un
    // nouveau contrôle : deux requêtes identiques simultanées ne passent jamais toutes les deux.
    const key = `${auth.client.clientId}.${auth.nonce}`;
    if (this.nonces.has(key)) throw new AuthFailure(401, new MagistraError('UNAUTHENTICATED', 'Requête déjà reçue.'), {}, auth.client.clientId);
    if (this.nonces.size >= NONCE_PURGE_THRESHOLD) this.purgeNonces();
    if (this.nonces.size >= MAX_NONCES) throw new HttpError(429, new MagistraError('RATE_LIMITED'), { 'Retry-After': '30' });
    this.nonces.set(key, Number(auth.timestamp) + CONNECTOR_LIMITS.clockSkewMs + 1_000);
    ctx.proof = hmacBase64Url(auth.client.key, canonicalProof(auth.client.clientId, auth.nonce, host));
    this.options.clients.touch(auth.client.clientId);
  }

  /** Corps de la requête, borné, avec délai. Refus → la connexion sera fermée après la réponse. */
  private readBody(req: IncomingMessage, limit: number, ctx: RequestContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        req.off('aborted', onError);
      };
      const fail = (err: HttpError) => {
        if (settled) return;
        settled = true;
        cleanup();
        ctx.closeConnection = true;
        req.pause();
        reject(err);
      };
      const onData = (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) fail(tooLarge());
        else chunks.push(chunk);
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        ctx.closeConnection = false;
        resolve(Buffer.concat(chunks, size));
      };
      const onError = () => fail(invalid('Lecture de la requête impossible.'));
      const timer = setTimeout(() => fail(new HttpError(408, new MagistraError('INVALID_REQUEST', 'Requête reçue trop lentement.'))), this.timeouts.bodyMs);
      timer.unref?.();
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('aborted', onError);
    });
  }

  // ─── Routes ───────────────────────────────────────────────────────────────

  private async dispatch(
    req: IncomingMessage, res: ServerResponse, ctx: RequestContext, route: ConnectorRoute, method: string, body: Buffer, auth: Authenticated | null,
  ): Promise<void> {
    if (route === CONNECTOR_ROUTES.hello) {
      const hello: ConnectorHello = { app: 'magistra', protocol: CONNECTOR_PROTOCOL_VERSION, version: this.options.version };
      this.sendJson(res, ctx, 200, hello);
      return;
    }
    if (route === CONNECTOR_ROUTES.pair && method === 'POST') {
      await this.completePairing(req, res, ctx, body);
      return;
    }
    if (!auth) throw new Error('route signée sans authentification');
    const clientId = auth.client.clientId;
    if (route === CONNECTOR_ROUTES.pair) {
      // DELETE : ce navigateur retire sa propre autorisation (la preuve a été calculée avant le retrait). Comme dans
      // LocalConnector.revoke : retrait en mémoire (partie synchrone), arrêt de ses générations, PUIS enregistrement
      // — un enregistrement lent (verrou d'antivirus) ou impossible ne laisse jamais tourner sa génération.
      const revoking = this.options.clients.revoke(clientId);
      this.options.generations.cancelOwner(clientId);
      try {
        await revoking;
      } finally {
        this.options.onClientsChanged?.();
      }
      this.sendJson(res, ctx, 200, { ok: true });
      return;
    }
    if (route === CONNECTOR_ROUTES.status) {
      this.sendJson(res, ctx, 200, await this.options.status());
      return;
    }
    if (route === CONNECTOR_ROUTES.cancel) {
      const { jobId } = exactStrings(parseJsonObject(body), ['jobId'] as const);
      if (!CONNECTOR_FORMATS.jobId.test(jobId)) throw invalid();
      // Réponse identique que la génération existe ou non, qu'elle appartienne ou non à ce navigateur.
      this.options.generations.cancelExternal(jobId, clientId);
      this.sendJson(res, ctx, 200, { ok: true });
      return;
    }
    if (route === CONNECTOR_ROUTES.generate) {
      const raw = parseJsonObject(body);
      // Dernier contrôle juste avant le lancement (la preuve est déjà calculée : ce refus reste lisible par le site).
      this.stillAuthorized(auth, ctx.origin!);
      await this.generate(res, ctx, clientId, raw);
      return;
    }
    throw new HttpError(404, new MagistraError('NOT_FOUND', 'Service introuvable.'));
  }

  /**
   * POST /v1/pair. Premier temps { pairingId } : preuve de réception de l'URL magistra://pair (accusé `ack`), sans
   * secret et sans effet sur la demande. Second temps { pairingId, verifier, clientPublicKey } : fin d'appairage.
   * Toute autre forme de corps : 400.
   */
  private async completePairing(req: IncomingMessage, res: ServerResponse, ctx: RequestContext, body: Buffer): Promise<void> {
    const origin = ctx.origin!;
    const host = ctx.host!;
    const raw = parseJsonObject(body);
    if (Object.keys(raw).length === 1) {
      const { pairingId } = exactStrings(raw, ['pairingId'] as const);
      if (!CONNECTOR_FORMATS.pairingId.test(pairingId)) throw invalid();
      const acknowledged = this.options.pairing.acknowledge({ pairingId, origin, host });
      const reply: PairCompleteResponse = { status: acknowledged.status, ack: acknowledged.ack };
      this.sendJson(res, ctx, acknowledged.status === 'pending' ? 202 : 200, reply);
      return;
    }
    const input = exactStrings(raw, ['pairingId', 'verifier', 'clientPublicKey'] as const);
    if (!CONNECTOR_FORMATS.pairingId.test(input.pairingId) || !CONNECTOR_FORMATS.verifier.test(input.verifier)) throw invalid();
    const clientPublicKey = parsePublicKey(input.clientPublicKey);
    if (!clientPublicKey) throw invalid('Clé publique invalide.');
    // Clé dérivée AVANT de consommer la demande : une clé publique hors de la courbe est refusée (400) sans
    // faire perdre la demande (calcul synchrone : aucune autre requête ne peut s'intercaler).
    let derived: { key: Buffer; connectorPublicKey: string };
    try {
      derived = deriveClientKey(clientPublicKey, input.pairingId);
    } catch {
      throw invalid('Clé publique invalide.');
    }
    let completion: PairingCompletion;
    try {
      completion = this.options.pairing.complete({ pairingId: input.pairingId, verifier: input.verifier, origin, host });
    } catch (err) {
      derived.key.fill(0);
      const e = toMagistraError(err);
      if (e.code === 'UNAUTHENTICATED') throw new AuthFailure(401, e);
      throw err;
    }
    if (completion.status === 'pending') {
      derived.key.fill(0);
      const pending: PairCompleteResponse = { status: 'pending', ack: completion.ack };
      this.sendJson(res, ctx, 202, pending);
      return;
    }
    try {
      const client = await this.options.clients.add({ origin, browser: browserFromUserAgent(req.headers['user-agent']), key: derived.key });
      // Navigateurs évincés (au-delà de maxClients) : autorisation retirée, génération en cours arrêtée comme pour un retrait.
      for (const evicted of client.evicted ?? []) this.options.generations.cancelOwner(evicted);
      this.log('Connecteur local : nouveau navigateur autorisé.');
      this.options.onClientsChanged?.();
      const approved: PairCompleteResponse = {
        status: 'approved',
        clientId: client.clientId,
        connectorPublicKey: derived.connectorPublicKey,
        version: this.options.version,
        ack: completion.ack,
      };
      this.sendJson(res, ctx, 200, approved);
    } finally {
      derived.key.fill(0);
    }
  }

  private async generate(res: ServerResponse, ctx: RequestContext, clientId: string, raw: Record<string, unknown>): Promise<void> {
    let head = false;
    const queued: string[] = [];
    const closed = () => res.destroyed || res.writableEnded;
    const send = (event: GenerationEvent): boolean => {
      if (closed()) return false;
      const line = `${JSON.stringify(publicEvent(event))}\n`;
      if (!head) queued.push(line);
      else res.write(line);
      return true;
    };
    // Erreurs levées ici (demande invalide, génération déjà en cours, moteur distant) : réponse JSON, pas de flux.
    const handle = this.options.generations.startExternal(raw, { owner: clientId, send, requireLocal: true });
    // Connexion fermée par le navigateur (onglet fermé, « Arrêter ») avant la fin : génération interrompue.
    res.once('close', () => {
      if (!res.writableFinished) this.options.generations.cancelExternal(handle.jobId, clientId);
    });
    res.writeHead(200, {
      ...this.headersFor(ctx),
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      [CONNECTOR_HEADERS.job]: handle.jobId,
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    head = true;
    for (const line of queued.splice(0)) res.write(line);
    await handle.finished;
    if (!closed()) res.end();
  }
}
