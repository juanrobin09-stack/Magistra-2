// Connecteur local : VRAI serveur HTTP (127.0.0.1, port éphémère), navigateur simulé avec WebCrypto (même API que le
// site : clé ECDH et clé HMAC non extractibles), vrai GenerationManager avec un fournisseur simulé (MockProvider).
// Couvre chaque contrôle du protocole : hôte (DNS rebinding), origine, CORS exact (jamais « * »), pré-vérification,
// accès au réseau privé, routes et méthodes (aucune route Ollama), formats et tailles, appairage complet, requêtes
// signées (signature, clé, nonce, horodatage, retrait, origine), blocage après échecs, flux NDJSON, arrêt.

import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect as netConnect, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { AIProvider } from '../../shared/ai/provider.js';
import { MagistraError } from '../../shared/errors.js';
import { DEFAULT_PREFERENCES } from '../../shared/ipc.js';
import {
  buildPairingUrl, canonicalPairAck, canonicalProof, canonicalRequest, canonicalRevoked, CONNECTOR_ALLOWED_REQUEST_HEADERS, CONNECTOR_CRYPTO,
  CONNECTOR_FORMATS, CONNECTOR_HEADERS, CONNECTOR_LIMITS, OFFICIAL_WEB_ORIGINS, parseAppUrl, type ConnectorStatus,
} from '../../shared/localConnector.js';
import { SITE_ORIGIN } from '../../shared/site.js';
import type { GenerationEvent, PrivacyInfo } from '../../shared/types.js';
import type { SecretCipher } from '../../electron/aiConfig.js';
import { ConnectorClientStore } from '../../electron/connector/clients.js';
import { fromBase64Url, randomToken, sha256Base64Url, toBase64Url } from '../../electron/connector/crypto.js';
import { PairingRegistry, type PairingTicket } from '../../electron/connector/pairing.js';
import { ConnectorServer, type ConnectorServerOptions } from '../../electron/connector/server.js';
import { buildConnectorStatus } from '../../electron/connector/status.js';
import { BUSY_EXTERNAL_MESSAGE, BUSY_WINDOW_MESSAGE, GenerationManager, type GenerationDeps, type GenerationPayload } from '../../electron/generation.js';
import { originTraps, SITE_APEX_ORIGIN } from './officialOrigins.js';

const ORIGIN = 'https://magistra-2.vercel.app';
/** Seconde origine autorisée (origine de développement) : sert aux contrôles « autre origine ». */
const DEV_ORIGIN = 'http://localhost:5173';
const VERSION = '2.1.0';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const subtle = globalThis.crypto.subtle;
const utf8 = (text: string) => new TextEncoder().encode(text);
/** Octets décodés, copiés dans un ArrayBuffer ordinaire (type BufferSource attendu par WebCrypto). */
const decoded = (text: string, bytes: number) => Uint8Array.from(fromBase64Url(text, bytes)!);

const REQUEST = {
  type: 'cours',
  niveau: 'licence_2',
  matiere: 'mathematiques',
  sujet: 'Espaces vectoriels',
  researchMode: 'documents',
  documents: [{ docId: 'd1', docName: 'poly.pdf', kind: 'pdf', locator: { type: 'pages', start: 3, end: 4 }, text: 'Un espace vectoriel est un ensemble muni de deux lois.' }],
};

function fakeCipher(): SecretCipher {
  return {
    isAvailable: () => true,
    encrypt: plain => Buffer.from([...Buffer.from(plain, 'utf8')].map(b => b ^ 0x5a)).toString('base64'),
    decrypt: enc => Buffer.from([...Buffer.from(enc, 'base64')].map(b => b ^ 0x5a)).toString('utf8'),
  };
}

// ─── Client HTTP brut (en-têtes Host et Origin libres) ─────────────────────

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

interface SendOptions {
  method?: string;
  path?: string;
  /** undefined : en-tête retiré. */
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
  /** Corps envoyé en « Transfer-Encoding: chunked » (sans Content-Length). */
  chunked?: boolean;
}

/** Toutes les réponses reçues : vérifiées après chaque test (jamais « * », jamais d'identifiants). */
const seen: Reply[] = [];

let port = 0;
let clock = 0;

function buildRequest(opts: SendOptions): ClientRequest {
  const headers: Record<string, string> = {};
  const merged: Record<string, string | undefined> = { host: `127.0.0.1:${port}`, origin: ORIGIN, ...opts.headers };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) headers[k] = v;
  if (opts.body !== undefined && !opts.chunked && headers['content-length'] === undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));
  if (opts.chunked) headers['transfer-encoding'] = 'chunked';
  return httpRequest({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/v1/hello', headers, agent: false, setHost: false });
}

function parseOrNull(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function send(opts: SendOptions = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = buildRequest(opts);
    req.on('error', reject);
    req.on('response', res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const reply: Reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: parseOrNull(text) };
        seen.push(reply);
        resolve(reply);
      });
    });
    req.end(opts.body);
  });
}

interface Streamed {
  status: number;
  headers: IncomingHttpHeaders;
  res: IncomingMessage;
  req: ClientRequest;
  events: GenerationEvent[];
  /** Fin du flux (ou coupure). */
  done: Promise<GenerationEvent[]>;
  /** Attend un évènement vérifiant `test`. */
  waitFor(test: (e: GenerationEvent) => boolean): Promise<GenerationEvent>;
}

function stream(opts: SendOptions): Promise<Streamed> {
  return new Promise((resolve, reject) => {
    const req = buildRequest(opts);
    req.on('error', reject);
    req.on('response', res => {
      const events: GenerationEvent[] = [];
      const waiters: { test: (e: GenerationEvent) => boolean; resolve: (e: GenerationEvent) => void }[] = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as GenerationEvent;
          events.push(event);
          for (const w of [...waiters]) {
            if (w.test(event)) {
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve(event);
            }
          }
        }
      });
      const done = new Promise<GenerationEvent[]>(r => {
        res.on('end', () => r(events));
        res.on('close', () => r(events));
        res.on('error', () => r(events));
      });
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        res,
        req,
        events,
        done,
        waitFor: test => {
          const found = events.find(test);
          if (found) return Promise.resolve(found);
          return new Promise(r => waiters.push({ test, resolve: r }));
        },
      });
    });
    req.end(opts.body);
  });
}

// ─── Navigateur simulé (WebCrypto, comme le site) ───────────────────────────

class Browser {
  readonly origin: string;
  readonly userAgent: string;
  clientId = '';
  key: CryptoKey | null = null;
  private pair: CryptoKeyPair | null = null;

  constructor(origin = ORIGIN, userAgent = EDGE_UA) {
    this.origin = origin;
    this.userAgent = userAgent;
  }

  /** Paramètres de l'URL magistra://pair (identifiant, vérificateur, défi = SHA-256 des octets du vérificateur). */
  async begin(): Promise<{ pairingId: string; verifier: string; challenge: string; clientPublicKey: string }> {
    this.pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const raw = new Uint8Array(await subtle.exportKey('raw', this.pair.publicKey));
    const verifier = randomToken(32);
    const challenge = toBase64Url(new Uint8Array(await subtle.digest('SHA-256', decoded(verifier, 32))));
    return { pairingId: randomToken(16), verifier, challenge, clientPublicKey: toBase64Url(raw) };
  }

  /** Premier temps de POST /v1/pair : preuve de réception (identifiant seulement, aucun secret). */
  ackRequest(p: { pairingId: string }, headers: Record<string, string | undefined> = {}): Promise<Reply> {
    return send({
      method: 'POST',
      path: '/v1/pair',
      headers: { origin: this.origin, 'content-type': 'application/json', 'user-agent': this.userAgent, ...headers },
      body: JSON.stringify({ pairingId: p.pairingId }),
    });
  }

  /** Second temps de POST /v1/pair : vérificateur et clé publique. */
  pairRequest(p: { pairingId: string; verifier: string; clientPublicKey: string }, headers: Record<string, string | undefined> = {}): Promise<Reply> {
    return send({
      method: 'POST',
      path: '/v1/pair',
      headers: { origin: this.origin, 'content-type': 'application/json', 'user-agent': this.userAgent, ...headers },
      body: JSON.stringify({ pairingId: p.pairingId, verifier: p.verifier, clientPublicKey: p.clientPublicKey }),
    });
  }

  /** Accusé de réception attendu du port visé, calculé avec le défi de l'URL (WebCrypto, comme le site). */
  async expectedAck(p: { pairingId: string; challenge: string }, host = `127.0.0.1:${port}`): Promise<string> {
    return toBase64Url(new Uint8Array(await subtle.digest('SHA-256', utf8(canonicalPairAck(p.pairingId, p.challenge, host)))));
  }

  async finish(reply: Reply, pairingId: string): Promise<void> {
    const peer = await subtle.importKey('raw', decoded(reply.json.connectorPublicKey, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: peer }, this.pair!.privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    this.key = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: utf8(pairingId), info: utf8(CONNECTOR_CRYPTO.hkdfInfo) },
      hkdf,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
    this.clientId = reply.json.clientId;
  }

