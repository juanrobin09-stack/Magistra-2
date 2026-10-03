// Interopérabilité RÉELLE du connecteur local : le client du SITE WEB (src/lib/localConnector : WebCrypto, clés non
// extractibles, preuve exigée) face au connecteur de l'APPLICATION WINDOWS (electron/connector : vrai serveur HTTP sur
// 127.0.0.1, vrai magasin des navigateurs autorisés sur le disque, vraies demandes d'appairage) et au vrai
// GenerationManager (même créneau unique que la fenêtre), avec un fournisseur d'IA simulé (MockProvider).
//
// Rien n'est simulé entre les deux : les chaînes canoniques, les encodages, les en-têtes, les statuts HTTP, la preuve
// et le flux NDJSON sont ceux de production. Seuls diffèrent : fetch de Node (l'en-tête Origin, que le navigateur ajoute
// lui-même, est ajouté ici), le magasin d'appairage en mémoire (IndexedDB dans le navigateur), la boîte de consentement
// (réponse de l'enseignant simulée) et le chiffrement du système (réversible, comme DPAPI).
//
// Parcours : détection, appairage (accepté, refusé), état prouvé, génération en flux avec le résultat à enregistrer,
// annulation, « redémarrage » de l'application (autre port, autre programme sur l'ancien), programme qui occupe un
// port dédié et accepte tout pendant l'appairage (jamais de vérificateur pour lui), programme qui RELAIE tout à la vraie
// application depuis un autre port dédié (accusé, signature et preuve liés au port : rien ne passe par lui), autorisation
// retirée pendant la lecture d'une requête, autorisation retirée dans
// l'application (marque de retrait), application d'une AUTRE session Windows pendant que celle de l'enseignant est
// fermée (appairage gardé, retrait jamais « confirmé » par elle), éviction au-delà de maxClients, code de vérification
// identique des deux côtés, mauvais secret, autre origine, application réglée sur un serveur distant, application
// occupée, contrôleur et client hybride du site (enregistrement du résultat, jamais de repli vers le serveur en ligne).

import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider, type MockProviderOptions } from '@shared/ai/mock';
import { defaultMessage } from '@shared/errors';
import { DEFAULT_PREFERENCES } from '@shared/ipc';
import { CONNECTOR_HEADERS, CONNECTOR_LIMITS, LOCAL_ENGINE_SITE_MESSAGES, OFFICIAL_WEB_ORIGINS, parseAppUrl } from '@shared/localConnector';
import { SITE_ORIGIN } from '@shared/site';
import type { Capabilities, GenerationEvent, GenerationRecordDraft, GenerationRequest } from '@shared/types';
import type { SecretCipher } from '../../electron/aiConfig';
import { toBase64Url } from '../../electron/connector/crypto';
import { LocalConnector, type ConsentRequest } from '../../electron/connector/service';
import { originTraps } from '../electron/officialOrigins';
import { BUSY_WINDOW_MESSAGE, GenerationManager, type GenerationDeps } from '../../electron/generation';
import {
  defaultSleep, LocalConnectorClient, STOPPED_BY_APP_MESSAGE, UNRECOGNIZED_BY_APP_MESSAGE, type LocalConnectorClientOptions,
} from '@/lib/localConnector/client';
import { createLocalEngineController } from '@/lib/localConnector/controller';
import { resetEngineChoiceMemory } from '@/lib/localConnector/engineChoice';
import { MemoryPairingStore, type PairingStore } from '@/lib/localConnector/pairingStore';
import { HybridGenerationClient, LOCAL_PRIVACY_MESSAGE } from '@/lib/runtime/hybrid';
import type { GenerationClient } from '@/lib/runtime/types';

const ORIGIN = 'https://magistra-2.vercel.app';
/** Seconde origine autorisée (origine de développement de la boucle locale), pour les contrôles « autre origine ». */
const DEV_ORIGIN = 'http://127.0.0.1:4175';
const EVIL_ORIGIN = 'https://magistra-2.vercel.app.evil.example';
const VERSION = '2.1.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const REPLY = '# Les fables de La Fontaine\n\n## Introduction\n\nLa fable met en scène des animaux pour instruire en divertissant.\n';

const REQUEST: GenerationRequest = {
  type: 'cours',
  niveau: '6eme',
  matiere: 'francais',
  sujet: 'Les fables de La Fontaine',
  researchMode: 'documents',
  documents: [{
    docId: 'd1', docName: 'fables.pdf', kind: 'pdf', locator: { type: 'pages', start: 2, end: 2 },
    text: 'PASSAGE-CONFIDENTIEL-4412 : Le Corbeau et le Renard, morale sur la flatterie.',
  }],
};

/** Chiffrement du système simulé : réversible, jamais la clé en clair sur le disque. */
function fakeCipher(): SecretCipher {
  return {
    isAvailable: () => true,
    encrypt: plain => Buffer.from([...Buffer.from(plain, 'utf8')].map(b => b ^ 0xa5)).toString('base64'),
    decrypt: enc => Buffer.from([...Buffer.from(enc, 'base64')].map(b => b ^ 0xa5)).toString('utf8'),
  };
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/**
 * fetch d'un navigateur sur la page `origin` : Node n'ajoute pas l'en-tête Origin (le navigateur, lui, l'ajoute
 * toujours aux requêtes CORS et ne permet pas au script de le choisir).
 */
function browserFetch(origin: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    headers.set('User-Agent', CHROME_UA);
    return fetch(input, { ...init, headers });
  };
}

