// Outils des tests d'interface de Magistra locale (site web → application Windows) : faux contrôleur dont l'état est
// fixé par le test (chaque état de LocalEngineStateKind), faux serveur en ligne, montage d'une page du site web avec
// le client hybride RÉEL (src/lib/runtime/hybrid.ts) et le contexte de Magistra locale.

import { act, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ConnectorStatus } from '@shared/localConnector';
import type { Capabilities, GenerationEvent, GenerationRecordDraft, GenerationRequest, ProviderInfo } from '@shared/types';
import type { LocalConnectorClient } from '@/lib/localConnector/client';
import { LocalEngineContext, type LocalEngineController, type LocalEngineState } from '@/lib/localConnector/controller';
import { resetEngineChoiceMemory } from '@/lib/localConnector/engineChoice';
import type { LoopbackPermission } from '@/lib/localConnector/permission';
import { RuntimeContext } from '@/lib/runtime/context';
import { HybridGenerationClient } from '@/lib/runtime/hybrid';
import type { GenerationClient, RuntimeMode } from '@/lib/runtime/types';
import { fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

export const READY_STATUS: ConnectorStatus = {
  version: '2.1.0',
  engine: { ready: true, local: true, label: 'Magistra Standard' },
  capabilities: { maxDocumentChars: 30_000, research: { academic: true, web: false, institutional: false, wikipedia: true } },
  busy: false,
};

export const OVH_INFO: ProviderInfo = {
  label: 'OVHcloud AI Endpoints', thirdParty: true, country: 'France (centre de données de Gravelines)',
  privacyUrl: 'https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities',
};

export const SERVER_CAPS: Capabilities = {
  maxDocumentChars: 20_000,
  research: { academic: true, web: true, institutional: true, wikipedia: true },
  privacy: { level: 'server', message: 'Les demandes et les extraits de vos documents sont envoyés à « OVHcloud AI Endpoints » pour la génération.' },
  engineLabel: 'OVHcloud AI Endpoints',
  ready: true,
  providerInfo: OVH_INFO,
};

/**
 * Tout ce qui ne doit JAMAIS apparaître à propos de Magistra locale (le site web) : adresse, port, nom du moteur.
 * Les deux textes sur la fenêtre d'Ollama (installation de l'IA, application Windows) nomment le moteur, et le site ne
 * les affiche jamais : l'expression reste donc sans exception ici ; la règle « seuls ces textes nomment Ollama » est
 * contrôlée dans tests/ui/engineWindowNote.test.ts.
 */
export const FORBIDDEN_LOCAL_TEXT = /localhost|127\.0\.0\.1|ollama|:4783\d|11434/i;

export function engineState(kind: LocalEngineState['kind'], extra: Partial<LocalEngineState> = {}): LocalEngineState {
  const paired = extra.paired ?? (kind === 'connected' || kind === 'app-closed');
  const permission: LoopbackPermission = extra.permission ?? 'granted';
  const state: LocalEngineState = { kind, paired, permission, ...extra };
  if (kind === 'connected' && !state.status) state.status = structuredClone(READY_STATUS);
  return state;
}

type GenerateImpl = (request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal) => Promise<void>;

/**
 * Faux contrôleur : l'état est celui que fixe le test ; les actions sont des espions. `paired` (magasin de
 * l'appairage) peut différer de l'état, comme après un changement fait dans un autre onglet.
 */
export class FakeEngine implements LocalEngineController {
  state: LocalEngineState;
  paired: boolean;
  private readonly listeners = new Set<() => void>();
  readonly localGenerate = vi.fn<GenerateImpl>(async (_request, onEvent) => {
    onEvent({ type: 'error', code: 'CONNECTOR_UNREACHABLE', message: "Magistra n'est pas joignable sur cet ordinateur : ouvrez l'application Magistra, puis réessayez.", retryable: true });
  });
  readonly client: LocalConnectorClient;
  readonly autoCheck = vi.fn(async () => undefined);
  readonly detect = vi.fn(async () => undefined);
  readonly connect = vi.fn(async () => undefined);
  readonly cancelPairing = vi.fn(() => undefined);
  readonly openApp = vi.fn(async () => undefined);
  readonly disconnect = vi.fn(async () => undefined);
  readonly refresh = vi.fn(async () => undefined);

  constructor(state: LocalEngineState) {
    this.state = state;
    this.paired = state.paired;
    const fake = {
      hasPairing: async () => this.paired,
      generate: (request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal) => this.localGenerate(request, onEvent, signal),
    };
    this.client = fake as unknown as LocalConnectorClient;
  }

  readonly getSnapshot = (): LocalEngineState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Nouvel état publié (magasin de l'appairage mis à jour en même temps). */
  async set(next: LocalEngineState): Promise<void> {
    await act(async () => {
      this.state = next;
      this.paired = next.paired;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

export function fakeServer(caps: Capabilities = SERVER_CAPS) {
  const server = {
    kind: 'web' as const,
    capabilities: vi.fn(async () => caps),
    generate: vi.fn<GenerateImpl>(async (_request, onEvent) => {
      onEvent({ type: 'done', content: 'Contenu du serveur', sources: [], truncated: false, internetUsed: false, saved: true, id: 'srv-1', model: 'm' });
    }),
  } satisfies GenerationClient;
  return server;
}

/** Choix du moteur oublié (localStorage et mémoire) entre deux tests. */
export function resetEngineChoice(): void {
  try {
    localStorage.clear();
  } catch {
    // stockage indisponible : rien à effacer
  }
  resetEngineChoiceMemory();
}

export interface WebMount<E extends LocalEngineController = FakeEngine> {
  engine: E;
  server: ReturnType<typeof fakeServer>;
  saveDraft: ReturnType<typeof vi.fn<(draft: GenerationRecordDraft) => Promise<{ id: string }>>>;
  client: HybridGenerationClient;
}

/**
 * Monte `ui` comme sur le site web (enseignant connecté) : client hybride réel, contrôleur fourni par le contexte
 * (faux contrôleur, ou le vrai face à un faux connecteur).
 */
export async function mountWeb<E extends LocalEngineController = FakeEngine>(
  ui: ReactNode, engine: E, options: { server?: ReturnType<typeof fakeServer>; mode?: RuntimeMode; path?: string } = {},
) {
  const server = options.server ?? fakeServer();
  const saveDraft = vi.fn(async (_draft: GenerationRecordDraft) => ({ id: 'local-1' }));
  const client = new HybridGenerationClient(server, engine, saveDraft);
  const store = new MemoryStore([], PROFILE_COLLEGE);
  const runtime = fakeRuntime(store, { mode: options.mode ?? 'web', client, profile: PROFILE_COLLEGE });
  const view = await render(
    <RuntimeContext.Provider value={runtime}>
      <LocalEngineContext.Provider value={engine}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>{ui}</MemoryRouter>
      </LocalEngineContext.Provider>
    </RuntimeContext.Provider>,
  );
  await flush(6);
  const mount: WebMount<E> = { engine, server, saveDraft, client };
  return { ...view, ...mount };
}

/** Réponse JSON d'un faux fetch. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export const RELEASE = {
  available: true,
  version: '2.3.1',
  fileName: 'Magistra-Setup-2.3.1.exe',
  downloadUrl: 'https://github.com/juanrobin09-stack/magistra-2/releases/download/v2.3.1/Magistra-Setup-2.3.1.exe',
  sizeBytes: 89_443_942,
  sha256: 'a3f5c0e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6',
  publishedAt: '2026-09-15T12:00:00Z',
  releaseUrl: 'https://github.com/juanrobin09-stack/magistra-2/releases/tag/v2.3.1',
  requirements: 'Windows 10 ou 11 (64 bits)',
} as const;

/** Faux fetch global : GET /api/windows-release → `body` (ou une erreur réseau). */
export function stubReleaseFetch(body: unknown | Error, status = 200) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== '/api/windows-release') throw new TypeError(`requête inattendue : ${String(input)}`);
    if (body instanceof Error) throw body;
    return jsonResponse(body, status);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