  /** En-têtes d'une requête signée ; `over` modifie les valeurs signées ou envoyées (tests d'attaque). */
  async sign(method: string, route: string, body = '', over: { timestamp?: string; nonce?: string; origin?: string; clientId?: string; key?: CryptoKey; host?: string } = {}) {
    const timestamp = over.timestamp ?? String(clock);
    const nonce = over.nonce ?? randomToken(16);
    const clientId = over.clientId ?? this.clientId;
    const message = canonicalRequest({
      method, host: over.host ?? `127.0.0.1:${port}`, path: route, origin: over.origin ?? this.origin, clientId, timestamp, nonce, bodySha256: sha256Base64Url(body),
    });
    const signature = toBase64Url(new Uint8Array(await subtle.sign('HMAC', over.key ?? this.key!, utf8(message))));
    return {
      nonce,
      headers: {
        origin: this.origin,
        [CONNECTOR_HEADERS.client]: clientId,
        [CONNECTOR_HEADERS.timestamp]: timestamp,
        [CONNECTOR_HEADERS.nonce]: nonce,
        [CONNECTOR_HEADERS.signature]: signature,
        ...(body ? { 'content-type': 'application/json' } : {}),
      } as Record<string, string>,
    };
  }

  async call(method: string, route: string, body = '', over: Parameters<Browser['sign']>[3] = {}, extraHeaders: Record<string, string | undefined> = {}) {
    const { nonce, headers } = await this.sign(method, route, body, over);
    const reply = await send({ method, path: route, headers: { ...headers, ...extraHeaders }, ...(body ? { body } : {}) });
    return { reply, nonce };
  }

  /** Preuve X-Magistra-Proof vérifiée comme le fait le site (clé non extractible) pour le port visé. */
  async proofValid(headers: IncomingHttpHeaders, nonce: string, host = `127.0.0.1:${port}`): Promise<boolean> {
    const proof = headers[CONNECTOR_HEADERS.proof.toLowerCase()];
    if (typeof proof !== 'string') return false;
    if (!fromBase64Url(proof, 32)) return false;
    return subtle.verify('HMAC', this.key!, decoded(proof, 32), utf8(canonicalProof(this.clientId, nonce, host)));
  }
}

// ─── Banc d'essai ───────────────────────────────────────────────────────────

let dir: string;
let clients: ConnectorClientStore;
let pairing: PairingRegistry;
let server: ConnectorServer;
/** Options du serveur du banc d'essai (pour en créer un autre : autre magasin, autre port). */
let serverOptions: ConnectorServerOptions;
let gm: GenerationManager;
let provider: AIProvider;
let localEngine = true;
let privacy: PrivacyInfo;
let active: Partial<Awaited<ReturnType<GenerationDeps['describeActive']>>> = {};
let windowPayloads: GenerationPayload[];
const saveGeneration = vi.fn(async () => ({ id: 'jamais' }));

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-connector-srv-'));
  clock = Date.now();
  localEngine = true;
  privacy = { level: 'local', message: 'IA locale' };
  active = {};
  windowPayloads = [];
  saveGeneration.mockClear();
  provider = new MockProvider({ reply: '# Espaces vectoriels\n\nUn espace vectoriel possède deux lois [S1].', model: 'ministral-3:14b' });
  clients = new ConnectorClientStore(path.join(dir, 'local-connector.json'), fakeCipher(), { now: () => new Date(clock), warn: () => undefined });
  await clients.load();
  pairing = new PairingRegistry({ now: () => clock });
  gm = new GenerationManager({
    store: { getPreferences: async () => ({ ...DEFAULT_PREFERENCES }), saveGeneration },
    resolveProvider: async (_signal, onStatus) => {
      onStatus('Démarrage du moteur IA…');
      return provider;
    },
    describeActive: async () => ({ label: 'Magistra Standard', contextTokens: 12_288, ready: true, privacy, ...active }),
    send: payload => {
      windowPayloads.push(payload);
      return true;
    },
    fetch: async () => {
      throw new Error('aucun accès réseau dans ce test');
    },
    isLocalEngine: () => localEngine,
  });
  serverOptions = {
    version: VERSION,
    allowedOrigins: [ORIGIN, DEV_ORIGIN],
    ports: [0],
    clients,
    pairing,
    generations: gm,
    status: async (): Promise<ConnectorStatus> => buildConnectorStatus({ version: VERSION, capabilities: await gm.capabilities(), busy: gm.busy }),
    now: () => clock,
    log: () => undefined,
    timeouts: { bodyMs: 400 },
  };
  server = new ConnectorServer(serverOptions);
  port = (await server.start())!;
});

afterEach(async () => {
  gm.cancelAll();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
  for (const reply of seen.splice(0)) {
    expect(reply.headers['access-control-allow-origin']).not.toBe('*');
    expect(reply.headers['access-control-allow-credentials']).toBeUndefined();
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers.vary)).toContain('Origin');
  }
});

/** Ouvre la demande (URL magistra://pair analysée comme le fait l'application). */
function openPairing(p: { pairingId: string; challenge: string }, origin = ORIGIN): PairingTicket {
  const parsed = parseAppUrl(buildPairingUrl({ pairingId: p.pairingId, challenge: p.challenge, origin }));
  if (!parsed || parsed.kind !== 'pair') throw new Error('URL invalide');
  const opened = pairing.open(parsed);
  if (opened.kind !== 'prompt') throw new Error(opened.kind);
  return opened.ticket;
}

/** Appairage complet d'un navigateur (accord donné) : preuve de réception, puis fin d'appairage. */
async function paired(origin = ORIGIN): Promise<Browser> {
  const browser = new Browser(origin);
  const p = await browser.begin();
  pairing.answer(openPairing(p, origin), true);
  const ack = await browser.ackRequest(p);
  expect(ack.status).toBe(200);
  expect(ack.json).toEqual({ status: 'consented', ack: await browser.expectedAck(p) });
  const reply = await browser.pairRequest(p);
  expect(reply.status).toBe(200);
  await browser.finish(reply, p.pairingId);
  return browser;
}

function expectCors(reply: Reply, origin = ORIGIN) {
  expect(reply.headers['access-control-allow-origin']).toBe(origin);
  expect(reply.headers['access-control-expose-headers']).toBe('X-Magistra-Proof, X-Magistra-Job, X-Magistra-Revoked');
}

function expectNoCors(reply: Reply) {
  for (const name of Object.keys(reply.headers)) expect(name.startsWith('access-control-'), name).toBe(false);
}

function expectError(reply: Reply, status: number, code: string) {
  expect(reply.status).toBe(status);
  expect(reply.json).toEqual({ error: { code, message: expect.any(String), retryable: expect.any(Boolean) } });
  expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
}

