// Outils communs aux tests du serveur : dépendances simulées et serveur HTTP éphémère.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MockProvider } from '../../shared/ai/mock.js';
import type { AIProvider } from '../../shared/ai/provider.js';
import { MagistraError } from '../../shared/errors.js';
import type { GenerationEvent } from '../../shared/types.js';
import { createServerDeps, type DepsOverrides, type ServerDeps } from '../../server/deps.js';
import { handleNodeRequest } from '../../server/node.js';
import { MemoryStore, type GenerationStore } from '../../server/store.js';

/** Vérificateur factice : « token-A » → user_A, « token-B » → user_B, tout le reste est refusé. */
export async function fakeVerifier(token: string): Promise<string> {
  if (token === 'token-A') return 'user_A';
  if (token === 'token-B') return 'user_B';
  throw new MagistraError('UNAUTHENTICATED');
}

export const silentLog = () => {};

export interface TestDepsOptions {
  env?: Record<string, string>;
  store?: GenerationStore | null;
  provider?: () => AIProvider;
  overrides?: DepsOverrides;
}

export function testDeps(options: TestDepsOptions = {}): ServerDeps & { store: GenerationStore | null } {
  const deps = createServerDeps(
    // Détection automatique de l'IA locale coupée : sinon un vrai Ollama en marche sur le poste du développeur
    // (127.0.0.1:11434) serait détecté et fausserait les tests « IA non configurée » (constaté avec un vrai Ollama).
    // Les tests de la détection (tests/server/localAI.test.ts) utilisent createServerDeps avec de faux serveurs.
    { RATE_LIMIT_PER_MINUTE: '1000', AI_AUTODETECT: 'false', ...options.env },
    {
      verifier: fakeVerifier,
      store: options.store === undefined ? new MemoryStore() : options.store,
      providerFactory: options.provider ?? (() => new MockProvider({ reply: '# Cours\n\nContenu simulé du cours sur les graphes.' })),
      research: {
        config: { academic: false, wikipedia: false, timeoutMs: 1_000 },
        deps: { fetch: () => Promise.reject(new Error('réseau interdit pendant les tests')) },
      },
      log: silentLog,
      ...options.overrides,
    },
  );
  // Nouveaux essais automatiques du serveur d'IA sans attente pendant les tests.
  deps.config.ai.retryDelaysMs = [0, 0];
  return deps;
}

export interface TestServer {
  url: string;
  close(): Promise<void>;
}

export async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function startApi(deps: ServerDeps): Promise<TestServer> {
  return listen((req, res) => {
    void handleNodeRequest(req, res, { deps });
  });
}

/** Appel de l'API avec un jeton (ou sans). */
export function call(base: string, path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

export const validRequest = {
  type: 'cours',
  niveau: 'licence_1',
  matiere: 'informatique',
  sujet: 'Les graphes orientés',
  researchMode: 'documents',
};

export async function readNdjson(res: Response): Promise<GenerationEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as GenerationEvent);
}

/** Génère un contenu pour un utilisateur et renvoie son identifiant. */
export async function generateAs(base: string, token: string, body: Record<string, unknown> = validRequest): Promise<string> {
  const res = await call(base, '/api/generate', token, { method: 'POST', body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`génération refusée : ${res.status} ${await res.text()}`);
  const events = await readNdjson(res);
  const done = events.find(e => e.type === 'done');
  if (!done || done.type !== 'done' || !done.id) throw new Error(`génération sans identifiant : ${JSON.stringify(events)}`);
  return done.id;
}

export async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition non atteinte à temps');
    await new Promise(r => setTimeout(r, 10));
  }
}
