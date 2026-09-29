// Faux Ollama (fetch simulé : Ollama + GitHub) et fabrique d'AIManager pour les tests de l'IA locale.
// Aucun accès réseau réel. Utilisé par ollamaSetup.test.ts et ollamaEngine.test.ts.

import path from 'node:path';
import type { FetchLike } from '../../shared/ai/provider.js';
import type { AIProgressEvent } from '../../shared/ipc.js';
import { AIConfigStore, type SecretCipher } from '../../electron/aiConfig.js';
import { AIManager, type AIManagerDeps } from '../../electron/ollamaSetup.js';

export const GB = 1024 ** 3;

export const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: s => Buffer.from(s).reverse().toString('base64'),
  decrypt: s => Buffer.from(s, 'base64').reverse().toString(),
};

/** Version récente d'Ollama (≥ 0.13.1, minimum des modèles Magistra). */
export const RECENT_VERSION = '0.34.4';

export interface FakeOllama {
  running: boolean;
  models: string[];
  pullRequests: string[];
  /** Version annoncée par /api/version (défaut : RECENT_VERSION). */
  version?: string;
  /**
   * « hang » : le port accepte la connexion mais le moteur ne répond pas encore (détection des cartes graphiques) ;
   * le délai d'attente est simulé par une erreur TimeoutError immédiate.
   */
  versionMode?: 'hang';
  /** Script du prochain /api/pull. */
  pull?: (model: string, signal?: AbortSignal) => Response;
  /** Corps des /api/chat reçus. */
  chats?: Record<string, unknown>[];
  /** Modèles relayés vers un autre hôte (remote_host de /api/tags : modèle « cloud » ou OLLAMA_REMOTES). */
  remote?: Record<string, string>;
}