async function waitUntil(test: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('condition non atteinte');
    await new Promise(r => setTimeout(r, 5));
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('présence et contrôles d’accès (avant toute authentification)', () => {
  it('GET /v1/hello : présence de Magistra, sans configuration ni adresse, CORS exact', async () => {
    const reply = await send();
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ app: 'magistra', protocol: 2, version: VERSION });
    expectCors(reply);
    expect(reply.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();
    const dev = await send({ headers: { origin: DEV_ORIGIN } });
    expectCors(dev, DEV_ORIGIN);
  });

  it('DNS rebinding : tout autre en-tête Host est refusé (403 sans CORS)', async () => {
    for (const host of ['evil.example', `evil.example:${port}`, `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `127.0.0.2:${port}`, `[::1]:${port}`, `127.0.0.1:${port}.evil.example`]) {
      const reply = await send({ headers: { host } });
      expectError(reply, 403, 'FORBIDDEN');
      expectNoCors(reply);
    }
  });

  it('Origin absente, « null », autre site, boucle locale ou imitation : 403 sans aucun en-tête CORS', async () => {
    const origins = [
      undefined, 'null', 'https://evil.example', `http://127.0.0.1:${port}`, 'http://localhost', 'http://localhost:5174',
      'https://magistra-2.vercel.app.evil.example', 'https://magistra-2.vercel.app/', 'HTTPS://MAGISTRA-2.VERCEL.APP',
      'http://magistra-2.vercel.app', 'https://magistra-2.vercel.app:443', `${ORIGIN}, https://evil.example`, '',
    ];
    for (const origin of origins) {
      for (const [method, route] of [['GET', '/v1/hello'], ['POST', '/v1/pair'], ['GET', '/v1/status'], ['OPTIONS', '/v1/generate']]) {
        const reply = await send({ method, path: route, headers: { origin } });
        expect(reply.status, `${origin} ${method} ${route}`).toBe(403);
        expectNoCors(reply);
      }
    }
  });

  it('en-tête Host ou Origin répété (même valeur) : 403 sans CORS', async () => {
    const withRaw = (headers: string[]) => new Promise<Reply>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/v1/hello', agent: false, setHost: false, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parseOrNull(text) });
        });
      });
      req.on('error', reject);
      req.end();
    });
    const origin = await withRaw(['Host', `127.0.0.1:${port}`, 'Origin', ORIGIN, 'Origin', ORIGIN]);
    expect(origin.status).toBe(403);
    expectNoCors(origin);
    const host = await withRaw(['Host', `127.0.0.1:${port}`, 'Host', `127.0.0.1:${port}`, 'Origin', ORIGIN]);
    expect([400, 403]).toContain(host.status);
    expectNoCors(host);
  });

  it('au-delà de 40 en-têtes (Node ignorerait les suivants en silence) : 431 sans CORS, rien de caché derrière', async () => {
    const raw = (headers: string[], body?: string) => new Promise<Reply>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/v1/hello', agent: false, setHost: false, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: parseOrNull(text) };
          seen.push(reply);
          resolve(reply);
        });
      });
      req.on('error', reject);
      req.end(body);
    });
    const filler = (n: number) => Array.from({ length: n }, (_, i) => [`X-F${i}`, 'x']).flat();
    const base = ['Host', `127.0.0.1:${port}`, 'Origin', ORIGIN];
    // Origin ou Host répété APRÈS 45 autres en-têtes, Transfer-Encoding caché après 40 : jamais acceptés.
    for (const headers of [
      [...base, ...filler(45), 'Origin', 'https://evil.example'],
      [...base, ...filler(45), 'Host', `evil.example:${port}`],
      [...base, ...filler(40), 'Transfer-Encoding', 'chunked'],
    ]) {
      const reply = await raw(headers, headers.includes('Transfer-Encoding') ? '{}' : undefined);
      expectError(reply, 431, 'INVALID_REQUEST');
      expectNoCors(reply);
      expect(reply.headers.connection).toBe('close');
    }
    // Une requête ordinaire (un navigateur envoie une vingtaine d'en-têtes) passe.
    expect((await raw([...base, ...filler(30)])).status).toBe(200);
  });

  it('aucune route Ollama ni autre API : 404 (le navigateur n’obtient jamais d’accès général au moteur)', async () => {
    const paths = [
      '/api/tags', '/api/chat', '/api/generate', '/api/pull', '/api/version', '/api/ps', '/api/show', '/api/delete', '/api/embed',
      '/v1/chat/completions', '/v1/models', '/v1/completions', '/v1/../v1/hello', '/v1/./hello', '/v1/hello/', '/v1/hello?x=1',
      '/v1/hello#x', '/V1/HELLO', '//v1/hello', '/v1/hello%2F', '/v1/%68ello', '/', '/v1', '/v1/pair/../status', '/v1/status/',
      '/../../etc/passwd', `http://127.0.0.1:${port}/v1/hello`, '*',
    ];
    for (const p of paths) {
      for (const method of ['GET', 'POST']) {
        const reply = await send({ method, path: p, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, ...(method === 'POST' ? { body: '{}' } : {}) });
        expectError(reply, 404, 'NOT_FOUND');
        expectCors(reply);
      }
    }
  });

  it('méthode non prévue pour la route : 405 avec Allow', async () => {
    const cases: [string, string, string][] = [
      ['PUT', '/v1/hello', 'GET, OPTIONS'], ['POST', '/v1/hello', 'GET, OPTIONS'], ['GET', '/v1/generate', 'POST, OPTIONS'],
      ['DELETE', '/v1/status', 'GET, OPTIONS'], ['PATCH', '/v1/pair', 'POST, DELETE, OPTIONS'], ['GET', '/v1/pair', 'POST, DELETE, OPTIONS'],
      ['TRACE', '/v1/cancel', 'POST, OPTIONS'],
    ];
    for (const [method, route, allow] of cases) {
      const reply = await send({ method, path: route });
      expectError(reply, 405, 'INVALID_REQUEST');
      expect(reply.headers.allow, `${method} ${route}`).toBe(allow);
      expectCors(reply);
    }
    // HEAD : même refus (réponse sans corps, par définition).
    const head = await send({ method: 'HEAD', path: '/v1/status' });
    expect(head.status).toBe(405);
    expect(head.headers.allow).toBe('GET, OPTIONS');
  });

  it('pré-vérification CORS acceptée : origine exacte, méthodes de la route, en-têtes autorisés, 10 min', async () => {
    const requested = CONNECTOR_ALLOWED_REQUEST_HEADERS.map(h => h.toLowerCase()).join(', ');
    const cases: [string, string, string][] = [
      ['/v1/hello', 'GET', 'GET'], ['/v1/pair', 'POST', 'POST, DELETE'], ['/v1/pair', 'DELETE', 'POST, DELETE'],
      ['/v1/status', 'GET', 'GET'], ['/v1/generate', 'POST', 'POST'], ['/v1/cancel', 'POST', 'POST'],
    ];
    for (const [route, method, allowed] of cases) {
      const reply = await send({ method: 'OPTIONS', path: route, headers: { 'access-control-request-method': method, 'access-control-request-headers': requested } });
      expect(reply.status).toBe(204);
      expect(reply.text).toBe('');
      expect(reply.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(reply.headers['access-control-allow-methods']).toBe(allowed);
      expect(reply.headers['access-control-allow-headers']).toBe(CONNECTOR_ALLOWED_REQUEST_HEADERS.join(', '));
      expect(reply.headers['access-control-max-age']).toBe('600');
      expect(reply.headers['access-control-allow-private-network']).toBeUndefined();
    }
    // En-têtes demandés en casse quelconque, liste vide : acceptés.
    const mixed = await send({ method: 'OPTIONS', path: '/v1/status', headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'X-MAGISTRA-CLIENT,x-magistra-nonce' } });
    expect(mixed.status).toBe(204);
    const none = await send({ method: 'OPTIONS', path: '/v1/hello', headers: { 'access-control-request-method': 'GET' } });
    expect(none.status).toBe(204);
  });

  it('accès au réseau privé (Chrome) : autorisé explicitement, seulement s’il est demandé', async () => {
    const reply = await send({
      method: 'OPTIONS', path: '/v1/hello',
      headers: { 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true' },
    });
    expect(reply.status).toBe(204);
    expect(reply.headers['access-control-allow-private-network']).toBe('true');
    const refused = await send({
      method: 'OPTIONS', path: '/v1/hello',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true' },
    });
    expect(refused.status).toBe(403);
    expectNoCors(refused);
  });

  it('pré-vérification refusée : méthode ou en-tête non autorisé, méthode absente (403)', async () => {
    const cases: Record<string, string | undefined>[] = [
      { 'access-control-request-method': 'PUT' },
      { 'access-control-request-method': 'GET' }, // /v1/generate n'accepte que POST
      { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' },
      { 'access-control-request-method': 'POST', 'access-control-request-headers': 'cookie' },
      { 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-magistra-client, x-autre' },
      {},
    ];
    for (const headers of cases) {
      const reply = await send({ method: 'OPTIONS', path: '/v1/generate', headers });
      expectError(reply, 403, 'FORBIDDEN');
      expect(reply.headers['access-control-allow-methods']).toBeUndefined();
    }
    // En-tête répété : chaque ligne compte.
    const repeated = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port, method: 'OPTIONS', path: '/v1/generate', agent: false, setHost: false,
        headers: [
          'Host', `127.0.0.1:${port}`, 'Origin', ORIGIN, 'Access-Control-Request-Method', 'POST',
          'Access-Control-Request-Headers', 'content-type', 'Access-Control-Request-Headers', 'authorization',
        ],
      }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });
    expect(repeated).toBe(403);
  });

  it('POST : JSON exigé (415), charset UTF-8 toléré', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json; charset=iso-8859-1', 'application/jsonp', 'application/json; x=1']) {
      const reply = await send({ method: 'POST', path: '/v1/pair', headers: { 'content-type': type }, body: '{}' });
      expectError(reply, 415, 'INVALID_REQUEST');
      expectCors(reply);
    }
    // Content-Type accepté : la requête va plus loin (corps invalide → 400).
    for (const type of ['application/json', 'application/json; charset=UTF-8', 'Application/JSON;charset="utf-8"']) {
      const reply = await send({ method: 'POST', path: '/v1/pair', headers: { 'content-type': type }, body: '{}' });
      expectError(reply, 400, 'INVALID_REQUEST');
    }
  });

  it('corps trop volumineux : 413 (taille annoncée sans lecture, ou corps transmis par morceaux)', async () => {
    // Taille annoncée : refus immédiat, sans attendre le corps.
    const declared = await new Promise<Reply>((resolve, reject) => {
      const req = buildRequest({ method: 'POST', path: '/v1/generate', headers: { 'content-type': 'application/json', 'content-length': String(CONNECTOR_LIMITS.generateBodyBytes + 1) } });
      req.on('error', reject);
      req.on('response', res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: JSON.parse(text) };
          seen.push(reply);
          req.destroy();
          resolve(reply);
        });
      });
      req.flushHeaders();
    });
    expectError(declared, 413, 'DOCUMENT_TOO_LARGE');
    expect(declared.headers.connection).toBe('close');
    const small = await send({ method: 'POST', path: '/v1/pair', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(CONNECTOR_LIMITS.smallBodyBytes + 1) });
    expectError(small, 413, 'DOCUMENT_TOO_LARGE');
    const chunked = await send({ method: 'POST', path: '/v1/pair', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(CONNECTOR_LIMITS.smallBodyBytes + 10), chunked: true });
    expectError(chunked, 413, 'DOCUMENT_TOO_LARGE');
  });

  it('corps sur une requête GET : 400 ; corps reçu trop lentement : 408', async () => {
    const withBody = await send({ method: 'GET', path: '/v1/hello', body: 'x' });
    expectError(withBody, 400, 'INVALID_REQUEST');
    const slow = await new Promise<Reply>((resolve, reject) => {
      const req = buildRequest({ method: 'POST', path: '/v1/pair', headers: { 'content-type': 'application/json', 'content-length': '50' } });
      req.on('error', reject);
      req.on('response', res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: JSON.parse(text) };
          seen.push(reply);
          req.destroy();
          resolve(reply);
        });
      });
      req.write('{"pairingId":');
    });
    expectError(slow, 408, 'INVALID_REQUEST');
    expectCors(slow);
  });
});

