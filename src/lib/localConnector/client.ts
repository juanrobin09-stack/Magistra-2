// Client du connecteur local : le SITE WEB Magistra (ce navigateur) utilise l'IA de l'ordinateur de l'enseignant par
// l'intermédiaire de l'application Windows Magistra.
//
//   site web ──HTTP boucle locale, requêtes signées──▶ connecteur (application Windows) ──▶ moteur IA ──▶ modèle
//
// Aucune adresse n'est saisie ni affichée : les ports dédiés (CONNECTOR_PORTS) sont sondés (GET /v1/hello) ; le port
// où l'application a prouvé détenir la clé est mémorisé et essayé en premier ; s'il ne répond plus, tous les ports
// sont sondés à nouveau (l'application prend le premier port libre à chaque démarrage).
//
// Sécurité :
//  - requêtes : mode CORS, sans cookie ni identifiant (credentials 'omit'), sans cache, sans Referer, sans suivre de
//    redirection, targetAddressSpace 'loopback' (Local Network Access de Chrome ; ignoré ailleurs) ;
//  - appairage : l'URL magistra://pair ne porte que l'identifiant de la demande, le défi (SHA-256 du vérificateur) et
//    l'origine du site. Premier temps, sans secret : POST /v1/pair { pairingId } ; seul un port qui renvoie l'accusé
//    de réception attendu POUR CE PORT (SHA-256 de canonicalPairAck(pairingId, défi, hôte) : le défi n'est dans aucune
//    requête HTTP) a reçu l'URL et y écoute, donc est l'application Magistra de CETTE session. Un port sans accusé
//    valide (autre programme, autre session Windows d'un PC partagé ou d'un serveur de bureaux à distance, y compris
//    un programme qui relaie tout à la vraie application depuis un autre port) est ignoré et ne reçoit JAMAIS le
//    vérificateur ni la clé publique : ils ne partent, dans le CORPS du second temps, qu'au port dont l'accusé est
//    valide et seulement après l'accord de l'enseignant ('consented'). La clé HMAC, dérivée par ECDH des deux côtés,
//    n'a jamais circulé et reste non extractible dans ce navigateur ;
//  - chaque requête signée porte l'hôte visé (connectorHost(port)) et chaque réponse doit porter la PREUVE
//    (X-Magistra-Proof) que l'application détient la clé de ce navigateur pour CE nonce et CE port. Sans preuve valide
//    (autre programme sur le port, autre session Windows, relais vers un autre port), la réponse est ignorée — son
//    texte n'est jamais affiché — et vaut CONNECTOR_UNREACHABLE ;
//  - aucun contenu de génération (demande, extraits de documents) n'est envoyé à un port qui n'a pas prouvé, dans
//    cette session et depuis moins de 30 s, détenir la clé : sinon GET /v1/status est refait d'abord ;
//  - 401 CONNECTOR_UNPAIRED : cette réponse ne porte jamais de preuve (le programme qui répond ne connaît pas, ou
//    plus, la clé). L'application Magistra d'une AUTRE session Windows (PC partagé, bureaux à distance : ports de la
//    boucle locale communs) la renvoie légitimement, elle qui ne connaît pas ce navigateur. L'appairage n'est donc
//    oublié — et un retrait n'est tenu pour confirmé — que sur la MARQUE DE RETRAIT valide (X-Magistra-Revoked,
//    calculée avec la clé de ce navigateur par l'application qui l'a retiré), et seulement si aucun port ne prouve
//    détenir la clé. Sans marque : l'appairage est gardé (UNRECOGNIZED_BY_APP_MESSAGE : ouvrir sa propre
//    application, ou reconnecter si elle a perdu ses autorisations) ;
//  - autorisation du navigateur (Local Network Access de Chrome et Edge) : Chromium ouvre la connexion AVANT de poser
//    sa question et l'application ferme toute connexion muette au bout de 10 s ; accordée plus tard, la requête
//    retenue échoue. Une recherche commencée à 'prompt' et terminée à 'granted' est donc refaite aussitôt. Un
//    navigateur qui expose l'autorisation sans l'appliquer (réponse reçue, autorisation toujours à 'prompt') est
//    traité comme sans ce mécanisme pour le reste de la visite.

import { defaultMessage, isAbortError, isErrorCode, MagistraError, toMagistraError, type ErrorCode } from '@shared/errors';
import {
  buildPairingUrl, CONNECTOR_FORMATS, CONNECTOR_HEADERS, CONNECTOR_LIMITS, CONNECTOR_PORTS, CONNECTOR_PROTOCOL_VERSION,
  CONNECTOR_ROUTES, CONNECTOR_URL_SCHEME, connectorHost, type ConnectorCancelRequest, type ConnectorHello,
  type ConnectorRoute, type ConnectorStatus, type PairAckRequest, type PairFinishRequest,
} from '@shared/localConnector';
import type { AINotice, GenerationEvent, GenerationRequest } from '@shared/types';
import { readEventStream } from '@/lib/runtime/http';
import { defaultPairingStore, isStoredPairing, type PairingStore, type StoredPairing } from './pairingStore';
import { queryLoopbackPermission, type LoopbackPermission } from './permission';
import {
  createPairingSecrets, deriveHmacKey, expectedPairAck, generateClientKeyPair, isWebCryptoAvailable, NONCE_BYTES, pairingCode,
  randomToken, sha256Base64Url, signRequest, utf8, verifyPairAck, verifyProof, verifyRevokedMark, type ClientKeyPair,
  type PairingSecrets,
} from './webCrypto';

export type { LoopbackPermission } from './permission';

