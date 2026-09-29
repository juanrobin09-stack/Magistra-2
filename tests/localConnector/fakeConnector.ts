// Faux connecteur local conforme au protocole (shared/localConnector.ts), écrit avec node:crypto : il remplace fetch
// et l'ouverture des URL magistra:// pour tester le client du site sans application Windows. L'interopérabilité avec
// le vrai connecteur (electron/connector) est vérifiée par les tests d'intégration.
//
// Chaque port simule : rien (connexion refusée), l'application Magistra de l'enseignant, une AUTRE application
// Magistra (autre session Windows : ne connaît pas ce navigateur), un imposteur (répond comme Magistra, sans clé),
// ou un port qui ne répond jamais.

import { createECDH, createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  canonicalProof, canonicalRequest, CONNECTOR_CRYPTO, CONNECTOR_FORMATS, CONNECTOR_HEADERS, CONNECTOR_LIMITS,
  CONNECTOR_PROTOCOL_VERSION, CONNECTOR_ROUTES, parseAppUrl, type ConnectorStatus,
} from '@shared/localConnector';
import type { ErrorCode } from '@shared/errors';
import type { GenerationEvent } from '@shared/types';

export const SITE_ORIGIN = 'https://magistra-2.vercel.app';
export const T0 = Date.UTC(2026, 8, 29, 8, 0, 0);

export type PortMode = 'closed' | 'magistra' | 'other-magistra' | 'impostor' | 'hang';

export interface RecordedRequest {
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  init: RequestInit & { targetAddressSpace?: string };
}

interface FakeClient {
  clientId: string;
  key: Buffer;
  origin: string;
}

interface Demand {
  pairingId: string;
  challenge: string;
  origin: string;
  state: 'awaiting' | 'approved' | 'refused';
  polls: number;
}

export const READY_STATUS: ConnectorStatus = {
  version: '2.1.0',
  engine: { ready: true, local: true, label: 'Magistra Standard' },
  capabilities: { maxDocumentChars: 30_000, research: { academic: true, web: false, institutional: false, wikipedia: true } },
  busy: false,
};

export const RECORD = {
  type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'La fable', contenu: '# La fable\n\nTexte.',
  sources: [], params: { researchMode: 'documents' }, truncated: false, internetUsed: false, model: 'magistra-standard',
} as const;

export const DEFAULT_EVENTS: GenerationEvent[] = [
  { type: 'status', stage: 'generating', message: 'Rédaction…' },
  { type: 'delta', text: '# La fable' },
  { type: 'delta', text: '\n\nTexte.' },
  {
    type: 'done', content: '# La fable\n\nTexte.', sources: [], truncated: false, internetUsed: false, saved: false,
    model: 'magistra-standard', record: { ...RECORD, sources: [], params: { ...RECORD.params } },
  },
];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function apiError(status: number, code: ErrorCode, headers: Record<string, string> = {}, message = 'Message du connecteur.'): Response {
  return json(status, { error: { code, message, retryable: false } }, headers);
}