export function ndjsonResponse(lines: unknown[], opts: { hangAfter?: number; signal?: AbortSignal } = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.hangAfter !== undefined && i >= opts.hangAfter) {
        return new Promise<void>(resolve => {
          const fail = () => {
            controller.error(new DOMException('Opération annulée', 'AbortError'));
            resolve();
          };
          if (opts.signal?.aborted) fail();
          else opts.signal?.addEventListener('abort', fail, { once: true });
        });
      }
      if (i >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(lines[i++])}\n`));
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

export function pullLines(model: string, from = 0): unknown[] {
  const total = 9_000_000_000;
  const lines: unknown[] = [{ status: 'pulling manifest' }];
  for (let c = from; c <= total; c += total / 20) lines.push({ status: 'pulling aaaa1111', digest: 'sha256:aaaa1111', total, completed: c });
  lines.push({ status: 'pulling bbbb2222', digest: 'sha256:bbbb2222', total: 12_000, completed: 12_000 });
  lines.push({ status: 'verifying sha256 digest' }, { status: 'writing manifest' }, { status: 'success' });
  void model;
  return lines;
}

/** Connexion refusée (moteur arrêté), comme undici. */
export function refused(): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}

export function makeFetch(o: FakeOllama, extra?: (url: string, init?: RequestInit) => Response | undefined): FetchLike {
  return async (input, init) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (!o.running) throw refused();
    const u = new URL(url);
    if (u.pathname === '/api/version') {
      if (o.versionMode === 'hang') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return Response.json({ version: o.version ?? RECENT_VERSION });
    }
    if (u.pathname === '/api/tags') {
      return Response.json({
        models: o.models.map(name => ({ name, size: 9_100_000_000, ...(o.remote?.[name] ? { remote_host: o.remote[name], remote_model: name } : {}) })),
      });
    }
    if (u.pathname === '/api/pull') {
      const model = JSON.parse(String(init?.body)).model as string;
      o.pullRequests.push(model);
      if (o.pull) return o.pull(model, init?.signal ?? undefined);
      return ndjsonResponse(pullLines(model));
    }
    if (u.pathname === '/api/chat') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      (o.chats ??= []).push(body);
      if (!o.models.includes(String(body.model))) return Response.json({ error: `model '${String(body.model)}' not found` }, { status: 404 });
      if (Array.isArray(body.messages) && body.messages.length === 0) {
        return Response.json({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'load' });
      }
      return ndjsonResponse([
        { message: { role: 'assistant', content: 'Bonjour' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 1 },
      ]);
    }
    return new Response('not found', { status: 404 });
  };
}

export const APP_EXE = 'C:\\Users\\prof\\AppData\\Local\\Programs\\Ollama\\ollama app.exe';
export const CLI_EXE = 'C:\\Users\\prof\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
/** Installation « pour toute la machine » par le service informatique. */
export const ADMIN_APP_EXE = 'C:\\Program Files\\Ollama\\ollama app.exe';
export const ADMIN_CLI_EXE = 'C:\\Program Files\\Ollama\\ollama.exe';
export const WINDOWS_ENV: NodeJS.ProcessEnv = {
  LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  Path: 'C:\\Windows\\System32',
};

export interface ManagerOptions {
  ollama: FakeOllama;
  platform?: NodeJS.Platform;
  existing?: string[];
  env?: NodeJS.ProcessEnv;
  freeGB?: number;
  /** Espace libre par dossier (prioritaire sur freeGB). */
  freeBytes?: (dir: string) => number | undefined;
  netFetch?: FetchLike;
  runInstaller?: AIManagerDeps['runInstaller'];
  onSpawn?: (file: string, args: string[], env?: NodeJS.ProcessEnv) => void;
  clock?: () => number;
  sleep?: AIManagerDeps['sleep'];
  resolveProxy?: AIManagerDeps['resolveProxy'];
  killProcesses?: AIManagerDeps['killProcesses'];
  readFileTail?: AIManagerDeps['readFileTail'];
  /** Remplace les délais du harnais (null : délais réels de l'application). */
  timings?: AIManagerDeps['timings'] | null;
  /** Réponses supplémentaires du faux Ollama (ex. /api/chat). */
  extra?: (url: string, init?: RequestInit) => Response | undefined;
}

/** AIManager branché sur le faux Ollama ; `dir` sert de dossier temporaire et de configuration. */
export async function makeManager(dir: string, opts: ManagerOptions) {
  const events: AIProgressEvent[] = [];
  const detections = { hardware: 0 };
  const spawned: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const opened: string[] = [];
  const config = new AIConfigStore(path.join(dir, 'ai-config.json'), cipher);
  await config.load();
  const existing = new Set(opts.existing ?? []);
  const fetchImpl = makeFetch(opts.ollama, opts.extra);
  const manager = new AIManager({
    config,
    localFetch: fetchImpl,
    netFetch: opts.netFetch ?? fetchImpl,
    platform: opts.platform ?? 'win32',
    env: opts.env ?? { LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local', Path: 'C:\\Windows\\System32' },
    homedir: 'C:\\Users\\prof',
    tmpdir: dir,
    fileExists: async p => existing.has(p),
    spawnDetached: (file, args, env) => {
      spawned.push({ file, args, env });
      opts.onSpawn?.(file, args, env);
    },
    runInstaller: opts.runInstaller ?? (async () => 0),
    openExternal: async url => {
      opened.push(url);
    },
    detectHardware: async () => {
      detections.hardware++;
      return { totalRamGB: 16, cpuCores: 8, gpus: [], freeDiskGB: 120, platform: 'win32' };
    },
    freeDiskBytes: async d => (opts.freeBytes ? opts.freeBytes(d) : (opts.freeGB ?? 120) * GB),
    modelsDir: 'C:\\Users\\prof\\.ollama\\models',
    emit: e => events.push(e),
    ...(opts.clock ? { now: opts.clock } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.resolveProxy ? { resolveProxy: opts.resolveProxy } : {}),
    ...(opts.killProcesses ? { killProcesses: opts.killProcesses } : {}),
    readFileTail: opts.readFileTail ?? (async () => undefined),
    ...(opts.timings === null
      ? {}
      : {
        timings: {
          startPollMs: 1, startTimeoutMs: 200, installWaitMs: 500, installPollMs: 5, watchIntervalMs: 5, watchTimeoutMs: 2_000,
          progressThrottleMs: 250, outdatedGraceMs: 50, stopTimeoutMs: 50, installSettleMs: 0, ...opts.timings,
        },
      }),
  });
  return { manager, events, spawned, opened, config, detections, existing };
}