/** En-têtes bruts (liste « nom, valeur, nom, valeur… ») : permet d'envoyer deux fois Origin, que `send` ne sait pas faire. */
function sendRaw(headers: string[], path = '/v1/hello'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, agent: false, setHost: false, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const reply: Reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: parseOrNull(text) };
        seen.push(reply);
        resolve(reply);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('origines officielles (OFFICIAL_WEB_ORIGINS) : exactes, et rien d’autre', () => {
  beforeEach(async () => {
    // Le serveur reçoit EXACTEMENT la liste compilée dans l'application (aucune origine de développement), comme main.ts.
    await server.stop();
    server = new ConnectorServer({ ...serverOptions, allowedOrigins: [...OFFICIAL_WEB_ORIGINS] });
    port = (await server.start())!;
  });

  it('la liste du serveur est celle de l’application : l’ancienne adresse ET le nouveau domaine', () => {
    expect([...OFFICIAL_WEB_ORIGINS]).toEqual(['https://magistra-2.vercel.app', 'https://www.mag-istra.fr']);
    expect(OFFICIAL_WEB_ORIGINS).toContain(ORIGIN);
    expect(OFFICIAL_WEB_ORIGINS).toContain(SITE_ORIGIN);
  });

  it.each([...OFFICIAL_WEB_ORIGINS])('%s : présence, CORS exact (cette origine, jamais « * »), pré-vérification, hôte exact toujours exigé', async origin => {
    const hello = await send({ headers: { origin } });
    expect(hello.status).toBe(200);
    expect(hello.json).toEqual({ app: 'magistra', protocol: 2, version: VERSION });
    expectCors(hello, origin);
    expect(hello.headers['access-control-allow-credentials']).toBeUndefined();

    const requested = CONNECTOR_ALLOWED_REQUEST_HEADERS.map(h => h.toLowerCase()).join(', ');
    const preflight = await send({ method: 'OPTIONS', path: '/v1/generate', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': requested } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-methods']).toBe('POST');

    // L'origine officielle ne dispense pas du contrôle de l'hôte (anti DNS rebinding).
    const rebinding = await send({ headers: { origin, host: 'evil.example' } });
    expectError(rebinding, 403, 'FORBIDDEN');
    expectNoCors(rebinding);
  });

  it.each([...OFFICIAL_WEB_ORIGINS])('%s : appairage complet, puis requête signée, navigateur listé sous son nom d’hôte', async origin => {
    const browser = await paired(origin);
    const host = new URL(origin).host;
    expect(clients.list()).toEqual([expect.objectContaining({ clientId: browser.clientId, site: host, browser: 'Microsoft Edge' })]);
    const { reply, nonce } = await browser.call('GET', '/v1/status');
    expect(reply.status).toBe(200);
    expectCors(reply, origin);
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
  });

  it.each([...OFFICIAL_WEB_ORIGINS])('variantes piégées de %s : 403 sans aucun en-tête CORS, sur chaque route', async official => {
    const traps = originTraps(official);
    expect(traps.length).toBeGreaterThan(60);
    for (const origin of traps) {
      for (const [method, route] of [['GET', '/v1/hello'], ['POST', '/v1/pair'], ['GET', '/v1/status'], ['OPTIONS', '/v1/generate']]) {
        const reply = await send({ method, path: route, headers: { origin, 'access-control-request-method': 'POST' } });
        expect(reply.status, `${origin} ${method} ${route}`).toBe(403);
        expectNoCors(reply);
      }
    }
  });

  it('Origin absent : 403 sans CORS ; deux en-têtes Origin (même valeur, ou les deux origines officielles) : 403 sans CORS', async () => {
    const absent = await send({ headers: { origin: undefined } });
    expectError(absent, 403, 'FORBIDDEN');
    expectNoCors(absent);
    const host = `127.0.0.1:${port}`;
    for (const origins of [[SITE_ORIGIN, SITE_ORIGIN], [SITE_ORIGIN, ORIGIN], [ORIGIN, SITE_ORIGIN], [SITE_ORIGIN, 'https://evil.example'], ['https://evil.example', SITE_ORIGIN]]) {
      const reply = await sendRaw(['Host', host, 'Origin', origins[0], 'Origin', origins[1]]);
      expect(reply.status, origins.join(' + ')).toBe(403);
      expectNoCors(reply);
    }
    // Un seul Origin, exact : accepté (le contrôle précédent n'est pas un refus systématique).
    const single = await sendRaw(['Host', host, 'Origin', SITE_ORIGIN]);
    expect(single.status).toBe(200);
    expectCors(single, SITE_ORIGIN);
  });

  it('l’apex (https://mag-istra.fr) n’est pas servi par le projet : refusé, comme tout sous-domaine', async () => {
    for (const origin of [SITE_APEX_ORIGIN, 'https://app.mag-istra.fr', 'https://sub.www.mag-istra.fr']) {
      const reply = await send({ headers: { origin } });
      expectError(reply, 403, 'FORBIDDEN');
      expectNoCors(reply);
    }
  });

  it('un appairage ne vaut que pour son origine : celui de l’ancienne adresse est refusé depuis le nouveau domaine (et inversement)', async () => {
    const legacy = await paired(ORIGIN);
    const modern = await paired(SITE_ORIGIN);
    expect(clients.list().map(c => c.site).sort()).toEqual(['magistra-2.vercel.app', 'www.mag-istra.fr']);
    // Requêtes correctement signées pour leur propre origine : acceptées.
    expect((await legacy.call('GET', '/v1/status')).reply.status).toBe(200);
    expect((await modern.call('GET', '/v1/status')).reply.status).toBe(200);
    // Clé de l'un présentée avec l'origine de l'autre (en-tête et signature alignés) : navigateur inconnu pour cette origine.
    const crossed = await legacy.call('GET', '/v1/status', '', { origin: SITE_ORIGIN }, { origin: SITE_ORIGIN });
    expectError(crossed.reply, 401, 'CONNECTOR_UNPAIRED');
    const reverse = await modern.call('GET', '/v1/status', '', { origin: ORIGIN }, { origin: ORIGIN });
    expectError(reverse.reply, 401, 'CONNECTOR_UNPAIRED');
    // Origine annoncée dans la signature différente de l'en-tête : signature invalide.
    const mismatch = await modern.call('GET', '/v1/status', '', { origin: ORIGIN });
    expect(mismatch.reply.status).toBe(401);
  });

  it('appairage commencé depuis une origine, terminé depuis l’autre origine officielle : 403 FORBIDDEN (rien d’enregistré)', async () => {
    const browser = new Browser(SITE_ORIGIN);
    const p = await browser.begin();
    pairing.answer(openPairing(p, SITE_ORIGIN), true);
    const stolen = await send({
      method: 'POST',
      path: '/v1/pair',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'user-agent': EDGE_UA },
      body: JSON.stringify({ pairingId: p.pairingId, verifier: p.verifier, clientPublicKey: p.clientPublicKey }),
    });
    expectError(stolen, 403, 'FORBIDDEN');
    expect(clients.list()).toEqual([]);
    // Depuis la bonne origine, la même demande aboutit encore (aucun essai consommé par l'autre origine).
    expect((await browser.pairRequest(p)).status).toBe(200);
  });
});