function b64(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function sameMac(a: string, b: Buffer): boolean {
  const bytes = Buffer.from(a, 'base64url');
  return bytes.length === b.length && timingSafeEqual(bytes, b);
}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** Promesse qui ne se résout jamais, rejetée quand le signal est interrompu. */
function hang(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

export class FakeConnector {
  /** Origine envoyée par le « navigateur » dans l'en-tête Origin. */
  browserOrigin = SITE_ORIGIN;
  allowedOrigins = [SITE_ORIGIN];
  version = '2.1.0';
  readonly ports = new Map<number, PortMode>();
  readonly clients = new Map<string, FakeClient>();
  readonly requests: RecordedRequest[] = [];
  readonly openedUrls: string[] = [];
  readonly cancelled: string[] = [];
  readonly seenNonces = new Set<string>();
  demand: Demand | null = null;
  /** L'application reçoit les URL magistra:// (faux : protocole non enregistré, boîte refusée…). */
  receivesUrls = true;
  /** Réponse de l'enseignant après ce nombre d'essais de fin d'appairage (202 jusque-là) ; null : jamais. */
  answerAfterPolls: number | null = 2;
  approve = true;
  /** Demande expirée (410). */
  expired = false;
  /** Déclenché par magistra://open (ex. : l'application démarre). */
  onOpen: (() => void) | null = null;
  /** Déclenché à chaque ouverture de magistra://pair (ex. : l'application démarre). */
  onPairUrl: (() => void) | null = null;
  status: ConnectorStatus = structuredClone(READY_STATUS);
  events: GenerationEvent[] = structuredClone(DEFAULT_EVENTS);
  /** Erreur (avec preuve) renvoyée par POST /v1/generate au lieu du flux. */
  generateError: { status: number; code: ErrorCode; message: string } | null = null;
  /** Flux gardé ouvert après les évènements (jusqu'à la fermeture par le navigateur). */
  holdStream = false;
  /** Flux coupé après les évènements, sans évènement final. */
  cutStream = false;
  /** Nombre de flux fermés par le navigateur avant la fin. */
  streamsClosedByBrowser = 0;
  /** Preuve : 'valid', absente, ou fausse (autre clé). */
  proofMode: 'valid' | 'none' | 'wrong' = 'valid';
  /** Appairage : clé dérivée avec un autre sel (protocole incompatible). */
  deriveWrongKey = false;
  /** Réponse d'appairage acceptée mais clé publique invalide. */
  badConnectorKey = false;
  /** Réponse imposée pour une requête (programme inconnu sur un port…) ; undefined : comportement normal. */
  intercept: ((port: number, path: string, method: string) => Response | undefined) | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => T0) {
    this.now = now;
  }

  setPort(port: number, mode: PortMode): this {
    this.ports.set(port, mode);
    return this;
  }

  /** Requêtes reçues sur une route (dans l'ordre). */
  calls(path?: string, method?: string): RecordedRequest[] {
    return this.requests.filter(r => (!path || r.path === path) && (!method || r.method === method));
  }

  openUrl = (url: string): void => {
    this.openedUrls.push(url);
    const parsed = parseAppUrl(url);
    if (parsed?.kind === 'open') this.onOpen?.();
    if (parsed?.kind === 'pair') {
      this.onPairUrl?.();
      if (this.receivesUrls && this.allowedOrigins.includes(parsed.origin)) {
        this.demand = { pairingId: parsed.pairingId, challenge: parsed.challenge, origin: parsed.origin, state: 'awaiting', polls: 0 };
      }
    }
  };

  /** Appairage direct (sans passer par le client) : renvoie la clé partagée, pour les tests du contrôleur. */
  addClient(clientId: string, key: Buffer, origin = SITE_ORIGIN): void {
    this.clients.set(clientId, { clientId, key, origin });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const port = Number(url.port);
    const body = init.body === undefined || init.body === null ? '' : Buffer.from(init.body as Uint8Array).toString('utf8');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.requests.push({ port, method: init.method ?? 'GET', path: url.pathname, headers, body, init: init as RecordedRequest['init'] });
    if (init.signal?.aborted) throw abortError();
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.search || url.hash) throw new TypeError('Failed to fetch');
    const intercepted = this.intercept?.(port, url.pathname, init.method ?? 'GET');
    if (intercepted) return intercepted;
    const mode = this.ports.get(port) ?? 'closed';
    if (mode === 'closed') throw new TypeError('Failed to fetch');
    if (mode === 'hang') return hang(init.signal);
    const origin = this.browserOrigin;
    if (!this.allowedOrigins.includes(origin)) throw new TypeError('Failed to fetch'); // 403 sans CORS : illisible
    const method = init.method ?? 'GET';
    const path = url.pathname;

    if (path === CONNECTOR_ROUTES.hello && method === 'GET') {
      return json(200, { app: 'magistra', protocol: CONNECTOR_PROTOCOL_VERSION, version: this.version });
    }
    if (mode === 'impostor') {
      // Se fait passer pour Magistra, sans connaître aucune clé : jamais de preuve valide.
      if (path === CONNECTOR_ROUTES.status) return json(200, this.status, this.proofMode === 'wrong' ? { [CONNECTOR_HEADERS.proof]: b64(randomBytes(32)) } : {});
      if (path === CONNECTOR_ROUTES.generate) return new Response('{"type":"done"}\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      return json(200, { ok: true });
    }
    if (path === CONNECTOR_ROUTES.pair && method === 'POST') return mode === 'other-magistra' ? apiError(404, 'NOT_FOUND') : this.completePairing(body, origin);

    // Routes signées.
    const clientId = headers[CONNECTOR_HEADERS.client.toLowerCase()] ?? '';
    const timestamp = headers[CONNECTOR_HEADERS.timestamp.toLowerCase()] ?? '';
    const nonce = headers[CONNECTOR_HEADERS.nonce.toLowerCase()] ?? '';
    const signature = headers[CONNECTOR_HEADERS.signature.toLowerCase()] ?? '';
    if (!CONNECTOR_FORMATS.clientId.test(clientId) || !CONNECTOR_FORMATS.timestamp.test(timestamp)
      || !CONNECTOR_FORMATS.nonce.test(nonce) || !CONNECTOR_FORMATS.mac.test(signature)) {
      return apiError(401, 'UNAUTHENTICATED');
    }
    const client = mode === 'magistra' ? this.clients.get(clientId) : undefined;
    if (!client || client.origin !== origin) return apiError(401, 'CONNECTOR_UNPAIRED');
    if (Math.abs(this.now() - Number(timestamp)) > CONNECTOR_LIMITS.clockSkewMs) return apiError(401, 'UNAUTHENTICATED');
    if (this.seenNonces.has(`${clientId}.${nonce}`)) return apiError(401, 'UNAUTHENTICATED');
    const bodySha256 = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
    const expected = createHmac('sha256', client.key)
      .update(canonicalRequest({ method, path, origin, clientId, timestamp, nonce, bodySha256 }), 'utf8')
      .digest();
    if (!sameMac(signature, expected)) return apiError(401, 'UNAUTHENTICATED');
    this.seenNonces.add(`${clientId}.${nonce}`);
    const proofKey = this.proofMode === 'wrong' ? randomBytes(32) : client.key;
    const proof: Record<string, string> = this.proofMode === 'none'
      ? {}
      : { [CONNECTOR_HEADERS.proof]: createHmac('sha256', proofKey).update(canonicalProof(clientId, nonce), 'utf8').digest('base64url') };

    if (path === CONNECTOR_ROUTES.pair && method === 'DELETE') {
      this.clients.delete(clientId);
      return json(200, { ok: true }, proof);
    }
    if (path === CONNECTOR_ROUTES.status && method === 'GET') return json(200, this.status, proof);
    if (path === CONNECTOR_ROUTES.cancel && method === 'POST') {
      const { jobId } = JSON.parse(body) as { jobId: string };
      this.cancelled.push(jobId);
      return json(200, { ok: true }, proof);
    }
    if (path === CONNECTOR_ROUTES.generate && method === 'POST') {
      JSON.parse(body);
      if (this.generateError) return apiError(this.generateError.status, this.generateError.code, proof, this.generateError.message);
      return this.stream(init.signal, proof);
    }
    return apiError(404, 'NOT_FOUND', proof);
  };

  private completePairing(body: string, origin: string): Response {
    const input = JSON.parse(body) as { pairingId: string; verifier: string; clientPublicKey: string };
    const d = this.demand;
    if (!d || d.pairingId !== input.pairingId) return apiError(404, 'NOT_FOUND');
    if (this.expired) return apiError(410, 'CONNECTOR_PAIRING_EXPIRED');
    if (origin !== d.origin) return apiError(403, 'FORBIDDEN');
    const challenge = createHash('sha256').update(Buffer.from(input.verifier, 'base64url')).digest('base64url');
    if (challenge !== d.challenge) return apiError(401, 'UNAUTHENTICATED');
    d.polls++;
    if (d.state === 'awaiting' && this.answerAfterPolls !== null && d.polls > this.answerAfterPolls) d.state = this.approve ? 'approved' : 'refused';
    if (d.state === 'awaiting') return json(202, { status: 'pending' });
    this.demand = null;
    if (d.state === 'refused') return apiError(403, 'CONNECTOR_PAIRING_REFUSED');
    const ecdh = createECDH('prime256v1');
    const connectorPublicKey = ecdh.generateKeys();
    const secret = ecdh.computeSecret(Buffer.from(input.clientPublicKey, 'base64url'));
    const salt = this.deriveWrongKey ? `${input.pairingId}x` : input.pairingId;
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(salt, 'utf8'), Buffer.from(CONNECTOR_CRYPTO.hkdfInfo, 'utf8'), 32));
    const clientId = b64(randomBytes(16));
    this.clients.set(clientId, { clientId, key, origin });
    return json(200, {
      status: 'approved',
      clientId,
      connectorPublicKey: this.badConnectorKey ? b64(Buffer.alloc(65, 7)) : b64(connectorPublicKey),
      version: this.version,
    });
  }

  private stream(signal: AbortSignal | null | undefined, proof: Record<string, string>): Response {
    const lines = this.events.map(e => `${JSON.stringify(e)}\n`);
    const hold = this.holdStream;
    const cut = this.cutStream;
    const encoder = new TextEncoder();
    const closedByBrowser = () => {
      this.streamsClosedByBrowser++;
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        if (cut) {
          controller.error(new TypeError('network error'));
          return;
        }
        if (!hold) {
          controller.close();
          return;
        }
        const onAbort = () => {
          closedByBrowser();
          controller.error(abortError());
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', [CONNECTOR_HEADERS.job]: randomUUID(), ...proof },
    });
  }
}

/** Horloge simulée : sleep avance le temps (et laisse passer les autres tâches) ; chaque attente est notée. */
export function fakeClock(start = T0) {
  let t = start;
  const sleeps: number[] = [];
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
    /** Appelé après chaque attente (numéro de l'attente, à partir de 1). */
    onSleep: null as ((count: number) => void) | null,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw abortError();
      sleeps.push(ms);
      t += ms;
      clock.onSleep?.(sleeps.length);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal?.aborted) throw abortError();
    },
  };
  return clock;
}