/** Attentes du client raccourcies (sondage de l'appairage) : même logique, test plus rapide. */
const fastSleep = (ms: number, signal?: AbortSignal) => defaultSleep(Math.min(ms, 25), signal);

/** Autre programme sur un port dédié : se présente comme Magistra, répond 200 à tout, sans jamais de preuve. */
async function impostor(port: number): Promise<HttpServer> {
  const server = createHttpServer((req, res) => {
    req.resume();
    const body = req.url === '/v1/hello'
      ? { app: 'magistra', protocol: 2, version: '9.9.9' }
      : { version: '9.9.9', engine: { ready: true, local: true, label: 'Imposteur' }, capabilities: { maxDocumentChars: 1, research: { academic: false, web: false, institutional: false, wikipedia: false } }, busy: false };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

/**
 * Programme qui occupe un port dédié AVANT l'application (autre session Windows d'un PC partagé ou d'un serveur de
 * bureaux à distance : les ports de la boucle locale sont communs à toutes les sessions). Il se présente comme
 * Magistra et accepte tout : accord immédiat, accusé de réception inventé (il n'a jamais reçu l'URL magistra://),
 * appairage « réussi » avec sa propre clé. Il note tout ce qu'il reçoit.
 */
async function greedyImpostor(port: number): Promise<{ server: HttpServer; received: { method: string; path: string; body: string }[] }> {
  const received: { method: string; path: string; body: string }[] = [];
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ method: req.method ?? '', path: req.url ?? '', body });
      let reply: unknown = { ok: true };
      if (req.url === '/v1/hello') reply = { app: 'magistra', protocol: 2, version: '9.9.9' };
      if (req.url === '/v1/pair' && req.method === 'POST') {
        const input = JSON.parse(body || '{}') as Record<string, unknown>;
        const ack = randomBytes(32).toString('base64url');
        reply = 'verifier' in input
          ? { status: 'approved', clientId: randomBytes(16).toString('base64url'), connectorPublicKey: createECDH('prime256v1').generateKeys().toString('base64url'), version: '9.9.9', ack }
          : { status: 'consented', ack };
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
      });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, received };
}

/**
 * Programme qui occupe un autre port dédié et RELAIE tout, tel quel, à la vraie application (autre session Windows d'un
 * PC partagé, programme lancé avant Magistra). Il ne réécrit que l'en-tête Host (sinon l'application refuserait tout),
 * note chaque requête reçue et modifie le texte des réponses (« Fontaine » → « CONTENU-INJECTÉ »).
 */
async function relay(listenPort: number, target: () => number): Promise<{ server: HttpServer; received: string[] }> {
  const received: string[] = [];
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      received.push(`${req.method} ${req.url} ${body.toString('utf8')}`);
      const headers = { ...req.headers, host: `127.0.0.1:${target()}` };
      const upstream = httpRequest({ host: '127.0.0.1', port: target(), method: req.method, path: req.url, headers, agent: false, setHost: false }, up => {
        const { 'content-length': _length, ...upHeaders } = up.headers;
        res.writeHead(up.statusCode ?? 502, upHeaders);
        up.setEncoding('utf8');
        up.on('data', (text: string) => res.write(text.replace(/Fontaine/g, 'CONTENU-INJECTÉ')));
        up.on('end', () => res.end());
      });
      upstream.on('error', () => res.destroy());
      upstream.end(body);
    });
  });
  await new Promise<void>(resolve => server.listen(listenPort, '127.0.0.1', resolve));
  return { server, received };
}

// ─── Application simulée autour du VRAI connecteur ─────────────────────────

interface App {
  connector: LocalConnector;
  manager: GenerationManager;
  provider: MockProvider;
  consents: ConsentRequest[];
  saved: ReturnType<typeof vi.fn>;
}

let dir: string;
let file: string;
let cipher: SecretCipher;
let apps: App[];
let servers: HttpServer[];
/** Réponse de l'enseignant dans la boîte de consentement. */
let consentAnswer: boolean;
/** Moteur actif de l'application sur cet ordinateur (faux : réglée sur un serveur distant). */
let localEngine: boolean;
let engineReady: boolean;
/** URL magistra:// ouvertes par le site (le « système » les remet à l'application en cours). */
let opened: string[];
let current: App | null;

/** `appFile` : local-connector.json de l'application (autre fichier : application d'une autre session Windows). */
function startApp(
  ports: readonly number[], providerOptions: MockProviderOptions = {}, appFile = file, maxClients?: number, allowedOrigins: readonly string[] = [ORIGIN, DEV_ORIGIN],
): Promise<App> {
  const provider = new MockProvider({ reply: REPLY, chunkSize: 12, model: 'ministral-3:8b', ...providerOptions });
  const saved = vi.fn(async () => ({ id: 'jamais' }));
  const deps: GenerationDeps = {
    store: { saveGeneration: saved, getPreferences: async () => ({ ...DEFAULT_PREFERENCES }) },
    resolveProvider: async () => provider,
    describeActive: async () => ({
      label: localEngine ? 'Magistra Standard' : 'ia.exemple.fr',
      contextTokens: 16_384,
      privacy: localEngine ? { level: 'local', message: 'IA locale' } : { level: 'remote', message: 'Serveur distant' },
      ready: engineReady,
      ...(engineReady ? {} : { notReady: { code: 'MODEL_NOT_INSTALLED', message: defaultMessage('MODEL_NOT_INSTALLED') } }),
    }),
    send: () => true,
    fetch: async () => {
      throw new Error('aucun accès réseau dans ce test');
    },
    isLocalEngine: () => localEngine,
  };
  const manager = new GenerationManager(deps);
  const consents: ConsentRequest[] = [];
  const connector = new LocalConnector({
    file: appFile,
    cipher,
    ...(maxClients ? { maxClients } : {}),
    version: VERSION,
    allowedOrigins,
    ports,
    generation: manager,
    askConsent: async request => {
      consents.push(request);
      return consentAnswer;
    },
    log: () => undefined,
  });
  const app: App = { connector, manager, provider, consents, saved };
  return connector.init().then(() => connector.start()).then(() => {
    apps.push(app);
    current = app;
    return app;
  });
}