export interface LocalConnectorClientOptions {
  /** Ports sondés (défaut : CONNECTOR_PORTS). */
  ports?: readonly number[];
  /** Origine du site, telle que le navigateur l'envoie dans l'en-tête Origin (défaut : window.location.origin). */
  origin?: string;
  fetch?: typeof fetch;
  /** Appairage mémorisé (défaut : IndexedDB, repli en mémoire). */
  store?: PairingStore;
  /** Ouvre une URL magistra:// (défaut : window.location.href = url). */
  openUrl?: (url: string) => void;
  /** État de l'autorisation du navigateur, lu sans la demander (défaut : queryLoopbackPermission). */
  permission?: () => Promise<LoopbackPermission>;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Délais du client, en millisecondes. */
export const CONNECTOR_CLIENT_TIMEOUTS = {
  /** Présence de Magistra (GET /v1/hello), par port. */
  hello: 1_500,
  /**
   * Requête qui peut faire apparaître la demande d'autorisation du navigateur (état 'prompt') : le navigateur la
   * retient jusqu'à la réponse de l'enseignant.
   */
  permissionPrompt: 60_000,
  /** État du moteur (GET /v1/status). */
  status: 10_000,
  /** Un essai de POST /v1/pair (preuve de réception ou fin d'appairage). */
  pairRequest: 5_000,
  /** Appairage complet, de l'ouverture de magistra://pair à l'accord de l'enseignant. */
  pairing: 120_000,
  /** Intervalle de recherche de l'application pendant l'appairage. */
  helloPoll: 1_000,
  /** Intervalle des essais d'appairage tant que l'enseignant n'a pas répondu (202). */
  pairPoll: 1_500,
  /** Début de la réponse de POST /v1/generate (le flux lui-même n'a pas de délai ici : la pipeline a les siens). */
  generateHeaders: 30_000,
  /** Retrait d'autorisation (DELETE /v1/pair) et arrêt d'une génération (POST /v1/cancel). */
  small: 5_000,
  /** Âge maximal de la dernière preuve avant l'envoi du contenu d'une génération. */
  proofMaxAge: 30_000,
} as const;

const T = CONNECTOR_CLIENT_TIMEOUTS;
/** Réponses lues au plus (un programme inconnu sur le port ne peut pas saturer la mémoire de la page). */
const MAX_SMALL_RESPONSE_BYTES = 16 * 1024;
const MAX_STATUS_RESPONSE_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 600;
const MAX_LABEL_CHARS = 120;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

/** Réponse inattendue d'un programme qui se présente comme Magistra (version incompatible, programme inconnu). */
export const UNEXPECTED_REPLY_MESSAGE =
  "L'application Magistra de cet ordinateur a répondu de façon inattendue : mettez-la à jour, puis réessayez.";
/**
 * Une application Magistra répond, mais dans une version PLUS ANCIENNE du protocole que ce site (les applications
 * installées se mettent à jour à la main, le site tout de suite) : elle ne peut pas être utilisée avant sa mise à jour.
 */
export const APP_UPDATE_REQUIRED_MESSAGE =
  "L'application Magistra de cet ordinateur doit être mise à jour pour être utilisée depuis ce site : installez la dernière version de Magistra pour Windows (bouton « Télécharger »), puis réessayez.";
/** Une application Magistra répond dans une version PLUS RÉCENTE du protocole : cette page date d'avant la mise à jour. */
export const PAGE_RELOAD_REQUIRED_MESSAGE =
  "L'application Magistra de cet ordinateur est plus récente que cette page : rechargez la page, puis réessayez.";
/** L'application répond, mais n'a jamais reconnu la demande de connexion (URL magistra:// non reçue). */
export const PAIRING_NOT_RECEIVED_MESSAGE =
  "La demande de connexion n'est pas parvenue à l'application Magistra. Recommencez et, si votre navigateur le demande, acceptez l'ouverture de Magistra.";
/**
 * Une application Magistra répond sans reconnaître ce navigateur, et aucune n'a prouvé détenir sa clé ni l'avoir
 * retiré : celle d'une autre session Windows (la sienne étant fermée), ou la sienne qui a perdu ses autorisations.
 * L'appairage est gardé ; l'enseignant ouvre son application, ou reconnecte Magistra locale.
 */
export const UNRECOGNIZED_BY_APP_MESSAGE =
  "Une application Magistra répond sur cet ordinateur, mais elle ne reconnaît pas ce navigateur (par exemple celle d'une autre session Windows). Ouvrez votre application Magistra ; si elle est déjà ouverte, reconnectez Magistra locale.";
/** Flux de génération coupé avant la fin. */
export const STREAM_INTERRUPTED_MESSAGE =
  "La connexion à l'application Magistra a été interrompue pendant la génération : vérifiez qu'elle est ouverte, puis réessayez.";
/**
 * Génération arrêtée par l'application alors que le site ne l'a pas interrompue : autorisation de ce navigateur retirée
 * (réglages de l'application, déconnexion depuis un autre onglet). Jamais présentée comme un « Arrêter » de l'enseignant.
 */
export const STOPPED_BY_APP_MESSAGE =
  "La génération a été arrêtée par l'application Magistra : l'autorisation de ce navigateur a peut-être été retirée. Vérifiez la connexion de Magistra locale, puis réessayez.";
/** WebCrypto indisponible (navigateur trop ancien, contexte non sécurisé). */
export const UNSUPPORTED_BROWSER_MESSAGE =
  'Ce navigateur ne permet pas de connecter Magistra locale (fonctions de sécurité indisponibles). Utilisez une version récente de Chrome, Edge ou Firefox.';
const REQUEST_TOO_LARGE_MESSAGE = 'Demande trop volumineuse : retirez des documents ou raccourcissez les textes.';
/**
 * Message des coupures que readEventStream (src/lib/runtime/http.ts) signale lui-même ; il parle du « serveur » :
 * remplacé ici par STREAM_INTERRUPTED_MESSAGE (vérifié par les tests).
 */
const HTTP_STREAM_INTERRUPTED_MESSAGE = 'La connexion au serveur a été interrompue pendant la génération.';

// ─── Outils ─────────────────────────────────────────────────────────────────

function abortError(): DOMException {
  return new DOMException('Opération annulée.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function unexpectedReply(): MagistraError {
  return new MagistraError('CONNECTOR_UNREACHABLE', UNEXPECTED_REPLY_MESSAGE);
}

function permissionDenied(): MagistraError {
  return new MagistraError('LOCAL_NETWORK_PERMISSION_DENIED');
}

/** Attente interruptible (rejet AbortError si le signal est interrompu). */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Ouvre une URL magistra:// (application Windows) ; toute autre URL est ignorée. Le navigateur demande en général
 * s'il faut ouvrir l'application : la page reste affichée.
 */
export function openMagistraUrl(url: string): void {
  if (typeof window === 'undefined' || !url.startsWith(`${CONNECTOR_URL_SCHEME}://`)) return;
  window.location.href = url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discard(res: Response): Promise<void> {
  return res.body ? res.body.cancel().catch(() => undefined) : Promise.resolve();
}

/** Corps texte lu au plus `maxBytes` octets (au-delà, ou UTF-8 invalide : null). */
async function readText(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(res);
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Corps JSON (Content-Type application/json exigé) ; illisible → undefined. */
async function readJson(res: Response, maxBytes: number): Promise<unknown> {
  const type = (res.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!type.startsWith('application/json')) {
    await discard(res);
    return undefined;
  }
  const text = await readText(res, maxBytes);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorCodeOf(body: unknown): ErrorCode | null {
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  return isErrorCode(code) ? code : null;
}

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= MAX_MESSAGE_CHARS ? text : undefined;
}

/** Erreur PROUVÉE (réponse de l'application appairée, messages déjà filtrés par elle) : code et message conservés. */
async function provenError(res: Response): Promise<MagistraError> {
  const body = await readJson(res, MAX_SMALL_RESPONSE_BYTES);
  const code = errorCodeOf(body);
  if (!code) return unexpectedReply();
  return new MagistraError(code, cleanMessage(isRecord(body) && isRecord(body.error) ? body.error.message : undefined));
}

// ─── Analyse des réponses ───────────────────────────────────────────────────

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_RE.test(value);
}

/** GET /v1/hello : { app: 'magistra', protocol: CONNECTOR_PROTOCOL_VERSION, version } exactement ; sinon → null. */
export function parseHello(raw: unknown): ConnectorHello | null {
  if (!isRecord(raw) || raw.app !== 'magistra' || raw.protocol !== CONNECTOR_PROTOCOL_VERSION || !isVersion(raw.version)) return null;
  return { app: 'magistra', protocol: CONNECTOR_PROTOCOL_VERSION, version: raw.version };
}

/**
 * GET /v1/hello d'une application Magistra d'une AUTRE version du protocole (entier positif, version bien formée) :
 * son numéro de protocole ; sinon null. Une telle application n'est jamais utilisée (ni appairage, ni contenu, ni
 * requête signée vers un port où elle se présente ; seul le port mémorisé d'un navigateur appairé reçoit d'abord, comme
 * tout programme qui l'occuperait, une requête signée sans contenu dont la réponse non prouvée n'est pas utilisée) :
 * seul le message affiché change (« mettez Magistra à jour » ou « rechargez la page »).
 */
export function otherProtocolOf(raw: unknown): number | null {
  if (!isRecord(raw) || raw.app !== 'magistra' || !isVersion(raw.version)) return null;
  const { protocol } = raw;
  if (typeof protocol !== 'number' || !Number.isSafeInteger(protocol) || protocol < 1 || protocol === CONNECTOR_PROTOCOL_VERSION) return null;
  return protocol;
}

/** Erreur « application d'une autre version du protocole » (plus ancienne : mise à jour ; plus récente : recharger). */
export function otherProtocolError(protocol: number): MagistraError {
  return new MagistraError('CONNECTOR_UNREACHABLE', protocol < CONNECTOR_PROTOCOL_VERSION ? APP_UPDATE_REQUIRED_MESSAGE : PAGE_RELOAD_REQUIRED_MESSAGE);
}

function parseNotice(raw: unknown): AINotice | undefined {
  if (!isRecord(raw) || !isErrorCode(raw.code)) return undefined;
  const message = cleanMessage(raw.message);
  return { code: raw.code, message: message ?? defaultMessage(raw.code) };
}

const RESEARCH_KEYS = ['academic', 'web', 'institutional', 'wikipedia'] as const;

/** GET /v1/status : forme exacte attendue, textes bornés ; sinon null. */
export function parseConnectorStatus(raw: unknown): ConnectorStatus | null {
  if (!isRecord(raw) || !isVersion(raw.version) || typeof raw.busy !== 'boolean') return null;
  const { engine, capabilities } = raw;
  if (!isRecord(engine) || typeof engine.ready !== 'boolean' || typeof engine.local !== 'boolean' || typeof engine.label !== 'string') return null;
  if (!isRecord(capabilities) || !isRecord(capabilities.research)) return null;
  const research = capabilities.research;
  if (!RESEARCH_KEYS.every(k => typeof research[k] === 'boolean')) return null;
  const max = capabilities.maxDocumentChars;
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0) return null;
  const status: ConnectorStatus = {
    version: raw.version,
    engine: { ready: engine.ready, local: engine.local, label: engine.label.trim().slice(0, MAX_LABEL_CHARS) },
    capabilities: {
      maxDocumentChars: max,
      research: {
        academic: research.academic as boolean,
        web: research.web as boolean,
        institutional: research.institutional as boolean,
        wikipedia: research.wikipedia as boolean,
      },
    },
    busy: raw.busy,
  };
  const notReady = parseNotice(engine.notReady);
  const warning = parseNotice(engine.warning);
  if (notReady) status.engine.notReady = notReady;
  if (warning) status.engine.warning = warning;
  return status;
}

interface PairApproved {
  clientId: string;
  connectorPublicKey: string;
  version: string;
}

function parseApproved(raw: unknown): PairApproved | null {
  if (!isRecord(raw) || raw.status !== 'approved') return null;
  const { clientId, connectorPublicKey, version } = raw;
  if (typeof clientId !== 'string' || !CONNECTOR_FORMATS.clientId.test(clientId)) return null;
  if (typeof connectorPublicKey !== 'string' || !CONNECTOR_FORMATS.publicKey.test(connectorPublicKey)) return null;
  if (!isVersion(version)) return null;
  return { clientId, connectorPublicKey, version };
}

// ─── Client ─────────────────────────────────────────────────────────────────

/** Issue d'une requête signée sur un port. */
type Outcome<T> =
  /** Réponse prouvée et valide. */
  | { kind: 'ok'; value: T }
  /** Réponse PROUVÉE de l'application appairée, mais en erreur : à signaler telle quelle. */
  | { kind: 'error'; error: MagistraError }
  /**
   * 401 CONNECTOR_UNPAIRED (jamais prouvé : ce programme ne connaît pas ou plus la clé de ce navigateur). `confirmed` :
   * marque de retrait valide, l'application qui détenait la clé a retiré ce navigateur ; sinon, rien ne dit que ce
   * programme ait jamais connu ce navigateur (autre application Magistra, autre session Windows).
   */
  | { kind: 'unpaired'; confirmed: boolean }
  /** Réponse sans preuve valide : un autre programme, ou une autre application Magistra. */
  | { kind: 'unproven' }
  /** Aucune réponse : port fermé, délai dépassé, requête bloquée par le navigateur. */
  | { kind: 'unreachable' };

/** Temps de POST /v1/pair : preuve de réception (aucun secret), puis fin d'appairage (vérificateur et clé). */
type PairStep = 'ack' | 'finish';

type PairOutcome =
  /** Second temps réussi (accusé valide). */
  | ({ kind: 'approved' } & PairApproved)
  /** Premier temps, accusé valide : l'enseignant a accepté ; le second temps peut partir vers CE port. */
  | { kind: 'consented' }
  /** 202, accusé valide : demande reconnue, l'enseignant n'a pas encore répondu. */
  | { kind: 'pending' }
  /**
   * Réponse sans accusé de réception valide (ou d'une forme inattendue) : ce port n'a pas reçu l'URL magistra:// de
   * ce navigateur (autre programme, autre session Windows) ; il est ignoré.
   */
  | { kind: 'unproven' }
  /** Demande inconnue de ce programme (404 ; 401/403 : ce n'est pas la demande de ce navigateur). */
  | { kind: 'unknown' }
  /** 429 : réessayer plus tard. */
  | { kind: 'retry' }
  | { kind: 'unreachable' }
  | { kind: 'error'; error: MagistraError };

interface ProvenPort {
  clientId: string;
  port: number;
  at: number;
}

type RequestBody = Uint8Array<ArrayBuffer>;

export class LocalConnectorClient {
  private readonly ports: readonly number[];
  private readonly origin: string;
  private readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  private readonly store: PairingStore;
  private readonly openUrl: (url: string) => void;
  private readonly permission: () => Promise<LoopbackPermission>;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Dernière preuve reçue dans cette session : navigateur appairé, port et instant. */
  private proven: ProvenPort | null = null;
  /** Dernier port où Magistra a répondu à hello (essayé tôt lors de la recherche suivante). */
  private lastFoundPort: number | null = null;
  /**
   * Dernière recherche : aucune application compatible, mais une application Magistra d'une autre version du
   * protocole a répondu (son numéro) ; sinon null.
   */
  private otherProtocol: number | null = null;
  /** Dernière autorisation du navigateur lue (telle quelle). */
  private lastPermission: LoopbackPermission = 'unsupported';
  /**
   * Le navigateur expose l'autorisation sans l'appliquer (politique d'entreprise, version ou dérivé de Chromium) : une
   * réponse de la boucle locale est arrivée alors qu'elle valait 'prompt', et elle vaut toujours 'prompt' ensuite. Elle
   * ne sera jamais demandée : traitée comme 'unsupported' jusqu'à la fin de la visite, jamais au-delà (si la protection
   * était appliquée plus tard, sa demande doit de nouveau être expliquée avant d'apparaître).
   */
  private promptNotEnforced = false;

  constructor(options: LocalConnectorClientOptions = {}) {
    const ports = (options.ports ?? CONNECTOR_PORTS).filter(p => Number.isInteger(p) && p > 0 && p <= 65_535);
    this.ports = ports.length ? [...new Set(ports)] : [...CONNECTOR_PORTS];
    this.origin = options.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    // Appel sans « this » : fetch du navigateur exige d'être appelé comme fonction globale.
    const customFetch = options.fetch;
    this.fetchImpl = customFetch ? (input, init) => customFetch(input, init) : (input, init) => fetch(input, init);
    this.store = options.store ?? defaultPairingStore();
    this.openUrl = options.openUrl ?? openMagistraUrl;
    this.permission = options.permission ?? (() => queryLoopbackPermission());
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // ─── API publique ─────────────────────────────────────────────────────────

  /**
   * Recherche l'application Magistra sur les ports dédiés (port mémorisé d'abord). Renvoie le premier port qui répond
   * comme Magistra, sinon null. Lève LOCAL_NETWORK_PERMISSION_DENIED si le navigateur refuse l'accès. Peut faire
   * apparaître la demande d'autorisation du navigateur (état 'prompt') : à n'appeler qu'à la demande de l'enseignant
   * dans ce cas.
   */
  async hello(signal?: AbortSignal): Promise<{ port: number; hello: ConnectorHello } | null> {
    const permission = await this.readPermission();
    if (permission === 'denied') throw permissionDenied();
    const found = await this.findApps(signal, permission === 'prompt' ? T.permissionPrompt : T.hello);
    if (found.length) return found[0];
    if (permission === 'prompt') {
      const after = await this.readPermission();
      if (after === 'denied') throw permissionDenied();
      // Accordée pendant la recherche, après la coupure de la connexion retenue par le navigateur : nouvel essai.
      if (after === 'granted') {
        const again = await this.findApps(signal, T.hello);
        if (again.length) return again[0];
      }
    }
    // Seule une application Magistra d'une autre version répond : elle est là, mais inutilisable en l'état.
    if (this.otherProtocol !== null) throw otherProtocolError(this.otherProtocol);
    return null;
  }

  /**
   * Autorisation du navigateur, lue sans la demander ; 'prompt' d'un navigateur qui ne l'applique pas (réponse déjà
   * reçue de la boucle locale sans qu'elle change) → 'unsupported'.
   */
  async readPermission(): Promise<LoopbackPermission> {
    const state = await this.rawPermission();
    this.lastPermission = state;
    return state === 'prompt' && this.promptNotEnforced ? 'unsupported' : state;
  }

  /** Un appairage est enregistré dans ce navigateur. */
  async hasPairing(): Promise<boolean> {
    return (await this.loadPairing()) !== null;
  }

  /**
   * Appairage demandé par l'enseignant : ouvre magistra://pair, attend l'application (hello toutes les secondes), puis
   * l'accord de l'enseignant, 2 minutes au plus, en deux temps :
   *  1. preuve de réception, sans secret : POST /v1/pair { pairingId } aux ports où Magistra répond (toutes les 1,5 s
   *     tant que 202) ; un port dont l'accusé de réception est absent ou faux est ignoré ;
   *  2. après { status: 'consented' } (accusé valide), et à CE port seulement : POST /v1/pair { pairingId, verifier,
   *     clientPublicKey }.
   * Termine par une preuve (GET /v1/status) : la clé est la même des deux côtés.
   * `onCode` reçoit, avant l'ouverture de magistra://pair, le code de vérification que la boîte de consentement de
   * l'application affichera (à montrer à l'enseignant).
   * Lève CONNECTOR_PAIRING_REFUSED, CONNECTOR_PAIRING_EXPIRED, CONNECTOR_UNREACHABLE, LOCAL_NETWORK_PERMISSION_DENIED,
   * ou une AbortError si `signal` est interrompu.
   */
  async pair(signal: AbortSignal, onCode?: (code: string) => void): Promise<void> {
    throwIfAborted(signal);
    if (!isWebCryptoAvailable()) throw new MagistraError('INTERNAL', UNSUPPORTED_BROWSER_MESSAGE);
    const permission = await this.readPermission();
    if (permission === 'denied') throw permissionDenied();
    const previous = await this.loadPairing();
    const secrets = await createPairingSecrets();
    const keys = await generateClientKeyPair();
    const code = await pairingCode(secrets.challenge);
    // Accusé attendu de CHAQUE port : il inclut l'hôte joint (un relais sur un autre port ne peut pas le fournir).
    const acks = new Map<number, string>();
    for (const port of this.ports) acks.set(port, await expectedPairAck(secrets.pairingId, secrets.challenge, connectorHost(port)));
    const probe: PairAckRequest = { pairingId: secrets.pairingId };
    const finish: PairFinishRequest = { pairingId: secrets.pairingId, verifier: secrets.verifier, clientPublicKey: keys.publicKey };
    const probeBody = utf8(JSON.stringify(probe));
    const finishBody = utf8(JSON.stringify(finish));
    const deadline = this.now() + T.pairing;
    throwIfAborted(signal);
    onCode?.(code);
    // Seuls l'identifiant de la demande, le défi et l'origine voyagent dans l'URL : jamais le vérificateur.
    this.openUrl(buildPairingUrl({ pairingId: secrets.pairingId, challenge: secrets.challenge, origin: this.origin }));

    const helloWait = permission === 'prompt' ? T.permissionPrompt : T.hello;
    /**
     * Port qui a prouvé avoir reçu la demande (accusé valide) : les essais suivants y vont directement, et lui seul
     * peut recevoir le second temps.
     */
    let acknowledged: number | null = null;
    let everAcknowledged = false;
    let appSeen = false;
    for (;;) {
      throwIfAborted(signal);
      if (this.now() >= deadline) {
        if (everAcknowledged) throw new MagistraError('CONNECTOR_PAIRING_EXPIRED');
        if (appSeen) throw new MagistraError('CONNECTOR_PAIRING_EXPIRED', PAIRING_NOT_RECEIVED_MESSAGE);
        if (this.otherProtocol !== null) throw otherProtocolError(this.otherProtocol);
        throw new MagistraError('CONNECTOR_UNREACHABLE');
      }
      // Recherche bornée par l'échéance (la demande du navigateur peut retenir la requête jusqu'à la réponse).
      const wait = Math.max(1, Math.min(helloWait, deadline - this.now()));
      const candidates: number[] = acknowledged !== null ? [acknowledged] : (await this.findApps(signal, wait)).map(app => app.port);
      if (candidates.length) appSeen = true;
      else if (permission === 'prompt' && (await this.readPermission()) === 'denied') throw permissionDenied();
      for (const port of candidates) {
        const ack = acks.get(port)!;
        let outcome = await this.postPair(port, probeBody, ack, 'ack', signal);
        if (outcome.kind === 'consented') {
          acknowledged = port;
          everAcknowledged = true;
          // Second temps : le vérificateur et la clé publique ne partent qu'à ce port, qui a prouvé avoir reçu l'URL.
          outcome = await this.postPair(port, finishBody, ack, 'finish', signal);
          if (outcome.kind === 'approved') {
            await this.completePairing(outcome, port, keys, secrets, previous, signal);
            return;
          }
        }
        if (outcome.kind === 'error') throw outcome.error;
        if (outcome.kind === 'pending') {
          acknowledged = port;
          everAcknowledged = true;
          break;
        }
        if (port === acknowledged) {
          // Demande reconnue puis perdue : remplacée par une autre (autre onglet, double clic) ou retirée ; ou
          // application fermée et port repris par un autre programme (accusé absent).
          if (outcome.kind === 'unknown' || outcome.kind === 'unproven') throw new MagistraError('CONNECTOR_PAIRING_EXPIRED');
          // Application fermée pendant l'attente : nouvelle recherche.
          if (outcome.kind === 'unreachable') acknowledged = null;
          break;
        }
        // Accusé absent ou faux (autre programme, autre session Windows), demande inconnue, 429 : port suivant.
      }
      await this.sleep(acknowledged !== null ? T.pairPoll : T.helloPoll, signal);
    }
  }

  /**
   * État du moteur (GET /v1/status signé, preuve exigée). Essaie le port mémorisé, puis tous les ports où Magistra
   * répond. Lève CONNECTOR_UNPAIRED (aucun appairage ; retrait prouvé par la marque de retrait : l'appairage est alors
   * oublié ; ou, appairage GARDÉ, message UNRECOGNIZED_BY_APP_MESSAGE : une application Magistra répond sans
   * reconnaître ce navigateur ni prouver l'avoir retiré), CONNECTOR_UNREACHABLE (application fermée, ou aucune réponse
   * prouvée), LOCAL_NETWORK_PERMISSION_DENIED, ou l'erreur prouvée renvoyée par l'application.
   */
  async status(signal?: AbortSignal): Promise<ConnectorStatus> {
    const pairing = await this.loadPairing();
    if (!pairing) throw new MagistraError('CONNECTOR_UNPAIRED');
    const permission = await this.readPermission();
    if (permission === 'denied') throw permissionDenied();
    let revoked = false;
    let unrecognized = false;
    const attempt = async (port: number, waitMs: number): Promise<ConnectorStatus | null> => {
      const outcome = await this.tryStatus(pairing, port, signal, waitMs);
      if (outcome.kind === 'ok') {
        await this.remember(pairing, port);
        return outcome.value;
      }
      if (outcome.kind === 'error') {
        await this.remember(pairing, port);
        throw outcome.error;
      }
      if (outcome.kind === 'unpaired') {
        if (outcome.confirmed) revoked = true;
        else unrecognized = true;
      }
      return null;
    };
    /** Port mémorisé, puis chaque port où Magistra répond (chacun essayé une fois). */
    const round = async (statusMs: number, helloMs: number): Promise<ConnectorStatus | null> => {
      const tried = new Set<number>();
      if (this.ports.includes(pairing.port)) {
        tried.add(pairing.port);
        const status = await attempt(pairing.port, statusMs);
        if (status) return status;
      }
      for (const { port } of await this.findApps(signal, helloMs)) {
        if (tried.has(port)) continue;
        tried.add(port);
        const status = await attempt(port, statusMs);
        if (status) return status;
      }
      return null;
    };

    const prompt = permission === 'prompt';
    const status = (await round(prompt ? T.permissionPrompt : T.status, prompt ? T.permissionPrompt : T.hello))
      // Accordée pendant la première série, après la coupure de la connexion retenue par le navigateur : nouvel essai.
      ?? (prompt && !revoked && (await this.readPermission()) === 'granted' ? await round(T.status, T.hello) : null);
    if (status) return status;
    if (this.proven?.clientId === pairing.clientId) this.proven = null;
    if (revoked) {
      await this.forget(pairing);
      throw new MagistraError('CONNECTOR_UNPAIRED');
    }
    if (unrecognized) throw new MagistraError('CONNECTOR_UNPAIRED', UNRECOGNIZED_BY_APP_MESSAGE);
    if (prompt && (await this.readPermission()) === 'denied') throw permissionDenied();
    if (this.otherProtocol !== null) throw otherProtocolError(this.otherProtocol);
    throw new MagistraError('CONNECTOR_UNREACHABLE');
  }

  /**
   * Génération en flux par Magistra locale. Les évènements (NDJSON) sont transmis dans l'ordre ; toutes les erreurs
   * deviennent un évènement « error » (jamais de repli vers un autre moteur). L'évènement « done » porte `record`
   * (génération à enregistrer par le site). Interruption (`signal`) : la connexion est fermée et l'arrêt est
   * demandé à l'application (POST /v1/cancel, au mieux).
   */
  async generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    const fail = (err: unknown) => {
      const e = signal.aborted || isAbortError(err) ? new MagistraError('GENERATION_ABORTED') : toMagistraError(err, 'CONNECTOR_UNREACHABLE');
      onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
    };
    let target: { pairing: StoredPairing; port: number; body: RequestBody };
    try {
      throwIfAborted(signal);
      const body = utf8(JSON.stringify(request));
      if (body.byteLength > CONNECTOR_LIMITS.generateBodyBytes) throw new MagistraError('DOCUMENT_TOO_LARGE', REQUEST_TOO_LARGE_MESSAGE);
      target = { ...(await this.provenTarget(signal)), body };
    } catch (err) {
      fail(err);
      return;
    }
    await this.stream(target, onEvent, signal, fail);
  }

  /**
   * Retire l'autorisation de CE navigateur dans l'application (DELETE /v1/pair signé, au mieux), puis oublie
   * l'appairage localement même si l'application est fermée ou injoignable. Renvoie vrai si l'application a confirmé
   * le retrait (réponse prouvée, ou marque de retrait valide : elle l'avait déjà retiré), ou si rien n'était appairé ;
   * faux sinon — y compris pour le 401 d'une autre application Magistra (autre session Windows) qui ne connaît pas ce
   * navigateur : l'enseignant doit alors vérifier dans son application (Réglages → « Site web Magistra »).
   */
  async unpair(): Promise<boolean> {
    const pairing = await this.loadPairing();
    if (!pairing) {
      this.proven = null;
      return true;
    }
    let revoked = false;
    try {
      const permission = await this.readPermission();
      if (permission !== 'denied') {
        const attempt = async (revokeMs: number, helloMs: number): Promise<boolean> => {
          if (this.ports.includes(pairing.port) && (await this.revoke(pairing, pairing.port, revokeMs))) return true;
          for (const { port } of await this.findApps(undefined, helloMs)) {
            if (port !== pairing.port && (await this.revoke(pairing, port, revokeMs))) return true;
          }
          return false;
        };
        // Autorisation à demander : comme status() et hello(), le navigateur retient la requête jusqu'à la réponse de
        // l'enseignant (qui lit sa question juste après l'explication du site) ; jamais abandonnée au bout de 5 s.
        const prompt = permission === 'prompt';
        revoked = await attempt(prompt ? T.permissionPrompt : T.small, prompt ? T.permissionPrompt : T.hello);
        // Accordée pendant le premier essai, après la coupure de la connexion retenue par le navigateur : nouvel essai.
        if (!revoked && prompt && (await this.readPermission()) === 'granted') revoked = await attempt(T.small, T.hello);
      }
    } catch {
      // Au mieux : l'enseignant peut aussi retirer l'autorisation dans l'application.
    } finally {
      await this.forget(pairing);
    }
    return revoked;
  }

  // ─── Appairage mémorisé ───────────────────────────────────────────────────

  private async loadPairing(): Promise<StoredPairing | null> {
    try {
      const pairing = await this.store.load();
      return pairing && isStoredPairing(pairing) ? pairing : null;
    } catch {
      return null;
    }
  }

  /** Oublie CET appairage (pas celui qu'un autre onglet aurait créé entre-temps). */
  private async forget(pairing: StoredPairing): Promise<void> {
    if (this.proven?.clientId === pairing.clientId) this.proven = null;
    try {
      const current = await this.store.load();
      if (!current || current.clientId === pairing.clientId) await this.store.clear();
    } catch {
      // Magasin inaccessible : rien de plus à oublier.
    }
  }

  /** Preuve reçue sur ce port : mémorisée pour la session, et port enregistré s'il a changé. */
  private async remember(pairing: StoredPairing, port: number): Promise<void> {
    this.proven = { clientId: pairing.clientId, port, at: this.now() };
    this.lastFoundPort = port;
    if (port === pairing.port) return;
    try {
      const current = await this.store.load();
      if (current?.clientId === pairing.clientId) await this.store.save({ ...current, port });
    } catch {
      // Port non enregistré : il sera retrouvé par la recherche suivante.
    }
  }

  private isFresh(pairing: StoredPairing): boolean {
    const p = this.proven;
    if (!p || p.clientId !== pairing.clientId) return false;
    const age = this.now() - p.at;
    return age >= 0 && age <= T.proofMaxAge;
  }

  /** Port qui a prouvé récemment détenir la clé ; sinon, nouvelle preuve (GET /v1/status) avant tout envoi. */
  private async provenTarget(signal: AbortSignal): Promise<{ pairing: StoredPairing; port: number }> {
    let pairing = await this.loadPairing();
    if (!pairing) throw new MagistraError('CONNECTOR_UNPAIRED');
    if (!this.isFresh(pairing)) {
      await this.status(signal);
      pairing = await this.loadPairing();
      if (!pairing || !this.isFresh(pairing)) throw new MagistraError('CONNECTOR_UNREACHABLE');
    }
    return { pairing, port: this.proven!.port };
  }

  /** Autorisation du navigateur telle que lue (jamais d'exception). */
  private async rawPermission(): Promise<LoopbackPermission> {
    try {
      const state = await this.permission();
      return state === 'granted' || state === 'prompt' || state === 'denied' ? state : 'unsupported';
    } catch {
      return 'unsupported';
    }
  }

  // ─── Requêtes ─────────────────────────────────────────────────────────────

  private async send(port: number, path: ConnectorRoute, init: { method: string; headers?: Record<string, string>; body?: RequestBody }, signal: AbortSignal): Promise<Response> {
    const request: RequestInit & { targetAddressSpace: 'loopback' } = {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      targetAddressSpace: 'loopback',
    };
    const res = await this.fetchImpl(`http://${connectorHost(port)}${path}`, request);
    // Réponse reçue de la boucle locale alors que l'autorisation valait 'prompt' : un navigateur qui applique la
    // protection l'a accordée avant d'envoyer la requête ; toujours 'prompt' → il ne l'applique pas.
    if (this.lastPermission === 'prompt' && !this.promptNotEnforced && (await this.rawPermission()) === 'prompt') this.promptNotEnforced = true;
    return res;
  }

  /** Exécute `run` avec un signal interrompu par `signal` OU après `ms` millisecondes. */
  private async withTimeout<R>(signal: AbortSignal | undefined, ms: number, run: (signal: AbortSignal) => Promise<R>): Promise<R> {
    throwIfAborted(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Requête signée ; `proven` : la réponse porte la preuve valide de l'application appairée pour CE nonce. */
  private async signed(pairing: StoredPairing, port: number, method: 'GET' | 'POST' | 'DELETE', path: ConnectorRoute, body: RequestBody | null, signal: AbortSignal): Promise<{ res: Response; proven: boolean }> {
    const timestamp = String(Math.floor(this.now()));
    const nonce = randomToken(NONCE_BYTES);
    const payload: RequestBody = body ?? new Uint8Array(0);
    // Hôte visé signé : relayée vers un autre port, la requête ne vaut rien pour l'application qui y écoute.
    const host = connectorHost(port);
    const signature = await signRequest(pairing.key, {
      method, host, path, origin: this.origin, clientId: pairing.clientId, timestamp, nonce, bodySha256: await sha256Base64Url(payload),
    });
    const headers: Record<string, string> = {
      [CONNECTOR_HEADERS.client]: pairing.clientId,
      [CONNECTOR_HEADERS.timestamp]: timestamp,
      [CONNECTOR_HEADERS.nonce]: nonce,
      [CONNECTOR_HEADERS.signature]: signature,
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await this.send(port, path, { method, headers, body: body ?? undefined }, signal);
    const proven = await verifyProof(pairing.key, pairing.clientId, nonce, host, res.headers.get(CONNECTOR_HEADERS.proof));
    return { res, proven };
  }

  /**
   * Classe la réponse à une requête signée de `pairing`. Réponse non prouvée : seuls le code d'un 401 et sa marque de
   * retrait sont lus, jamais le message.
   */
  private async classify<V>(pairing: StoredPairing, res: Response, proven: boolean, parse: (raw: unknown) => V | null, maxBytes: number): Promise<Outcome<V>> {
    if (!proven) {
      if (res.status !== 401) {
        await discard(res);
        return { kind: 'unproven' };
      }
      if (errorCodeOf(await readJson(res, MAX_SMALL_RESPONSE_BYTES)) !== 'CONNECTOR_UNPAIRED') return { kind: 'unproven' };
      return { kind: 'unpaired', confirmed: await verifyRevokedMark(pairing.key, pairing.clientId, res.headers.get(CONNECTOR_HEADERS.revoked)) };
    }
    if (!res.ok) return { kind: 'error', error: await provenError(res) };
    const value = parse(await readJson(res, maxBytes));
    return value === null ? { kind: 'error', error: unexpectedReply() } : { kind: 'ok', value };
  }

  private async tryStatus(pairing: StoredPairing, port: number, signal: AbortSignal | undefined, waitMs: number): Promise<Outcome<ConnectorStatus>> {
    try {
      return await this.withTimeout(signal, waitMs, async s => {
        const { res, proven } = await this.signed(pairing, port, 'GET', CONNECTOR_ROUTES.status, null, s);
        return this.classify(pairing, res, proven, parseConnectorStatus, MAX_STATUS_RESPONSE_BYTES);
      });
    } catch {
      if (signal?.aborted) throw abortError();
      return { kind: 'unreachable' };
    }
  }

  // ─── Recherche ────────────────────────────────────────────────────────────

  private async portOrder(): Promise<number[]> {
    const pairing = await this.loadPairing();
    const preferred = [pairing?.port, this.lastFoundPort].filter((p): p is number => typeof p === 'number' && this.ports.includes(p));
    return [...new Set([...preferred, ...this.ports])];
  }

  /**
   * Sonde tous les ports en parallèle ; ports où Magistra répond, dans l'ordre de préférence. Aucune application
   * compatible mais une d'une autre version du protocole : son numéro est noté (otherProtocol).
   */
  private async findApps(signal: AbortSignal | undefined, waitMs: number): Promise<{ port: number; hello: ConnectorHello }[]> {
    throwIfAborted(signal);
    const order = await this.portOrder();
    const replies = await Promise.all(order.map(port => this.probe(port, signal, waitMs)));
    throwIfAborted(signal);
    const found: { port: number; hello: ConnectorHello }[] = [];
    let otherProtocol: number | null = null;
    order.forEach((port, i) => {
      const reply = replies[i];
      if (reply?.kind === 'magistra') found.push({ port, hello: reply.hello });
      else if (reply?.kind === 'other-protocol') otherProtocol ??= reply.protocol;
    });
    if (found.length) this.lastFoundPort = found[0].port;
    this.otherProtocol = found.length ? null : otherProtocol;
    return found;
  }

  private async probe(
    port: number, signal: AbortSignal | undefined, waitMs: number,
  ): Promise<{ kind: 'magistra'; hello: ConnectorHello } | { kind: 'other-protocol'; protocol: number } | null> {
    try {
      return await this.withTimeout(signal, waitMs, async s => {
        const res = await this.send(port, CONNECTOR_ROUTES.hello, { method: 'GET' }, s);
        if (res.status !== 200) {
          await discard(res);
          return null;
        }
        const raw = await readJson(res, MAX_SMALL_RESPONSE_BYTES);
        const hello = parseHello(raw);
        if (hello) return { kind: 'magistra', hello };
        const protocol = otherProtocolOf(raw);
        return protocol === null ? null : { kind: 'other-protocol', protocol };
      });
    } catch {
      if (signal?.aborted) throw abortError();
      return null;
    }
  }

  // ─── Appairage ────────────────────────────────────────────────────────────

  /**
   * Un essai de POST /v1/pair (`step` : preuve de réception ou fin d'appairage). Aucune clé encore : une réponse
   * réussie ne compte que si elle porte l'accusé de réception attendu (sinon 'unproven', port ignoré) ; pour une
   * erreur, seuls le statut et le code comptent (jamais le message). Refus et expiration arrêtent l'appairage d'où
   * qu'ils viennent : ils ne font rien envoyer (un programme qui occupe les ports dédiés peut de toute façon
   * l'empêcher) et l'enseignant qui refuse avant le premier essai l'apprend aussitôt. Premier temps : toute autre
   * erreur vient d'un port qui n'a rien prouvé, elle est ignorée comme lui.
   */
  private async postPair(port: number, body: RequestBody, ack: string, step: PairStep, signal: AbortSignal): Promise<PairOutcome> {
    try {
      return await this.withTimeout(signal, T.pairRequest, async (s): Promise<PairOutcome> => {
        const res = await this.send(port, CONNECTOR_ROUTES.pair, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, s);
        const payload = await readJson(res, MAX_SMALL_RESPONSE_BYTES);
        if (res.status === 200 || res.status === 202) {
          if (!isRecord(payload) || !verifyPairAck(ack, payload.ack)) return { kind: 'unproven' };
          if (res.status === 202) return payload.status === 'pending' ? { kind: 'pending' } : { kind: 'unproven' };
          if (step === 'ack') return payload.status === 'consented' ? { kind: 'consented' } : { kind: 'unproven' };
          // Accusé valide : c'est l'application qui a reçu la demande ; une réponse mal formée est une incompatibilité.
          const approved = parseApproved(payload);
          return approved ? { kind: 'approved', ...approved } : { kind: 'error', error: unexpectedReply() };
        }
        const code = errorCodeOf(payload);
        if (code === 'CONNECTOR_PAIRING_REFUSED') return { kind: 'error', error: new MagistraError('CONNECTOR_PAIRING_REFUSED') };
        if (code === 'CONNECTOR_PAIRING_EXPIRED' || res.status === 410) return { kind: 'error', error: new MagistraError('CONNECTOR_PAIRING_EXPIRED') };
        if (res.status === 404 || res.status === 401 || res.status === 403) return { kind: 'unknown' };
        if (res.status === 429) return { kind: 'retry' };
        if (step === 'ack') return { kind: 'unproven' };
        return { kind: 'error', error: code ? new MagistraError(code) : unexpectedReply() };
      });
    } catch {
      if (signal.aborted) throw abortError();
      return { kind: 'unreachable' };
    }
  }

  private async completePairing(
    approved: PairApproved, port: number, keys: ClientKeyPair, secrets: PairingSecrets, previous: StoredPairing | null, signal: AbortSignal,
  ): Promise<void> {
    let key: CryptoKey;
    try {
      key = await deriveHmacKey(keys.privateKey, approved.connectorPublicKey, secrets.pairingId);
    } catch {
      throw unexpectedReply();
    }
    const pairing: StoredPairing = { clientId: approved.clientId, key, port, pairedAt: new Date(this.now()).toISOString() };
    await this.store.save(pairing);
    this.proven = null;
    this.lastFoundPort = port;
    // Preuve immédiate que les deux côtés ont la même clé ; sinon l'appairage est inutilisable : oublié tout de suite.
    const outcome = await this.tryStatus(pairing, port, signal, T.status);
    if (outcome.kind === 'ok' || outcome.kind === 'error') await this.remember(pairing, port);
    if (outcome.kind === 'unproven' || outcome.kind === 'unpaired') {
      await this.forget(pairing);
      throw unexpectedReply();
    }
    // Reconnexion : l'ancienne autorisation de ce navigateur est retirée de l'application (au mieux).
    if (previous && previous.clientId !== pairing.clientId) await this.revoke(previous, port);
  }

  /**
   * DELETE /v1/pair signé. Vrai si l'application a confirmé le retrait (preuve), ou l'avait déjà fait (marque de
   * retrait valide) ; un 401 sans marque (autre application Magistra, autre session Windows) ne confirme rien.
   */
  private async revoke(pairing: StoredPairing, port: number, waitMs: number = T.small): Promise<boolean> {
    try {
      return await this.withTimeout(undefined, waitMs, async s => {
        const { res, proven } = await this.signed(pairing, port, 'DELETE', CONNECTOR_ROUTES.pair, null, s);
        const outcome = await this.classify(pairing, res, proven, () => true, MAX_SMALL_RESPONSE_BYTES);
        return outcome.kind === 'ok' || (outcome.kind === 'unpaired' && outcome.confirmed);
      });
    } catch {
      return false;
    }
  }

  // ─── Génération ───────────────────────────────────────────────────────────

  private async stream(
    target: { pairing: StoredPairing; port: number; body: RequestBody },
    onEvent: (event: GenerationEvent) => void,
    signal: AbortSignal,
    fail: (err: unknown) => void,
  ): Promise<void> {
    const { pairing, port, body } = target;
    const controller = new AbortController();
    let jobId: string | null = null;
    const onAbort = () => {
      controller.abort();
      if (jobId) void this.cancelJob(pairing, port, jobId);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    try {
      const headersTimer = setTimeout(() => controller.abort(), T.generateHeaders);
      let res: Response;
      let proven: boolean;
      try {
        ({ res, proven } = await this.signed(pairing, port, 'POST', CONNECTOR_ROUTES.generate, body, controller.signal));
      } catch (err) {
        if (!signal.aborted) this.proven = null;
        fail(signal.aborted ? err : new MagistraError('CONNECTOR_UNREACHABLE'));
        return;
      } finally {
        clearTimeout(headersTimer);
      }
      if (!proven) {
        // Autre programme sur le port, ou autorisation retirée à l'instant : rien n'est lu de cette réponse. Oubli
        // seulement sur un retrait prouvé (marque de retrait) ; sinon l'état sera relu (appairage gardé).
        this.proven = null;
        const outcome = await this.classify(pairing, res, false, () => null, MAX_SMALL_RESPONSE_BYTES);
        if (outcome.kind === 'unpaired' && outcome.confirmed) {
          await this.forget(pairing);
          fail(new MagistraError('CONNECTOR_UNPAIRED'));
        } else {
          fail(new MagistraError('CONNECTOR_UNREACHABLE'));
        }
        return;
      }
      if (!res.ok) {
        fail(await provenError(res));
        return;
      }
      const job = res.headers.get(CONNECTOR_HEADERS.job);
      jobId = job && CONNECTOR_FORMATS.jobId.test(job) ? job : null;
      // Interrompu entre l'envoi et la réponse : l'arrêt est demandé maintenant que la génération est identifiée.
      if (signal.aborted && jobId) void this.cancelJob(pairing, port, jobId);
      const relay = (event: GenerationEvent) => {
        if (event.type === 'error' && event.code === 'NETWORK_ERROR' && event.message === HTTP_STREAM_INTERRUPTED_MESSAGE) {
          onEvent({ ...event, code: 'CONNECTOR_UNREACHABLE', message: STREAM_INTERRUPTED_MESSAGE, retryable: true });
          return;
        }
        if (event.type === 'error' && event.code === 'GENERATION_ABORTED' && !signal.aborted) {
          // Arrêt venu de l'application, pas de ce site : erreur explicite (l'état de Magistra locale sera relu).
          onEvent({ ...event, code: 'CONNECTOR_UNREACHABLE', message: STOPPED_BY_APP_MESSAGE, retryable: true });
          return;
        }
        onEvent(event);
      };
      try {
        await readEventStream(res, relay, controller.signal);
      } catch (err) {
        const e = toMagistraError(err, 'CONNECTOR_UNREACHABLE');
        if (e.code === 'SERVER_MISCONFIGURED') fail(unexpectedReply());
        else if (e.code === 'NETWORK_ERROR') fail(new MagistraError('CONNECTOR_UNREACHABLE', STREAM_INTERRUPTED_MESSAGE));
        else fail(e);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      // Réponse non lue jusqu'au bout (erreur, flux inattendu) : la connexion est fermée.
      controller.abort();
    }
  }

  /** POST /v1/cancel signé, au mieux : la fermeture de la connexion interrompt déjà la génération. */
  private async cancelJob(pairing: StoredPairing, port: number, jobId: string): Promise<void> {
    const request: ConnectorCancelRequest = { jobId };
    try {
      await this.withTimeout(undefined, T.small, async s => {
        const { res } = await this.signed(pairing, port, 'POST', CONNECTOR_ROUTES.cancel, utf8(JSON.stringify(request)), s);
        await discard(res);
      });
    } catch {
      // Au mieux.
    }
  }
}