describe('appairage', () => {
  it('complet : preuve de réception en attente (202) → accord → « consented » → fin d’appairage (200, clé du connecteur) ; requêtes signées ensuite', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    const ticket = openPairing(p);
    const ack = await browser.expectedAck(p);
    expect(ack).toMatch(CONNECTOR_FORMATS.ack);
    // Accusé lié au port d'écoute : relayé par un programme sur un autre port, il ne vaut pas pour celui-ci.
    expect(ack).not.toBe(await browser.expectedAck(p, `127.0.0.1:${port + 1}`));
    const pending = await browser.ackRequest(p);
    expect(pending.status).toBe(202);
    expect(pending.json).toEqual({ status: 'pending', ack });
    expectCors(pending);
    // L'accusé ne révèle ni le défi ni le vérificateur.
    expect(pending.text).not.toContain(p.challenge);

    pairing.answer(ticket, true);
    const consented = await browser.ackRequest(p);
    expect(consented.status).toBe(200);
    expect(consented.json).toEqual({ status: 'consented', ack });
    // Premier temps sans effet sur la demande : autant d'essais que voulu, rien d'enregistré.
    expect((await browser.ackRequest(p)).json).toEqual({ status: 'consented', ack });
    expect(clients.list()).toEqual([]);

    const approved = await browser.pairRequest(p);
    expect(approved.status).toBe(200);
    expect(approved.json).toEqual({ status: 'approved', clientId: expect.any(String), connectorPublicKey: expect.any(String), version: VERSION, ack });
    expect(CONNECTOR_FORMATS.clientId.test(approved.json.clientId)).toBe(true);
    expect(CONNECTOR_FORMATS.publicKey.test(approved.json.connectorPublicKey)).toBe(true);
    // La réponse ne contient ni clé HMAC, ni vérificateur, ni défi.
    expect(approved.text).not.toContain(p.verifier);
    expect(approved.text).not.toContain(p.challenge);
    await browser.finish(approved, p.pairingId);

    // Navigateur enregistré (libellé déduit du User-Agent), clé identique des deux côtés.
    expect(clients.list()).toEqual([expect.objectContaining({ clientId: browser.clientId, site: 'magistra-2.vercel.app', browser: 'Microsoft Edge' })]);
    const { reply, nonce } = await browser.call('GET', '/v1/status');
    expect(reply.status).toBe(200);
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
    expectCors(reply);
  });

  it('second temps avant l’accord (bon vérificateur) : 202 en attente, avec l’accusé', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    const ticket = openPairing(p);
    const early = await browser.pairRequest(p);
    expect(early.status).toBe(202);
    expect(early.json).toEqual({ status: 'pending', ack: await browser.expectedAck(p) });
    pairing.answer(ticket, true);
    expect((await browser.pairRequest(p)).status).toBe(200);
  });

  it('refus dans l’application : 403 CONNECTOR_PAIRING_REFUSED au premier comme au second temps', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    pairing.answer(openPairing(p), false);
    expectError(await browser.ackRequest(p), 403, 'CONNECTOR_PAIRING_REFUSED');
    expectError(await browser.ackRequest(p), 403, 'CONNECTOR_PAIRING_REFUSED');
    expectError(await browser.pairRequest(p), 403, 'CONNECTOR_PAIRING_REFUSED');
    expectError(await browser.ackRequest(p), 404, 'NOT_FOUND');
    expect(clients.list()).toEqual([]);
  });

  it('demande expirée : 410 CONNECTOR_PAIRING_EXPIRED (premier et second temps)', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    pairing.answer(openPairing(p), true);
    clock += CONNECTOR_LIMITS.pairingTtlMs;
    expectError(await browser.ackRequest(p), 410, 'CONNECTOR_PAIRING_EXPIRED');
    const q = await browser.begin();
    pairing.answer(openPairing(q), true);
    clock += CONNECTOR_LIMITS.pairingTtlMs;
    expectError(await browser.pairRequest(q), 410, 'CONNECTOR_PAIRING_EXPIRED');
    expect(clients.list()).toEqual([]);
  });

  it('premier temps : demande inconnue (404), autre origine (403 FORBIDDEN), jamais d’accusé pour une autre demande', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    openPairing(p);
    const other = await browser.begin();
    expectError(await browser.ackRequest(other), 404, 'NOT_FOUND');
    const forbidden = await browser.ackRequest(p, { origin: DEV_ORIGIN });
    expectError(forbidden, 403, 'FORBIDDEN');
    expect(forbidden.text).not.toContain(await browser.expectedAck(p));
    expect((await browser.ackRequest(p)).status).toBe(202);
  });

  it('vérificateur faux : 401 (×5), puis la demande n’existe plus (404)', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    pairing.answer(openPairing(p), true);
    for (let i = 0; i < CONNECTOR_LIMITS.maxVerifierAttempts; i++) {
      const reply = await browser.pairRequest({ ...p, verifier: randomToken(32) });
      expectError(reply, 401, 'UNAUTHENTICATED');
    }
    expectError(await browser.pairRequest(p), 404, 'NOT_FOUND');
    expect(clients.list()).toEqual([]);
  });

  it('origine différente de celle de la demande : 403 FORBIDDEN', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    pairing.answer(openPairing(p), true);
    expectError(await browser.pairRequest(p, { origin: DEV_ORIGIN }), 403, 'FORBIDDEN');
    // La demande reste utilisable par la bonne origine.
    expect((await browser.pairRequest(p)).status).toBe(200);
  });

  it('usage unique : une demande acceptée ne sert qu’une fois ; demande inconnue : 404', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    pairing.answer(openPairing(p), true);
    expect((await browser.pairRequest(p)).status).toBe(200);
    expectError(await browser.pairRequest(p), 404, 'NOT_FOUND');
    expect(clients.list()).toHaveLength(1);
    const other = await new Browser().begin();
    expectError(await browser.pairRequest(other), 404, 'NOT_FOUND');
  });

  it('corps invalide (clé en trop ou manquante, format, clé publique hors de la courbe) : 400 sans perdre la demande', async () => {
    const browser = new Browser();
    const p = await browser.begin();
    const ticket = openPairing(p);
    const bodies = [
      JSON.stringify({ pairingId: p.pairingId, verifier: p.verifier }),
      JSON.stringify({ pairingId: 'court' }),
      JSON.stringify({ pairingId: 42 }),
      JSON.stringify({ verifier: p.verifier }),
      JSON.stringify({}),
      JSON.stringify({ pairingId: p.pairingId, verifier: p.verifier, clientPublicKey: p.clientPublicKey, extra: 1 }),
      JSON.stringify({ pairingId: 'court', verifier: p.verifier, clientPublicKey: p.clientPublicKey }),
      JSON.stringify({ pairingId: p.pairingId, verifier: 42, clientPublicKey: p.clientPublicKey }),
      JSON.stringify([p.pairingId, p.verifier, p.clientPublicKey]),
      'null',
      '{ pas du json',
    ];
    const offCurve = fromBase64Url(p.clientPublicKey, 65)!;
    offCurve[64] ^= 1;
    bodies.push(JSON.stringify({ pairingId: p.pairingId, verifier: p.verifier, clientPublicKey: toBase64Url(offCurve) }));
    for (const body of bodies) {
      const reply = await send({ method: 'POST', path: '/v1/pair', headers: { 'content-type': 'application/json' }, body });
      expectError(reply, 400, 'INVALID_REQUEST');
      // Jamais le contenu de la requête dans la réponse.
      expect(reply.text).not.toContain('pas du json');
    }
    pairing.answer(ticket, true);
    expect((await browser.pairRequest(p)).status).toBe(200);
  });
});

