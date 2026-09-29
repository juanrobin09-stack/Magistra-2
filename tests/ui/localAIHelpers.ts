// Faux pont de l'application Windows (window.magistra) pour les tests de l'activation de l'IA : état de l'IA modifiable
// (installer le moteur le met en marche, télécharger un niveau l'installe), actions espionnées, téléchargements que le
// test peut suspendre, faire échouer ou faire progresser (évènements ai.onProgress), préférences en mémoire.
// Fidèle au processus principal là où cela compte : un seul téléchargement à la fois (AI_BUSY), annulation sans effet
// tant qu'aucun téléchargement n'est parti (pullAbort encore nul), démarrage refusé pendant une installation.

import { vi } from 'vitest';
import type { TierId } from '@shared/ai/models';
import { DEFAULT_PREFERENCES, type AIProgressEvent, type AIStatus, type LocalPreferences, type MagistraBridge } from '@shared/ipc';
import type { Capabilities, GenerationEvent, TeacherProfile } from '@shared/types';
import { makeStatus, type StatusOptions } from '../ai-ui/fixtures';

export interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(err: Error): void;
}

/** Téléchargement ou installation suspendu jusqu'à resolve() (ou reject(), comme une annulation). */
export function hold(): Deferred {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Rejet (annulation) : traité par l'action elle-même, jamais « non géré ».
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** Erreur telle que le pont IPC la transmet (« CODE|message »). */
export function ipcError(code: string, message: string): Error {
  return new Error(`Error invoking remote method: ${code}|${message}`);
}

export interface FakeLocalAI {
  bridge: MagistraBridge;
  /** Options de l'état courant de l'IA (modifiées par les actions). */
  options: StatusOptions;
  status(): AIStatus;
  prefs: LocalPreferences;
  /** Émet un évènement de progression vers l'interface. */
  emit(event: AIProgressEvent): void;
  /** Téléchargement de modèle suspendu (null : les téléchargements se terminent aussitôt). */
  holdPull: Deferred | null;
  /** Installation du moteur suspendue. */
  holdEngine: Deferred | null;
  /** Changement de configuration suspendu (le processus principal relit alors tout l'état). */
  holdConfig: Deferred | null;
  /** Écriture des préférences suspendue (disque lent, antivirus). */
  holdPrefs: Deferred | null;
  /** Prochaine installation du moteur / prochain téléchargement : erreur renvoyée. */
  engineFailure: Error | null;
  pullFailure: Error | null;
  /** Ordre des appels significatifs (préférences, installation, téléchargement…). */
  log: string[];
  spies: {
    installEngine: ReturnType<typeof vi.fn>;
    pullModel: ReturnType<typeof vi.fn>;
    cancelPull: ReturnType<typeof vi.fn>;
    cancelEngineInstall: ReturnType<typeof vi.fn>;
    startEngine: ReturnType<typeof vi.fn>;
    openEngineDownload: ReturnType<typeof vi.fn>;
    setConfig: ReturnType<typeof vi.fn>;
    prefsSet: ReturnType<typeof vi.fn>;
    generationStart: ReturnType<typeof vi.fn>;
  };
}

export function installFakeLocalAI(initial: StatusOptions, prefs: Partial<LocalPreferences> = {}, profile: TeacherProfile | null = null): FakeLocalAI {
  const listeners = new Set<(event: AIProgressEvent) => void>();
  const genListeners = new Set<(payload: { jobId: string; event: GenerationEvent }) => void>();
  const fake = {
    options: { ...initial },
    prefs: { ...DEFAULT_PREFERENCES, ...prefs },
    holdPull: null,
    holdEngine: null,
    holdConfig: null,
    holdPrefs: null,
    engineFailure: null,
    pullFailure: null,
    log: [],
  } as unknown as FakeLocalAI;
  fake.status = () => makeStatus(fake.options);
  fake.emit = event => {
    for (const l of listeners) l(event);
  };

  const installEngine = vi.fn(async () => {
    fake.log.push('installEngine');
    fake.emit({ kind: 'engine-download', receivedMB: 400, totalMB: 1700 });
    if (fake.holdEngine) await fake.holdEngine.promise;
    if (fake.engineFailure) {
      const err = fake.engineFailure;
      fake.engineFailure = null;
      fake.emit({ kind: 'engine-error', message: 'échec' });
      throw err;
    }
    fake.options = { ...fake.options, engine: 'running', outdated: undefined };
    fake.emit({ kind: 'engine-ready', version: '0.34.4' });
  });
  // Processus principal : un seul téléchargement à la fois (AI_BUSY), comme OllamaSetup.pullModel.
  let pulling = false;
  const pullModel = vi.fn(async (target: { tier?: TierId }) => {
    fake.log.push(`pullModel:${target.tier}`);
    if (pulling) throw ipcError('AI_BUSY', 'Un téléchargement de modèle est déjà en cours.');
    pulling = true;
    try {
      const model = makeStatus(fake.options).tiers.find(t => t.id === target.tier)?.model ?? 'modele';
      fake.emit({ kind: 'model-pull', tier: target.tier, model, status: 'pulling', completedMB: 2048, totalMB: 9216 });
      if (fake.holdPull) await fake.holdPull.promise;
      if (fake.pullFailure) {
        const err = fake.pullFailure;
        fake.pullFailure = null;
        throw err;
      }
      fake.options = { ...fake.options, installed: [...new Set([...(fake.options.installed ?? []), target.tier!])] };
      fake.emit({ kind: 'model-ready', model });
    } finally {
      pulling = false;
    }
  });
  // Comme OllamaSetup.cancelPull (`this.pullAbort?.abort()`) : sans effet tant qu'aucun téléchargement n'est parti.
  const cancelPull = vi.fn(async () => {
    fake.log.push('cancelPull');
    if (pulling) fake.holdPull?.reject(ipcError('GENERATION_ABORTED', 'Téléchargement mis en pause.'));
  });
  const cancelEngineInstall = vi.fn(async () => {
    fake.log.push('cancelEngineInstall');
    fake.holdEngine?.reject(ipcError('GENERATION_ABORTED', 'Installation annulée.'));
  });
  // Comme OllamaSetup.startEngineOrExplain : refusé pendant une installation du moteur (AI_BUSY).
  const startEngine = vi.fn(async () => {
    fake.log.push('startEngine');
    if (fake.options.installing) throw ipcError('AI_BUSY', 'L’installation du moteur IA est déjà en cours.');
    fake.options = { ...fake.options, engine: 'running' };
    return true;
  });
  const openEngineDownload = vi.fn(async () => {
    fake.log.push('openEngineDownload');
  });
  const setConfig = vi.fn(async (update: { tier?: TierId; customModel?: string | null }) => {
    if (fake.holdConfig) await fake.holdConfig.promise;
    if (update.tier) fake.options = { ...fake.options, selectedTier: update.tier };
    if (update.customModel === null) fake.options = { ...fake.options, customModel: undefined };
    return fake.status();
  });
  // Comme LocalStore.setPreferences (écriture sous verrou) : les écritures se font dans l'ordre des appels.
  let prefsQueue: Promise<unknown> = Promise.resolve();
  const prefsSet = vi.fn((update: Partial<LocalPreferences>) => {
    fake.log.push(`prefs:${JSON.stringify(update)}`);
    const write = prefsQueue.then(async () => {
      if (fake.holdPrefs) await fake.holdPrefs.promise;
      fake.prefs = { ...fake.prefs, ...update };
      return { ...fake.prefs };
    });
    prefsQueue = write.catch(() => undefined);
    return write;
  });
  const generationStart = vi.fn(async () => ({ jobId: 'job-1' }));
  fake.spies = { installEngine, pullModel, cancelPull, cancelEngineInstall, startEngine, openEngineDownload, setConfig, prefsSet, generationStart };

  const caps = (): Capabilities => ({
    maxDocumentChars: 30_000,
    research: { academic: true, web: false, institutional: false, wikipedia: true },
    privacy: { level: 'local', message: 'Vos contenus restent sur cet ordinateur.' },
    engineLabel: 'Magistra Standard',
    ready: fake.status().ready,
    ...(fake.status().ready ? {} : { notReady: { code: 'MODEL_NOT_INSTALLED' as const, message: 'Modèle non installé.' } }),
  });

  fake.bridge = {
    isElectron: true,
    app: {
      info: vi.fn(async () => ({ version: '2.0.0', platform: 'win32', userDataPath: 'C:\\Magistra', isPackaged: true })),
      ready: vi.fn(),
      openExternal: vi.fn(async () => true),
      checkForUpdate: vi.fn(),
    },
    ai: {
      status: vi.fn(async () => fake.status()),
      refresh: vi.fn(async () => fake.status()),
      installEngine,
      cancelEngineInstall,
      openEngineDownload,
      startEngine,
      pullModel,
      cancelPull,
      setConfig,
      onProgress: vi.fn((listener: (event: AIProgressEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
    generation: {
      capabilities: vi.fn(async () => caps()),
      start: generationStart,
      cancel: vi.fn(async () => undefined),
      onEvent: vi.fn((listener: (payload: { jobId: string; event: GenerationEvent }) => void) => {
        genListeners.add(listener);
        return () => genListeners.delete(listener);
      }),
    },
    data: {
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(async () => null),
      setFavorite: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      stats: vi.fn(async () => ({ total: 0, today: 0, week: 0, favorites: 0 })),
      clearAll: vi.fn(async () => undefined),
    },
    profile: {
      get: vi.fn(async () => profile),
      set: vi.fn(async (p: TeacherProfile | null) => {
        profile = p;
      }),
    },
    prefs: {
      get: vi.fn(async () => ({ ...fake.prefs })),
      set: prefsSet,
    },
    documents: {
      list: vi.fn(async () => []),
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    connector: {
      status: vi.fn(async () => ({ enabled: false, listening: false, persistent: true, clients: [] })),
      revoke: vi.fn(),
      setEnabled: vi.fn(),
      onChange: vi.fn(() => () => undefined),
    },
  } as unknown as MagistraBridge;
  (window as unknown as { magistra?: MagistraBridge }).magistra = fake.bridge;
  return fake;
}

export function removeFakeLocalAI(): void {
  delete (window as unknown as { magistra?: unknown }).magistra;
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
}