async function stopApp(app: App): Promise<void> {
  await app.connector.stop();
  if (current === app) current = null;
}

/** Ouverture d'une URL magistra:// par le site : remise à l'application en cours (comme le ferait Windows). */
function openUrl(url: string): void {
  opened.push(url);
  void current?.connector.handleAppUrl(url, () => undefined);
}

function clientOptions(ports: readonly number[], over: Partial<LocalConnectorClientOptions> = {}): LocalConnectorClientOptions {
  const origin = over.origin ?? ORIGIN;
  return {
    ports,
    origin,
    fetch: browserFetch(origin),
    store: new MemoryPairingStore(),
    openUrl,
    permission: async () => 'granted',
    sleep: fastSleep,
    ...over,
  };
}

async function collect(client: LocalConnectorClient, signal = new AbortController().signal, onEvent?: (e: GenerationEvent) => void): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  await client.generate(REQUEST, event => {
    events.push(event);
    onEvent?.(event);
  }, signal);
  return events;
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { code?: string; message?: string };
  }
  throw new Error('La promesse aurait dû échouer.');
}

async function until(test: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('Délai dépassé.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function pairedClient(ports: readonly number[], over: Partial<LocalConnectorClientOptions> = {}) {
  const options = clientOptions(ports, over);
  const client = new LocalConnectorClient(options);
  await client.pair(new AbortController().signal);
  return { client, options, store: options.store as PairingStore };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-interop-'));
  file = path.join(dir, 'local-connector.json');
  cipher = fakeCipher();
  apps = [];
  servers = [];
  consentAnswer = true;
  localEngine = true;
  engineReady = true;
  opened = [];
  current = null;
  resetEngineChoiceMemory();
});

afterEach(async () => {
  await Promise.all(apps.map(app => app.connector.stop()));
  await Promise.all(servers.map(s => new Promise<void>(resolve => (s.listening ? s.close(() => resolve()) : resolve()))));
  rmSync(dir, { recursive: true, force: true });
  resetEngineChoiceMemory();
});

// ─── Parcours ───────────────────────────────────────────────────────────────