describe('requêtes signées', () => {
  it('signature fausse, clé d’un autre appairage, corps modifié : 401 UNAUTHENTICATED sans preuve', async () => {
    const browser = await paired();
    const other = await paired();
    const forged = await browser.sign('GET', '/v1/status');
    const bad = await send({ path: '/v1/status', headers: { ...forged.headers, [CONNECTOR_HEADERS.signature]: randomToken(32) } });
    expectError(bad, 401, 'UNAUTHENTICATED');
    expect(bad.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();

    const wrongKey = await browser.call('GET', '/v1/status', '', { key: other.key! });
    expectError(wrongKey.reply, 401, 'UNAUTHENTICATED');

    // Signature d'un corps, envoi d'un autre (même taille).
    const body = JSON.stringify({ jobId: '00000000-0000-4000-8000-000000000000' });
    const signed = await browser.sign('POST', '/v1/cancel', body);
    const tampered = await send({ method: 'POST', path: '/v1/cancel', headers: signed.headers, body: body.replace('4000', '4001') });
    expectError(tampered, 401, 'UNAUTHENTICATED');
    // Signature d'une route ou d'une méthode, envoi à une autre.
    const forStatus = await browser.sign('GET', '/v1/status');
    expectError(await send({ method: 'DELETE', path: '/v1/pair', headers: forStatus.headers }), 401, 'UNAUTHENTICATED');
    expect(clients.find(browser.clientId)).toBeDefined();
  });

  it('requête relayée depuis un autre port (signée pour cet autre hôte, Host réécrit) : 401 sans preuve ; preuve valable pour CE port seulement', async () => {
    const browser = await paired();
    const relayed = await browser.call('GET', '/v1/status', '', { host: `127.0.0.1:${port + 1}` });
    expectError(relayed.reply, 401, 'UNAUTHENTICATED');
    expect(relayed.reply.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();
    const { reply, nonce } = await browser.call('GET', '/v1/status');
    expect(reply.status).toBe(200);
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
    expect(await browser.proofValid(reply.headers, nonce, `127.0.0.1:${port + 1}`)).toBe(false);
  });

  it('autorisation retirée PENDANT la lecture du corps : 401 CONNECTOR_UNPAIRED, jamais de génération (même signée avec la clé effacée)', async () => {
    const zeroKey = await subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const slowPost = (headers: Record<string, string>, body: Buffer, whileReading: () => Promise<unknown>) => new Promise<Reply>((resolve, reject) => {
      const req = buildRequest({ method: 'POST', path: '/v1/generate', headers: { ...headers, 'content-length': String(body.length) } });
      req.on('error', reject);
      req.on('response', res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const reply = { status: res.statusCode ?? 0, headers: res.headers, text, json: parseOrNull(text) };
          seen.push(reply);
          resolve(reply);
        });
      });
      req.write(body.subarray(0, 10));
      // En-têtes contrôlés (navigateur encore autorisé), corps en cours de lecture : l'autorisation est retirée.
      setTimeout(() => void whileReading().then(() => req.end(body.subarray(10)), reject), 60);
    });
    const body = Buffer.from(JSON.stringify(REQUEST), 'utf8');
    for (const signWith of ['clé effacée', 'vraie clé'] as const) {
      const browser = await paired();
      // La clé gardée par le serveur est remise à zéro sur place au retrait : 32 octets nuls, connus de tous.
      const { headers } = await browser.sign('POST', '/v1/generate', body.toString('utf8'), signWith === 'clé effacée' ? { key: zeroKey } : {});
      const reply = await slowPost(headers, body, () => clients.revoke(browser.clientId));
      expectError(reply, 401, 'CONNECTOR_UNPAIRED');
      expect(reply.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();
    }
    expect(gm.busy).toBe(false);
    expect((provider as MockProvider).calls).toHaveLength(0);
  });

  it('en-têtes absents ou mal formés : 401 UNAUTHENTICATED', async () => {
    const browser = await paired();
    const { headers } = await browser.sign('GET', '/v1/status');
    const variants: Record<string, string | undefined>[] = [
      { [CONNECTOR_HEADERS.signature]: undefined },
      { [CONNECTOR_HEADERS.nonce]: undefined },
      { [CONNECTOR_HEADERS.timestamp]: undefined },
      { [CONNECTOR_HEADERS.client]: undefined },
      { [CONNECTOR_HEADERS.timestamp]: String(clock / 1000) },
      { [CONNECTOR_HEADERS.nonce]: 'court' },
      { [CONNECTOR_HEADERS.signature]: `${headers[CONNECTOR_HEADERS.signature]}=` },
    ];
    for (const change of variants) expectError(await send({ path: '/v1/status', headers: { ...headers, ...change } }), 401, 'UNAUTHENTICATED');
  });

  it('rejeu : un nonce ne sert qu’une fois', async () => {
    const browser = await paired();
    const { nonce, headers } = await browser.sign('GET', '/v1/status');
    const first = await send({ path: '/v1/status', headers });
    expect(first.status).toBe(200);
    expect(await browser.proofValid(first.headers, nonce)).toBe(true);
    expectError(await send({ path: '/v1/status', headers }), 401, 'UNAUTHENTICATED');
  });

  it('horodatage hors de la tolérance (passé ou futur) : 401', async () => {
    const browser = await paired();
    // Écoute commencée depuis plus longtemps que la tolérance (sinon la limite passée serait avant l'écoute).
    clock += CONNECTOR_LIMITS.clockSkewMs;
    const stale = await browser.call('GET', '/v1/status', '', { timestamp: String(clock - CONNECTOR_LIMITS.clockSkewMs - 1) });
    expectError(stale.reply, 401, 'UNAUTHENTICATED');
    const future = await browser.call('GET', '/v1/status', '', { timestamp: String(clock + CONNECTOR_LIMITS.clockSkewMs + 1) });
    expectError(future.reply, 401, 'UNAUTHENTICATED');
    const edge = await browser.call('GET', '/v1/status', '', { timestamp: String(clock - CONNECTOR_LIMITS.clockSkewMs + 1) });
    expect(edge.reply.status).toBe(200);
  });

  it('navigateur inconnu ou retiré : 401 CONNECTOR_UNPAIRED ; DELETE /v1/pair retire sa propre autorisation (preuve valide)', async () => {
    const browser = await paired();
    const unknown = await browser.call('GET', '/v1/status', '', { clientId: randomToken(16) });
    expectError(unknown.reply, 401, 'CONNECTOR_UNPAIRED');

    const { reply, nonce } = await browser.call('DELETE', '/v1/pair');
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true });
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
    expect(clients.find(browser.clientId)).toBeUndefined();
    const after = await browser.call('GET', '/v1/status');
    expectError(after.reply, 401, 'CONNECTOR_UNPAIRED');
    expect(after.reply.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();

    // Retrait depuis les réglages de l'application : même effet immédiat.
    const second = await paired();
    await clients.revoke(second.clientId);
    expectError((await second.call('GET', '/v1/status')).reply, 401, 'CONNECTOR_UNPAIRED');
  });

  it('401 CONNECTOR_UNPAIRED : marque de retrait jointe SEULEMENT pour un navigateur que cette application a retiré (preuve du retrait pour le site)', async () => {
    const browser = await paired();
    const revoked = (reply: Reply) => reply.headers[CONNECTOR_HEADERS.revoked.toLowerCase()];
    const markValid = async (reply: Reply) => {
      const mark = revoked(reply);
      return typeof mark === 'string' && Boolean(fromBase64Url(mark, 32))
        && subtle.verify('HMAC', browser.key!, decoded(mark, 32), utf8(canonicalRevoked(browser.clientId)));
    };
    // Navigateur inconnu de cette application (ce que répond celle d'une autre session Windows) : aucune marque.
    const unknown = await browser.call('GET', '/v1/status', '', { clientId: randomToken(16) });
    expectError(unknown.reply, 401, 'CONNECTOR_UNPAIRED');
    expect(revoked(unknown.reply)).toBeUndefined();
    // Retiré dans les réglages : la marque, calculée avec SA clé avant l'effacement, accompagne chaque refus.
    await clients.revoke(browser.clientId);
    const after = await browser.call('GET', '/v1/status');
    expectError(after.reply, 401, 'CONNECTOR_UNPAIRED');
    expect(after.reply.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();
    expect(await markValid(after.reply)).toBe(true);
    const generate = await browser.call('POST', '/v1/generate', JSON.stringify(REQUEST));
    expectError(generate.reply, 401, 'CONNECTOR_UNPAIRED');
    expect(await markValid(generate.reply)).toBe(true);
    // Même navigateur, autre origine autorisée : aucune marque (le retrait valait pour le site qui l'avait appairé).
    const { headers } = await browser.sign('GET', '/v1/status', '', { origin: DEV_ORIGIN });
    const other = await send({ path: '/v1/status', headers: { ...headers, origin: DEV_ORIGIN } });
    expectError(other, 401, 'CONNECTOR_UNPAIRED');
    expect(revoked(other)).toBeUndefined();
    // Retrait par le navigateur lui-même (DELETE /v1/pair) : marque aussi.
    const second = await paired();
    expect((await second.call('DELETE', '/v1/pair')).reply.status).toBe(200);
    const gone = (await second.call('GET', '/v1/status')).reply;
    expectError(gone, 401, 'CONNECTOR_UNPAIRED');
    expect(typeof revoked(gone)).toBe('string');
    expect(revoked(gone)).not.toBe(revoked(after.reply));
  });

  it('navigateur appairé pour une origine, requête depuis une autre origine autorisée : refus (CONNECTOR_UNPAIRED)', async () => {
    const browser = await paired(ORIGIN);
    const { headers } = await browser.sign('GET', '/v1/status', '', { origin: DEV_ORIGIN });
    const reply = await send({ path: '/v1/status', headers: { ...headers, origin: DEV_ORIGIN } });
    expectError(reply, 401, 'CONNECTOR_UNPAIRED');
    expectCors(reply, DEV_ORIGIN);
  });

  const MANY = CONNECTOR_LIMITS.maxAuthFailuresPerMinute + 5;

  it('échecs SANS secret (en-têtes absents, navigateur inconnu, mauvaise origine) : jamais comptés, aucun blocage', async () => {
    const browser = await paired();
    const other = await paired();
    for (let i = 0; i < MANY; i++) {
      expectError(await send({ path: '/v1/status', headers: { origin: ORIGIN } }), 401, 'UNAUTHENTICATED');
      const unknown = await browser.sign('GET', '/v1/status', '', { clientId: randomToken(16) });
      expectError(await send({ path: '/v1/status', headers: unknown.headers }), 401, 'CONNECTOR_UNPAIRED');
      const wrongOrigin = await browser.sign('GET', '/v1/status', '', { origin: DEV_ORIGIN });
      expectError(await send({ path: '/v1/status', headers: { ...wrongOrigin.headers, origin: DEV_ORIGIN } }), 401, 'CONNECTOR_UNPAIRED');
    }
    expect((await browser.call('GET', '/v1/status')).reply.status).toBe(200);
    expect((await other.call('GET', '/v1/status')).reply.status).toBe(200);
    expect((await browser.call('POST', '/v1/generate', JSON.stringify(REQUEST))).reply.status).not.toBe(429);
    expect((await paired()).clientId).toBeTruthy();
  });

  it(`plus de ${CONNECTOR_LIMITS.maxAuthFailuresPerMinute} signatures fausses d'un navigateur appairé : 429 pour lui seul, pendant une minute`, async () => {
    const browser = await paired();
    const other = await paired();
    for (let i = 0; i <= CONNECTOR_LIMITS.maxAuthFailuresPerMinute; i++) {
      expectError((await browser.call('GET', '/v1/status', '', { timestamp: '1000000000000' })).reply, 401, 'UNAUTHENTICATED');
    }
    const blocked = await browser.call('GET', '/v1/status');
    expectError(blocked.reply, 429, 'RATE_LIMITED');
    expect(Number(blocked.reply.headers['retry-after'])).toBeGreaterThan(0);
    expectError((await browser.call('POST', '/v1/generate', JSON.stringify(REQUEST))).reply, 429, 'RATE_LIMITED');
    // Les autres navigateurs, l'appairage et hello ne sont pas touchés.
    expect((await other.call('GET', '/v1/status')).reply.status).toBe(200);
    expect((await paired()).clientId).toBeTruthy();
    expect((await send()).status).toBe(200);
    clock += 60_001;
    expect((await browser.call('GET', '/v1/status')).reply.status).toBe(200);
  });

  it('signature HMAC fausse : comptée pour le navigateur connu', async () => {
    const browser = await paired();
    const wrong = await subtle.importKey('raw', new Uint8Array(32).fill(7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    for (let i = 0; i <= CONNECTOR_LIMITS.maxAuthFailuresPerMinute; i++) {
      expectError((await browser.call('GET', '/v1/status', '', { key: wrong })).reply, 401, 'UNAUTHENTICATED');
    }
    expectError((await browser.call('GET', '/v1/status')).reply, 429, 'RATE_LIMITED');
  });

  it('GET /v1/status : état du moteur sans adresse, port, chemin ni réglage', async () => {
    const browser = await paired();
    active = {
      ready: false,
      notReady: { code: 'AI_SERVER_UNAVAILABLE', message: 'Serveur Ollama injoignable (http://127.0.0.1:11434) — C:\\Users\\prof\\.ollama' },
    };
    const { reply } = await browser.call('GET', '/v1/status');
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      version: VERSION,
      engine: { ready: false, local: true, label: 'Magistra Standard', notReady: { code: 'AI_SERVER_UNAVAILABLE', message: "Serveur d'IA indisponible. Réessayez dans quelques instants." } },
      capabilities: { maxDocumentChars: expect.any(Number), research: { academic: true, web: false, institutional: false, wikipedia: true, trustedCatalogue: true, academicAllLevels: true } },
      busy: false,
    });
    for (const leak of ['127.0.0.1', 'localhost', 'http', '11434', String(port), 'Users', '.ollama', 'ministral']) expect(reply.text).not.toContain(leak);

    // Application réglée sur un serveur distant : jamais prête pour le site, nom du serveur non transmis.
    privacy = { level: 'remote', message: 'Serveur distant' };
    active = { label: 'ollama.univ.fr:11434', ready: true };
    const remote = (await browser.call('GET', '/v1/status')).reply;
    expect(remote.json.engine).toEqual({ ready: false, local: false, label: 'Serveur d’IA distant', notReady: { code: 'LOCAL_ENGINE_REMOTE', message: expect.any(String) } });
    expect(remote.text).not.toContain('univ.fr');
  });
});

describe('génération (flux NDJSON)', () => {
  it('flux d’évènements, identifiant de génération, preuve ; « done » porte la génération à enregistrer, rien n’est enregistré ici', async () => {
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { nonce, headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(s.headers['cache-control']).toBe('no-store');
    expect(s.headers['access-control-allow-origin']).toBe(ORIGIN);
    const jobId = s.headers['x-magistra-job'] as string;
    expect(CONNECTOR_FORMATS.jobId.test(jobId)).toBe(true);
    expect(await browser.proofValid(s.headers, nonce)).toBe(true);
    const events = await s.done;
    const types = events.map(e => e.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('sources');
    expect(types).toContain('delta');
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', saved: false, truncated: false, model: 'ministral-3:14b' });
    expect(done.id).toBeUndefined();
    expect(done.record).toMatchObject({ type: 'cours', niveau: 'licence_2', matiere: 'mathematiques', sujet: 'Espaces vectoriels', model: 'ministral-3:14b' });
    expect(done.record?.contenu).toBe(done.content);
    expect(saveGeneration).not.toHaveBeenCalled();
    // Rien n'est envoyé à la fenêtre de l'application.
    expect(windowPayloads).toEqual([]);
    expect(gm.busy).toBe(false);
  });

  it('séquence « plan d’abord » : le champ traverse le connecteur (protocole inchangé) jusqu’au moteur et à la génération à enregistrer', async () => {
    const browser = await paired();
    const sequence = { type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', researchMode: 'documents', nombreSeances: 2 };
    const run = async (body: Record<string, unknown>) => {
      const text = JSON.stringify(body);
      const { headers } = await browser.sign('POST', '/v1/generate', text);
      const s = await stream({ method: 'POST', path: '/v1/generate', headers, body: text });
      expect(s.status).toBe(200);
      return (await s.done).at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    };
    const mock = provider as MockProvider;
    const prompt = (n: number) => mock.calls[n].messages.map(m => m.content).join('\n');

    const plan = await run({ ...sequence, planSeulement: true });
    expect(prompt(0)).toContain('concevoir le PLAN d\'une séquence pédagogique de EXACTEMENT 2 séances');
    expect(plan.record).toMatchObject({ type: 'sequence', params: { nombreSeances: 2, planSeulement: true } });

    // Ancien site (sans le champ) ou valeur non booléenne : séquence complète, rien ne change.
    const full = await run(sequence);
    expect(prompt(1)).not.toContain('PLAN d\'');
    expect(full.record?.params).not.toHaveProperty('planSeulement');
    await run({ ...sequence, planSeulement: 'true' });
    expect(prompt(2)).not.toContain('PLAN d\'');
  });

  it('une seule génération à la fois (fenêtre ou site) : 409 GENERATION_BUSY avec preuve', async () => {
    provider = new MockProvider({ reply: 'x'.repeat(4_000), chunkSize: 10, delayMs: 5 });
    const browser = await paired();
    const window = gm.start(REQUEST);
    const body = JSON.stringify(REQUEST);
    const { reply, nonce } = await browser.call('POST', '/v1/generate', body);
    expectError(reply, 409, 'GENERATION_BUSY');
    expect(reply.json.error.message).toBe(BUSY_WINDOW_MESSAGE);
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
    gm.cancel(window.jobId);
    await waitUntil(() => !gm.busy);

    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    const second = await browser.call('POST', '/v1/generate', body);
    expectError(second.reply, 409, 'GENERATION_BUSY');
    // La fenêtre est refusée elle aussi, avec la cause.
    expect(() => gm.start(REQUEST)).toThrow(expect.objectContaining({ code: 'GENERATION_BUSY', message: BUSY_EXTERNAL_MESSAGE }));
    const statusWhileBusy = (await browser.call('GET', '/v1/status')).reply;
    expect(statusWhileBusy.json.busy).toBe(true);
    s.req.destroy();
    await waitUntil(() => !gm.busy);
  });

  it('application réglée sur un serveur distant : 409 LOCAL_ENGINE_REMOTE, aucune demande au moteur', async () => {
    const mock = new MockProvider({ reply: 'ne doit pas être produit', local: false });
    provider = mock;
    localEngine = false;
    const browser = await paired();
    const { reply, nonce } = await browser.call('POST', '/v1/generate', JSON.stringify(REQUEST));
    expectError(reply, 409, 'LOCAL_ENGINE_REMOTE');
    expect(await browser.proofValid(reply.headers, nonce)).toBe(true);
    expect(mock.calls).toHaveLength(0);
    expect(gm.busy).toBe(false);
  });

  it('demande invalide : 400 avant tout flux', async () => {
    const browser = await paired();
    expectError((await browser.call('POST', '/v1/generate', JSON.stringify({ ...REQUEST, type: 'inconnu' }))).reply, 400, 'INVALID_REQUEST');
    expectError((await browser.call('POST', '/v1/generate', '[1,2]')).reply, 400, 'INVALID_REQUEST');
    expect(gm.busy).toBe(false);
  });

  it('arrêt par POST /v1/cancel : uniquement par le navigateur qui a lancé la génération', async () => {
    provider = new MockProvider({ reply: 'y'.repeat(6_000), chunkSize: 10, delayMs: 5 });
    const owner = await paired();
    const intruder = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await owner.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    const jobId = s.headers['x-magistra-job'] as string;

    const foreign = await intruder.call('POST', '/v1/cancel', JSON.stringify({ jobId }));
    expect(foreign.reply.status).toBe(200);
    expect(foreign.reply.json).toEqual({ ok: true });
    await new Promise(r => setTimeout(r, 50));
    expect(gm.busy).toBe(true);

    expectError((await owner.call('POST', '/v1/cancel', JSON.stringify({ jobId: 'pas-un-uuid' }))).reply, 400, 'INVALID_REQUEST');
    expectError((await owner.call('POST', '/v1/cancel', JSON.stringify({ jobId, autre: 1 }))).reply, 400, 'INVALID_REQUEST');
    const mine = await owner.call('POST', '/v1/cancel', JSON.stringify({ jobId }));
    expect(mine.reply.status).toBe(200);
    expect(await owner.proofValid(mine.reply.headers, mine.nonce)).toBe(true);
    const events = await s.done;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    expect(gm.busy).toBe(false);
  });

  it('connexion fermée par le navigateur : génération interrompue aussitôt', async () => {
    const slow = new MockProvider({ reply: 'z'.repeat(20_000), chunkSize: 10, delayMs: 5 });
    provider = slow;
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    s.req.destroy();
    await waitUntil(() => !gm.busy, 1_500);
    expect(saveGeneration).not.toHaveBeenCalled();
  });

  it('autorisation retirée pendant une génération : elle s’arrête', async () => {
    provider = new MockProvider({ reply: 'w'.repeat(20_000), chunkSize: 10, delayMs: 5 });
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    expect((await browser.call('DELETE', '/v1/pair')).reply.status).toBe(200);
    const events = await s.done;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });

  it('DELETE /v1/pair dont l’enregistrement échoue : la génération du navigateur s’arrête quand même (retrait en mémoire, arrêt, PUIS écriture)', async () => {
    provider = new MockProvider({ reply: 'v'.repeat(20_000), chunkSize: 10, delayMs: 5 });
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    // local-connector.json impossible à remplacer (dossier non vide à sa place : verrou qui dure).
    const file = path.join(dir, 'local-connector.json');
    rmSync(file, { force: true });
    mkdirSync(file);
    writeFileSync(path.join(file, 'verrou'), '');
    const { reply } = await browser.call('DELETE', '/v1/pair');
    expectError(reply, 500, 'STORAGE_ERROR');
    expect(clients.find(browser.clientId)).toBeUndefined();
    const events = await s.done;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    await waitUntil(() => !gm.busy, 1_500);
  });

  it('navigateur évincé (au-delà de maxClients) pendant sa génération : elle s’arrête, comme pour un retrait', async () => {
    provider = new MockProvider({ reply: 'u'.repeat(20_000), chunkSize: 10, delayMs: 5 });
    await server.stop();
    clients = new ConnectorClientStore(path.join(dir, 'un-seul.json'), fakeCipher(), { now: () => new Date(clock), warn: () => undefined, maxClients: 1 });
    await clients.load();
    server = new ConnectorServer({ ...serverOptions, clients });
    port = (await server.start())!;
    const first = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await first.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    clock += 1_000;
    const second = await paired();
    expect(clients.find(first.clientId)).toBeUndefined();
    const events = await s.done;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    await waitUntil(() => !gm.busy, 1_500);
    // Le navigateur évincé apprend qu'il a été retiré (marque) ; le nouveau génère normalement.
    const evicted = (await first.call('GET', '/v1/status')).reply;
    expectError(evicted, 401, 'CONNECTOR_UNPAIRED');
    expect(evicted.headers[CONNECTOR_HEADERS.revoked.toLowerCase()]).toEqual(expect.any(String));
    expect((await second.call('GET', '/v1/status')).reply.status).toBe(200);
  });

  it('erreur du moteur : message transmis sans adresse ni chemin', async () => {
    // Code non « transitoire » : aucun nouvel essai automatique de la pipeline (test rapide).
    provider = new MockProvider({ failWith: new MagistraError('AI_TIMEOUT', 'Le moteur IA local (http://127.0.0.1:11434) n’a pas répondu à temps.') });
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const events = await (await stream({ method: 'POST', path: '/v1/generate', headers, body })).done;
    const error = events.at(-1) as Extract<GenerationEvent, { type: 'error' }>;
    expect(error).toMatchObject({ type: 'error', code: 'AI_TIMEOUT', message: "Le serveur d'IA n'a pas répondu à temps." });
    expect(error.message).not.toContain('127.0.0.1');
  });
});

describe('écoute', () => {
  it('127.0.0.1 uniquement, premier port libre de la liste ; aucun port libre : null', async () => {
    const blockers: NetServer[] = [];
    const occupy = async (): Promise<number> => {
      const s = createNetServer();
      await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
      blockers.push(s);
      return (s.address() as { port: number }).port;
    };
    try {
      const busy = await occupy();
      const free = await occupy();
      await new Promise<void>(r => blockers.pop()!.close(() => r()));
      const other = new ConnectorServer({
        version: VERSION, allowedOrigins: [ORIGIN], ports: [busy, free], clients, pairing, generations: gm,
        status: async () => { throw new Error('non utilisé'); }, log: () => undefined,
      });
      expect(await other.start()).toBe(free);
      expect(other.port).toBe(free);
      await other.stop();
      expect(other.port).toBeNull();

      const none = new ConnectorServer({
        version: VERSION, allowedOrigins: [ORIGIN], ports: [busy], clients, pairing, generations: gm,
        status: async () => { throw new Error('non utilisé'); }, log: () => undefined,
      });
      expect(await none.start()).toBeNull();
    } finally {
      await Promise.all(blockers.map(s => new Promise<void>(r => s.close(() => r()))));
    }
  });

  it('requête signée AVANT le début de l’écoute (captée par le programme qui occupait ce port) : jamais acceptée ensuite', async () => {
    const browser = await paired();
    const squatter = createNetServer();
    await new Promise<void>(r => squatter.listen(0, '127.0.0.1', r));
    const reused = (squatter.address() as { port: number }).port;
    // Le programme de l'autre session reçoit une requête valablement signée pour CE port, puis le libère.
    const mainPort = port;
    port = reused;
    const { headers } = await browser.sign('GET', '/v1/status');
    await new Promise<void>(r => squatter.close(() => r()));
    clock += 1_000;
    const later = new ConnectorServer({ ...serverOptions, ports: [reused] });
    try {
      expect(await later.start()).toBe(reused);
      // Rejouée telle quelle (horodatage valide, nonce jamais vu PAR CETTE écoute) : refusée.
      const replay = await send({ path: '/v1/status', headers });
      expectError(replay, 401, 'UNAUTHENTICATED');
      expect(replay.headers[CONNECTOR_HEADERS.proof.toLowerCase()]).toBeUndefined();
      // Requête signée pendant l'écoute : acceptée, prouvée.
      const fresh = await browser.call('GET', '/v1/status');
      expect(fresh.reply.status).toBe(200);
      expect(await browser.proofValid(fresh.reply.headers, fresh.nonce)).toBe(true);
    } finally {
      port = mainPort;
      await later.stop();
    }
  });

  it('horloge du système reculée après le début de l’écoute (synchronisation de Windows) : les requêtes du site restent acceptées, recul journalisé une fois', async () => {
    const browser = await paired();
    await server.stop();
    const logs: string[] = [];
    let mono = 1_000;
    const shifted = new ConnectorServer({ ...serverOptions, ports: [0], monotonic: () => mono, log: message => logs.push(message) });
    port = (await shifted.start())!;
    try {
      expect((await browser.call('GET', '/v1/status')).reply.status).toBe(200);
      // 10 s plus tard, l'heure du système est corrigée de 90 s vers l'arrière ; le navigateur (même horloge) signe
      // avec la nouvelle heure.
      mono += 10_000;
      clock -= 80_000;
      const after = await browser.call('GET', '/v1/status');
      expect(after.reply.status).toBe(200);
      expect(await browser.proofValid(after.reply.headers, after.nonce)).toBe(true);
      for (let i = 0; i < 35; i++) {
        mono += 100;
        clock += 100;
        expect((await browser.call('GET', '/v1/status')).reply.status).toBe(200);
      }
      expect(logs.filter(l => l.includes('horloge du système a reculé'))).toHaveLength(1);
      // Une requête signée AVANT le début de l'écoute (heure antérieure au recul) reste refusée.
      const before = await browser.call('GET', '/v1/status', '', { timestamp: String(clock - 100_000) });
      expectError(before.reply, 401, 'UNAUTHENTICATED');
    } finally {
      await shifted.stop();
    }
  });

  it('requêtes malformées de clients qui ne ferment jamais leur côté : connexions détruites, le site joint toujours l’application', async () => {
    const sockets: Socket[] = [];
    try {
      // Autant de connexions que la limite (32) : réponse 400 puis FIN reçus, mais le client ne ferme jamais son côté.
      await Promise.all(Array.from({ length: 32 }, () => new Promise<void>((resolve, reject) => {
        const socket = netConnect({ host: '127.0.0.1', port, allowHalfOpen: true });
        sockets.push(socket);
        let data = '';
        socket.on('error', reject);
        socket.on('data', chunk => (data += String(chunk)));
        socket.on('end', () => (data.startsWith('HTTP/1.1 400') ? resolve() : reject(new Error(data))));
        socket.write('X\r\n\r\n');
      })));
      // Aucune place n'est gardée : GET /v1/hello répond (sinon la connexion serait refusée au-delà de 32).
      let reply: Reply | null = null;
      for (const deadline = Date.now() + 2_000; !reply && Date.now() < deadline;) {
        reply = await send().catch(() => null);
        if (!reply) await new Promise(r => setTimeout(r, 20));
      }
      expect(reply?.status).toBe(200);
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  it('délai de réception de la requête : ne coupe jamais un flux de génération plus long', async () => {
    await server.stop();
    server = new ConnectorServer({
      version: VERSION, allowedOrigins: [ORIGIN], ports: [0], clients, pairing, generations: gm,
      status: async () => { throw new Error('non utilisé'); }, now: () => clock, log: () => undefined,
      timeouts: { headersMs: 300, requestMs: 400, bodyMs: 300, checkIntervalMs: 50 },
    });
    port = (await server.start())!;
    provider = new MockProvider({ reply: 'u'.repeat(1_000), chunkSize: 10, delayMs: 10 });
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const started = Date.now();
    const events = await (await stream({ method: 'POST', path: '/v1/generate', headers, body })).done;
    expect(Date.now() - started).toBeGreaterThan(800);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('arrêt du serveur : connexions coupées, génération du site interrompue', async () => {
    provider = new MockProvider({ reply: 'v'.repeat(20_000), chunkSize: 10, delayMs: 5 });
    const browser = await paired();
    const body = JSON.stringify(REQUEST);
    const { headers } = await browser.sign('POST', '/v1/generate', body);
    const s = await stream({ method: 'POST', path: '/v1/generate', headers, body });
    await s.waitFor(e => e.type === 'delta');
    await server.stop();
    await s.done;
    await waitUntil(() => !gm.busy, 1_500);
    await expect(send()).rejects.toThrow();
  });
});