describe('site web ⇄ application : protocole réel', () => {
  it('détection, appairage accepté (aucun secret dans l’URL), état prouvé, génération en flux avec le résultat à enregistrer', async () => {
    const app = await startApp([0]);
    const port = app.connector.port!;
    const options = clientOptions([port]);
    const client = new LocalConnectorClient(options);

    const found = await client.hello();
    expect(found).toEqual({ port, hello: { app: 'magistra', protocol: 2, version: VERSION } });
    expect(await client.hasPairing()).toBe(false);

    await client.pair(new AbortController().signal);
    // URL magistra://pair : identifiant, défi et origine seulement — jamais le vérificateur ni une clé.
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect([...url.searchParams.keys()].sort()).toEqual(['challenge', 'id', 'origin', 'v']);
    expect(parseAppUrl(opened[0])).toMatchObject({ kind: 'pair', origin: ORIGIN });
    expect(app.consents).toHaveLength(1);
    expect(app.consents[0].message).toBe('Autoriser magistra-2.vercel.app à utiliser l’intelligence locale de cet ordinateur ?');

    // Les deux côtés connaissent le même navigateur ; la clé n'est jamais écrite en clair sur le disque.
    const stored = await options.store!.load();
    const [info] = app.connector.status().clients;
    expect(stored?.clientId).toBe(info.clientId);
    expect(stored?.port).toBe(port);
    expect(stored?.key.extractable).toBe(false);
    expect(info).toMatchObject({ site: 'magistra-2.vercel.app', browser: 'Google Chrome' });
    const rawKey = toBase64Url(app.connector.clients.find(info.clientId)!.key);
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).toContain(info.clientId);
    expect(onDisk).not.toContain(rawKey);
    expect(onDisk).not.toContain(Buffer.from(rawKey, 'base64url').toString('base64'));

    const status = await client.status();
    expect(status).toEqual({
      version: VERSION,
      engine: { ready: true, local: true, label: 'Magistra Standard' },
      capabilities: { maxDocumentChars: expect.any(Number), research: { academic: true, web: false, institutional: false, wikipedia: true, trustedCatalogue: true } },
      busy: false,
    });

    const events = await collect(client);
    const deltas = events.filter(e => e.type === 'delta').map(e => (e as { text: string }).text);
    expect(deltas.length).toBeGreaterThan(3);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') throw new Error('évènement final inattendu');
    expect(done.saved).toBe(false);
    expect(done.id).toBeUndefined();
    expect(done.content).toContain('Les fables de La Fontaine');
    // Résultat à enregistrer par le site (jamais par l'application) : identique au contenu affiché, sans identifiant.
    expect(done.record).toMatchObject({ type: 'cours', niveau: '6eme', matiere: 'francais', sujet: REQUEST.sujet, contenu: done.content, model: 'ministral-3:8b' });
    expect(done.record).not.toHaveProperty('id');
    expect(app.saved).not.toHaveBeenCalled();
    // Les extraits de documents sont bien parvenus au moteur de l'application (et à lui seul).
    expect(JSON.stringify(app.provider.calls[0].messages)).toContain('PASSAGE-CONFIDENTIEL-4412');
    await until(() => !app.manager.busy);
  });

  it('appairage refusé dans l’application : CONNECTOR_PAIRING_REFUSED, rien d’enregistré de part et d’autre', async () => {
    consentAnswer = false;
    const app = await startApp([0]);
    const options = clientOptions([app.connector.port!]);
    const client = new LocalConnectorClient(options);
    const err = await rejection(client.pair(new AbortController().signal));
    expect(err.code).toBe('CONNECTOR_PAIRING_REFUSED');
    expect(err.message).toBe(defaultMessage('CONNECTOR_PAIRING_REFUSED'));
    expect(await client.hasPairing()).toBe(false);
    expect(app.connector.status().clients).toEqual([]);
    expect(app.consents).toHaveLength(1);
  });

  it('annulation par le site : flux fermé, arrêt demandé, génération de l’application interrompue et créneau libéré', async () => {
    const app = await startApp([0], { reply: REPLY.repeat(40), chunkSize: 4, delayMs: 15 });
    const { client } = await pairedClient([app.connector.port!]);
    const controller = new AbortController();
    const events = await collect(client, controller.signal, event => {
      if (event.type === 'delta') controller.abort();
    });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    await until(() => !app.manager.busy);
    expect(app.provider.calls[0].signal?.aborted).toBe(true);
    // Le créneau unique est libre : une nouvelle génération du site est acceptée (puis arrêtée à son tour).
    const again = new AbortController();
    const next = await collect(client, again.signal, event => {
      if (event.type === 'delta') again.abort();
    });
    expect(next.some(e => e.type === 'delta')).toBe(true);
    expect(next.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    await until(() => !app.manager.busy);
    expect(app.provider.calls).toHaveLength(2);
  });

  it('redémarrage de l’application (autre port, autre programme sur l’ancien) : reconnexion SANS nouvel appairage', async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const first = await startApp([p1, p2]);
    expect(first.connector.port).toBe(p1);
    const { store, options } = await pairedClient([p1, p2]);
    expect(first.consents).toHaveLength(1);
    await stopApp(first);

    // Un autre programme prend l'ancien port et se fait passer pour Magistra : ignoré (aucune preuve).
    servers.push(await impostor(p1));
    const second = await startApp([p1, p2]);
    expect(second.connector.port).toBe(p2);
    // Nouvelle visite du site (rechargement de la page) : même appairage mémorisé.
    const reloaded = new LocalConnectorClient(options);
    const status = await reloaded.status();
    expect(status.version).toBe(VERSION);
    expect((await store.load())?.port).toBe(p2);
    expect(second.consents).toHaveLength(0);
    expect((await collect(reloaded)).at(-1)?.type).toBe('done');
  });

  it('PC partagé : l’application de l’enseignant fermée, celle d’une AUTRE session ouverte → appairage gardé, retrait jamais « confirmé » par elle ; la sienne rouverte → reconnue', async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const mine = await startApp([p2]);
    const { client, store } = await pairedClient([p1, p2]);
    const clientId = (await store.load())!.clientId;
    await stopApp(mine);
    // Magistra d'un collègue (autre session : son propre fichier, ne connaît pas ce navigateur) sur l'autre port dédié.
    const colleague = await startApp([p1], {}, path.join(dir, 'autre-session.json'));
    expect(colleague.connector.port).toBe(p1);
    const reloaded = new LocalConnectorClient({ ...clientOptions([p1, p2]), store });
    expect(await rejection(reloaded.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED', message: UNRECOGNIZED_BY_APP_MESSAGE });
    expect(await reloaded.hasPairing()).toBe(true);
    // Rien n'est généré par l'application du collègue.
    expect((await collect(reloaded)).at(-1)).toMatchObject({ type: 'error', code: 'CONNECTOR_UNPAIRED' });
    expect(colleague.provider.calls).toHaveLength(0);
    // La sienne rouverte : reconnue sans nouvel appairage.
    const back = await startApp([p2]);
    expect((await reloaded.status()).version).toBe(VERSION);
    expect(back.consents).toHaveLength(0);
    // Déconnexion pendant que la sienne est fermée : le 401 du collègue ne vaut pas confirmation du retrait.
    await stopApp(back);
    expect(await client.unpair()).toBe(false);
    const again = await startApp([p2]);
    expect(again.connector.status().clients.map(c => c.clientId)).toEqual([clientId]);
  });

  it('navigateur évincé au-delà de maxClients : sa génération en cours s’arrête ; il l’apprend (marque de retrait) et oublie son appairage', async () => {
    const app = await startApp([0], { reply: REPLY.repeat(40), chunkSize: 4, delayMs: 15 }, file, 1);
    const port = app.connector.port!;
    const first = await pairedClient([port]);
    const running = collect(first.client);
    await until(() => app.manager.busy);
    const second = await pairedClient([port]);
    expect((await running).at(-1)).toMatchObject({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STOPPED_BY_APP_MESSAGE });
    await until(() => !app.manager.busy);
    expect(await rejection(first.client.status())).toMatchObject({ code: 'CONNECTOR_UNPAIRED', message: defaultMessage('CONNECTOR_UNPAIRED') });
    expect(await first.client.hasPairing()).toBe(false);
    expect((await second.client.status()).version).toBe(VERSION);
  });

  it('code de vérification : celui que le site affiche est celui de la boîte de consentement de l’application', async () => {
    const app = await startApp([0]);
    const codes: string[] = [];
    const client = new LocalConnectorClient(clientOptions([app.connector.port!]));
    await client.pair(new AbortController().signal, code => codes.push(code));
    expect(codes).toHaveLength(1);
    expect(app.consents.map(c => c.code)).toEqual(codes);
    expect(app.consents[0].detail).toContain(codes[0]);
  });

  it('programme qui occupe le premier port dédié et accepte tout : le vérificateur ne lui est JAMAIS envoyé ; appairage avec la vraie application sur le port suivant', async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const fake = await greedyImpostor(p1);
    servers.push(fake.server);
    const app = await startApp([p1, p2]);
    expect(app.connector.port).toBe(p2);

    const { client, store } = await pairedClient([p1, p2]);
    const stored = (await store.load())!;
    expect(stored.port).toBe(p2);
    expect(app.connector.status().clients.map(c => c.clientId)).toEqual([stored.clientId]);
    expect(app.consents).toHaveLength(1);

    // Le faux connecteur n'a reçu que des requêtes sans secret : présence, puis premier temps de l'appairage (le défi,
    // seul moyen de produire l'accusé, n'est dans aucune requête HTTP).
    const request = parseAppUrl(opened[0]);
    if (!request || request.kind !== 'pair') throw new Error('URL d’appairage attendue');
    const pairs = fake.received.filter(r => r.path === '/v1/pair' && r.method === 'POST');
    expect(pairs.length).toBeGreaterThan(0);
    for (const r of fake.received) {
      expect(['/v1/hello', '/v1/pair']).toContain(r.path);
      expect(r.body).not.toContain(request.challenge);
      expect(r.body).not.toMatch(/verifier|clientPublicKey/);
    }
    for (const r of pairs) expect(JSON.parse(r.body)).toEqual({ pairingId: request.pairingId });

    // La suite ne va qu'à l'application qui a prouvé détenir la clé : ni demande ni extrait de document pour le faux.
    expect((await collect(client)).at(-1)?.type).toBe('done');
    expect(JSON.stringify(app.provider.calls[0].messages)).toContain('PASSAGE-CONFIDENTIEL-4412');
    expect(fake.received.every(r => !r.body.includes('PASSAGE-CONFIDENTIEL-4412'))).toBe(true);
    expect(fake.received.filter(r => r.path !== '/v1/hello' && r.path !== '/v1/pair')).toEqual([]);
    await until(() => !app.manager.busy);
  });

  it('programme qui RELAIE tout à la vraie application depuis un port essayé avant elle : ignoré (accusé du mauvais port), ni vérificateur, ni clé, ni document pour lui', async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const app = await startApp([p2]);
    expect(app.connector.port).toBe(p2);
    const fake = await relay(p1, () => p2);
    servers.push(fake.server);

    const { client, store } = await pairedClient([p1, p2]);
    // Appairage fait avec l'application elle-même, sur SON port : le relais a transmis un accusé valable pour p2 seulement.
    expect((await store.load())!.port).toBe(p2);
    expect(app.consents).toHaveLength(1);
    expect(fake.received.some(r => r.startsWith('POST /v1/pair'))).toBe(true);
    for (const r of fake.received) expect(r).not.toMatch(/verifier|clientPublicKey/);

    const events = await collect(client);
    expect(events.at(-1)?.type).toBe('done');
    expect(JSON.stringify(events)).not.toContain('CONTENU-INJECTÉ');
    expect(fake.received.every(r => !r.includes('PASSAGE-CONFIDENTIEL-4412'))).toBe(true);
    expect(fake.received.filter(r => !r.startsWith('GET /v1/hello') && !r.startsWith('POST /v1/pair') && !r.startsWith('OPTIONS'))).toEqual([]);
    await until(() => !app.manager.busy);
  });

  it('appairage légitime puis redémarrage de l’application sur un autre port, un relais ayant pris l’ancien : requête relayée refusée, génération directe, port mis à jour', async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const first = await startApp([p1, p2]);
    expect(first.connector.port).toBe(p1);
    const { store, options } = await pairedClient([p1, p2]);
    expect((await store.load())!.port).toBe(p1);
    await stopApp(first);

    // L'autre programme prend p1 et relaie tout vers l'application, redémarrée sur p2.
    const fake = await relay(p1, () => p2);
    servers.push(fake.server);
    const second = await startApp([p1, p2]);
    expect(second.connector.port).toBe(p2);

    const reloaded = new LocalConnectorClient(options);
    const events = await collect(reloaded);
    expect(events.at(-1)?.type).toBe('done');
    expect(JSON.stringify(events)).not.toContain('CONTENU-INJECTÉ');
    // Le relais n'a reçu qu'une requête d'état signée pour SON port (refusée par l'application : Host réécrit, signature
    // fausse), jamais la demande ni les extraits de documents.
    expect(fake.received.some(r => r.startsWith('GET /v1/status'))).toBe(true);
    expect(fake.received.every(r => !r.includes('PASSAGE-CONFIDENTIEL-4412') && !r.startsWith('POST /v1/generate'))).toBe(true);
    expect((await store.load())!.port).toBe(p2);
    expect(second.consents).toHaveLength(0);
    await until(() => !second.manager.busy);
  });

  it('autorisation retirée dans l’application : CONNECTOR_UNPAIRED côté site, appairage oublié, génération refusée', async () => {
    const app = await startApp([0], { reply: REPLY.repeat(40), chunkSize: 4, delayMs: 15 });
    const { client, store } = await pairedClient([app.connector.port!]);
    const clientId = (await store.load())!.clientId;

    // Pendant une génération : elle est interrompue par le retrait ; le site le dit (jamais un « Arrêter » de l'enseignant).
    const events = await collect(client, new AbortController().signal, event => {
      if (event.type === 'delta' && app.connector.status().clients.length) void app.connector.revoke(clientId);
    });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STOPPED_BY_APP_MESSAGE });
    await until(() => !app.manager.busy);

    const err = await rejection(client.status());
    expect(err.code).toBe('CONNECTOR_UNPAIRED');
    expect(await client.hasPairing()).toBe(false);
    const after = await collect(client);
    expect(after).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNPAIRED' })]);
    expect(app.provider.calls).toHaveLength(1);
  });

  it('déconnexion depuis le site : DELETE /v1/pair signé et prouvé, autorisation retirée dans l’application, appairage oublié', async () => {
    const app = await startApp([0], { reply: REPLY.repeat(40), chunkSize: 4, delayMs: 15 });
    const { client, store } = await pairedClient([app.connector.port!]);
    const pairing = (await store.load())!;
    expect(app.connector.status().clients.map(c => c.clientId)).toEqual([pairing.clientId]);
    // Génération en cours de ce navigateur : arrêtée par le retrait.
    const running = collect(client);
    await until(() => app.manager.busy);
    await client.unpair();
    expect(app.connector.status().clients).toEqual([]);
    expect(await client.hasPairing()).toBe(false);
    expect((await running).at(-1)).toMatchObject({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: STOPPED_BY_APP_MESSAGE });
    await until(() => !app.manager.busy);
    // Une requête signée avec l'ancienne clé est désormais refusée (401 CONNECTOR_UNPAIRED, sans preuve).
    const stale = new MemoryPairingStore();
    await stale.save(pairing);
    const old = new LocalConnectorClient(clientOptions([app.connector.port!], { store: stale }));
    expect((await rejection(old.status())).code).toBe('CONNECTOR_UNPAIRED');
    expect(await old.hasPairing()).toBe(false);
  });

  it('mauvais secret : réponse non prouvée jamais lue, appairage conservé ; trop d’échecs → blocage temporaire (429)', async () => {
    const app = await startApp([0]);
    const port = app.connector.port!;
    const { client, store } = await pairedClient([port]);
    const genuine = (await store.load())!;

    // Même identifiant, autre clé : l'application refuse (401 sans preuve), le site ne croit pas cette réponse.
    const wrongKey = await globalThis.crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
    const forgedStore = new MemoryPairingStore();
    await forgedStore.save({ ...genuine, key: wrongKey });
    const forged = new LocalConnectorClient(clientOptions([port], { store: forgedStore }));
    const err = await rejection(forged.status());
    expect(err.code).toBe('CONNECTOR_UNREACHABLE');
    expect(await forged.hasPairing()).toBe(true);
    const events = await collect(forged);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNREACHABLE' })]);
    expect(app.provider.calls).toHaveLength(0);

    // Le vrai navigateur n'est pas concerné…
    expect((await client.status()).version).toBe(VERSION);
    // … jusqu'au blocage temporaire après trop d'échecs d'authentification (hello reste disponible).
    for (let i = 0; i < CONNECTOR_LIMITS.maxAuthFailuresPerMinute; i++) await rejection(forged.status());
    const raw = await browserFetch(ORIGIN)(`http://127.0.0.1:${port}/v1/status`, { headers: { [CONNECTOR_HEADERS.client]: genuine.clientId } });
    expect(raw.status).toBe(429);
    expect(raw.headers.get(CONNECTOR_HEADERS.proof)).toBeNull();
    expect((await rejection(client.status())).code).toBe('CONNECTOR_UNREACHABLE');
    expect(await client.hello()).not.toBeNull();
  });

  it('autre origine : aucune réponse lisible ni appairage possible ; un appairage ne vaut que pour son origine', async () => {
    const app = await startApp([0]);
    const port = app.connector.port!;

    // Site non autorisé : 403 sans aucun en-tête CORS (le navigateur ne laisse rien lire), aucune boîte de consentement.
    const evilFetch = browserFetch(EVIL_ORIGIN);
    const refused = await evilFetch(`http://127.0.0.1:${port}/v1/hello`, {});
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    let virtual = 0;
    const evil = new LocalConnectorClient(clientOptions([port], {
      origin: EVIL_ORIGIN,
      now: () => Date.now() + virtual,
      sleep: async (ms, signal) => {
        virtual += ms;
        await defaultSleep(1, signal);
      },
    }));
    expect(await evil.hello()).toBeNull();
    expect((await rejection(evil.pair(new AbortController().signal))).code).toBe('CONNECTOR_UNREACHABLE');
    expect(app.consents).toHaveLength(0);
    expect(app.connector.pairing.pending).toBeNull();

    // Appairage fait par le site officiel : présenté par une autre origine (même autorisée), il ne vaut rien.
    const { store } = await pairedClient([port]);
    const other = new LocalConnectorClient(clientOptions([port], { origin: DEV_ORIGIN, store }));
    expect((await rejection(other.status())).code).toBe('CONNECTOR_UNPAIRED');
    expect(app.provider.calls).toHaveLength(0);
  });

  it('application réglée sur un serveur distant, puis modèle absent : jamais de génération, cause précise', async () => {
    localEngine = false;
    const app = await startApp([0]);
    const { client } = await pairedClient([app.connector.port!]);
    const status = await client.status();
    expect(status.engine).toEqual({
      ready: false, local: false, label: 'Serveur d’IA distant',
      notReady: { code: 'LOCAL_ENGINE_REMOTE', message: defaultMessage('LOCAL_ENGINE_REMOTE') },
    });
    expect(JSON.stringify(status)).not.toContain('ia.exemple.fr');
    expect(await collect(client)).toEqual([expect.objectContaining({ type: 'error', code: 'LOCAL_ENGINE_REMOTE' })]);
    expect(app.provider.calls).toHaveLength(0);

    localEngine = true;
    engineReady = false;
    // Cause précise, par un texte neutre pour le site (jamais le message de la fenêtre de l'application).
    expect((await client.status()).engine).toMatchObject({
      ready: false, local: true, notReady: { code: 'MODEL_NOT_INSTALLED', message: LOCAL_ENGINE_SITE_MESSAGES.MODEL_NOT_INSTALLED },
    });
  });

  it('application occupée par une génération de sa fenêtre : GENERATION_BUSY (message propre au site), rien n’est lancé', async () => {
    const app = await startApp([0], { reply: REPLY.repeat(40), chunkSize: 4, delayMs: 15 });
    const { client } = await pairedClient([app.connector.port!]);
    const { jobId } = app.manager.start(REQUEST);
    expect((await client.status()).busy).toBe(true);
    const events = await collect(client);
    expect(events).toEqual([{ type: 'error', code: 'GENERATION_BUSY', message: BUSY_WINDOW_MESSAGE, retryable: true }]);
    app.manager.cancel(jobId);
    await until(() => !app.manager.busy);
    expect(app.provider.calls).toHaveLength(1);
  });
});

describe('origines officielles du site (OFFICIAL_WEB_ORIGINS) : le vrai client du site face au vrai connecteur', () => {
  const official = [...OFFICIAL_WEB_ORIGINS];

  it.each(official)('%s : détection, appairage (boîte au nom d’hôte), état prouvé, génération en flux', async origin => {
    const app = await startApp([0], {}, file, undefined, official);
    const port = app.connector.port!;
    const { client } = await pairedClient([port], { origin });
    const host = new URL(origin).host;
    expect(parseAppUrl(opened[0])).toMatchObject({ kind: 'pair', origin });
    expect(app.consents).toHaveLength(1);
    expect(app.consents[0]).toMatchObject({ origin, site: host, message: `Autoriser ${host} à utiliser l’intelligence locale de cet ordinateur ?` });
    expect(app.connector.status().clients).toEqual([expect.objectContaining({ site: host, browser: 'Google Chrome' })]);
    expect((await client.status()).engine).toEqual({ ready: true, local: true, label: 'Magistra Standard' });
    const events = await collect(client);
    expect(events.at(-1)?.type).toBe('done');
    await until(() => !app.manager.busy);
  });

  it('variantes piégées du nouveau domaine : aucune réponse lisible (403 sans CORS), aucune boîte, aucun appairage', async () => {
    const app = await startApp([0], {}, file, undefined, official);
    const port = app.connector.port!;
    // Origines qu'un en-tête peut porter (l'API fetch refuse les autres : un navigateur n'envoie que du punycode).
    const sendable = originTraps(SITE_ORIGIN).filter(value => {
      try {
        new Headers({ Origin: value });
        return true;
      } catch {
        return false;
      }
    });
    expect(sendable.length).toBeGreaterThan(60);
    for (const trap of sendable) {
      const reply = await browserFetch(trap)(`http://127.0.0.1:${port}/v1/hello`, {});
      expect(reply.status, trap).toBe(403);
      expect(reply.headers.get('access-control-allow-origin'), trap).toBeNull();
      await reply.arrayBuffer();
    }
    // Le client du site, sur l'apex (non servi par le projet), ne trouve rien et ne peut pas s'appairer.
    let virtual = 0;
    const apex = new LocalConnectorClient(clientOptions([port], {
      origin: 'https://mag-istra.fr',
      now: () => Date.now() + virtual,
      sleep: async (ms, signal) => {
        virtual += ms;
        await defaultSleep(1, signal);
      },
    }));
    expect(await apex.hello()).toBeNull();
    expect((await rejection(apex.pair(new AbortController().signal))).code).toBe('CONNECTOR_UNREACHABLE');
    expect(app.consents).toHaveLength(0);
    expect(app.connector.pairing.pending).toBeNull();
    // Une demande d'appairage magistra://pair au nom de l'apex est ignorée par l'application.
    await app.connector.handleAppUrl(`magistra://pair?v=2&id=${'A'.repeat(22)}&challenge=${'B'.repeat(43)}&origin=${encodeURIComponent('https://mag-istra.fr')}`, () => undefined);
    expect(app.consents).toHaveLength(0);
    expect(app.connector.status().clients).toEqual([]);
  });

  it('un appairage fait depuis l’ancienne adresse ne vaut pas pour le nouveau domaine : il faut se reconnecter (une autorisation est liée à son origine)', async () => {
    const app = await startApp([0], {}, file, undefined, official);
    const port = app.connector.port!;
    const { store } = await pairedClient([port], { origin: official[0] });
    const modern = new LocalConnectorClient(clientOptions([port], { origin: official[1], store }));
    expect((await rejection(modern.status())).code).toBe('CONNECTOR_UNPAIRED');
    expect(app.provider.calls).toHaveLength(0);
    // Le nouveau domaine s'appaire à son tour, sans retirer l'autorisation de l'ancienne adresse.
    const second = await pairedClient([port], { origin: official[1] });
    expect(app.consents.map(c => c.origin)).toEqual(official);
    expect(app.connector.status().clients.map(c => c.site).sort()).toEqual(['magistra-2.vercel.app', 'www.mag-istra.fr']);
    expect((await second.client.status()).busy).toBe(false);
  });
});

describe('contrôleur et client hybride du site face au vrai connecteur', () => {
  it('« trouvée » → « connectée » ; génération locale enregistrée par le site ; application fermée : erreur, jamais de repli', async () => {
    const app = await startApp([0]);
    const port = app.connector.port!;
    const options = clientOptions([port]);
    const controller = createLocalEngineController(options);

    await controller.autoCheck();
    expect(controller.getSnapshot()).toMatchObject({ kind: 'found', paired: false, permission: 'granted', appVersion: VERSION });
    await controller.connect();
    expect(controller.getSnapshot()).toMatchObject({ kind: 'connected', paired: true, status: { engine: { ready: true, local: true } } });

    const server: GenerationClient & { generate: ReturnType<typeof vi.fn>; capabilities: ReturnType<typeof vi.fn> } = {
      kind: 'web',
      capabilities: vi.fn(async (): Promise<Capabilities> => {
        throw new Error('le serveur en ligne ne doit pas être consulté');
      }),
      generate: vi.fn(async () => {
        throw new Error('le serveur en ligne ne doit jamais générer ici');
      }),
    };
    const drafts: GenerationRecordDraft[] = [];
    const hybrid = new HybridGenerationClient(server, controller, async draft => {
      drafts.push(draft);
      return { id: `brouillon-${drafts.length}` };
    });

    expect(await hybrid.route()).toBe('local-connector');
    const caps = await hybrid.capabilities();
    expect(caps).toMatchObject({
      route: 'local-connector', ready: true, engineLabel: 'Magistra locale — Magistra Standard',
      privacy: { level: 'local', message: LOCAL_PRIVACY_MESSAGE },
    });

    const events: GenerationEvent[] = [];
    await hybrid.generate(REQUEST, e => events.push(e), new AbortController().signal);
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: 'done', saved: true, id: 'brouillon-1' });
    expect(done).not.toHaveProperty('record');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].contenu).toBe((done as { content: string }).content);
    // Vers le serveur Magistra : le résultat et les paramètres de la demande, jamais le texte des extraits de documents.
    expect(JSON.stringify(drafts[0])).not.toContain('PASSAGE-CONFIDENTIEL-4412');

    await stopApp(app);
    const failed: GenerationEvent[] = [];
    await hybrid.generate(REQUEST, e => failed.push(e), new AbortController().signal);
    expect(failed.at(-1)).toMatchObject({ type: 'error', code: 'CONNECTOR_UNREACHABLE' });
    await until(() => controller.getSnapshot().kind === 'app-closed');
    expect(await hybrid.capabilities()).toMatchObject({ route: 'local-connector', ready: false, notReady: { code: 'CONNECTOR_UNREACHABLE' } });
    expect(server.generate).not.toHaveBeenCalled();
    expect(server.capabilities).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(1);
  });

  it('autorisation retirée dans l’application : le contrôleur le détecte (« trouvée », cause affichée), le site reste sur Magistra locale ; nouvel appairage possible', async () => {
    const app = await startApp([0]);
    const controller = createLocalEngineController(clientOptions([app.connector.port!]));
    const server: GenerationClient = {
      kind: 'web',
      capabilities: async () => {
        throw new Error('le serveur en ligne ne doit pas être consulté');
      },
      generate: vi.fn(async () => undefined),
    };
    const hybrid = new HybridGenerationClient(server, controller, async () => ({ id: 'jamais' }));
    await controller.detect();
    await controller.connect();
    expect(controller.getSnapshot().kind).toBe('connected');
    const [info] = app.connector.status().clients;
    await app.connector.revoke(info.clientId);

    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      kind: 'found', paired: false, error: { code: 'CONNECTOR_UNPAIRED', message: defaultMessage('CONNECTOR_UNPAIRED') },
    });
    // Appairage perdu : jamais de passage de lui-même au serveur en ligne (Magistra locale reste choisie, non prête).
    expect(await hybrid.route()).toBe('local-connector');
    expect(await hybrid.capabilities()).toMatchObject({ route: 'local-connector', ready: false, notReady: { code: 'CONNECTOR_UNPAIRED' } });
    const events: GenerationEvent[] = [];
    await hybrid.generate(REQUEST, e => events.push(e), new AbortController().signal);
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'CONNECTOR_UNPAIRED' })]);
    expect(server.generate).not.toHaveBeenCalled();
    await controller.connect();
    expect(controller.getSnapshot()).toMatchObject({ kind: 'connected', paired: true });
    expect(app.connector.status().clients).toHaveLength(1);
    expect(app.consents).toHaveLength(2);
  });
});
