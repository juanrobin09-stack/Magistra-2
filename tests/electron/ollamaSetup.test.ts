// IA locale : détection d'Ollama, démarrage, état agrégé, installation du moteur (Windows) et des modèles,
// avec un fetch simulé (Ollama + GitHub). Aucun accès réseau réel.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../shared/ai/provider.js';
import type { AIProgressEvent } from '../../shared/ipc.js';
import { AIConfigStore, type SecretCipher } from '../../electron/aiConfig.js';
import {
  AIManager, INSTALLER_ARGS, INSTALLER_MISMATCH_MESSAGE, INSTALLER_UNVERIFIABLE_MESSAGE, LIGHTEST_OUT_OF_MEMORY_MESSAGE, OLLAMA_DOWNLOAD_PAGE,
  PRIVACY_LOCAL_MESSAGE, PullAggregator, noRedirects, parseSha256Sums, type AIManagerDeps,
} from '../../electron/ollamaSetup.js';

const GB = 1024 ** 3;
const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: s => Buffer.from(s).reverse().toString('base64'),
  decrypt: s => Buffer.from(s, 'base64').reverse().toString(),
};

// ─── Faux Ollama ────────────────────────────────────────────────────────────

interface FakeOllama {
  running: boolean;
  models: string[];
  pullRequests: string[];
  /** Script du prochain /api/pull. */
  pull?: (model: string, signal?: AbortSignal) => Response;
}

function ndjsonResponse(lines: unknown[], opts: { hangAfter?: number; signal?: AbortSignal } = {}): Response {
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

function pullLines(model: string, from = 0): unknown[] {
  const total = 9_000_000_000;
  const lines: unknown[] = [{ status: 'pulling manifest' }];
  for (let c = from; c <= total; c += total / 20) lines.push({ status: 'pulling aaaa1111', digest: 'sha256:aaaa1111', total, completed: c });
  lines.push({ status: 'pulling bbbb2222', digest: 'sha256:bbbb2222', total: 12_000, completed: 12_000 });
  lines.push({ status: 'verifying sha256 digest' }, { status: 'writing manifest' }, { status: 'success' });
  void model;
  return lines;
}

function makeFetch(o: FakeOllama, extra?: (url: string, init?: RequestInit) => Response | undefined): FetchLike {
  return async (input, init) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (!o.running) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const u = new URL(url);
    if (u.pathname === '/api/version') return Response.json({ version: '0.12.3' });
    if (u.pathname === '/api/tags') return Response.json({ models: o.models.map(name => ({ name, size: 9_100_000_000 })) });
    if (u.pathname === '/api/pull') {
      const model = JSON.parse(String(init?.body)).model as string;
      o.pullRequests.push(model);
      if (o.pull) return o.pull(model, init?.signal ?? undefined);
      return ndjsonResponse(pullLines(model));
    }
    return new Response('not found', { status: 404 });
  };
}

// ─── Fabrique du gestionnaire ───────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-ollama-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function makeManager(opts: {
  ollama: FakeOllama;
  platform?: NodeJS.Platform;
  existing?: string[];
  env?: NodeJS.ProcessEnv;
  freeGB?: number;
  netFetch?: FetchLike;
  runInstaller?: AIManagerDeps['runInstaller'];
  onSpawn?: (file: string, args: string[]) => void;
  clock?: () => number;
  /** Réponses supplémentaires du faux Ollama (ex. /api/chat). */
  extra?: (url: string, init?: RequestInit) => Response | undefined;
}) {
  const events: AIProgressEvent[] = [];
  const detections = { hardware: 0 };
  const spawned: { file: string; args: string[] }[] = [];
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
    spawnDetached: (file, args) => {
      spawned.push({ file, args });
      opts.onSpawn?.(file, args);
    },
    runInstaller: opts.runInstaller ?? (async () => 0),
    openExternal: async url => {
      opened.push(url);
    },
    detectHardware: async () => {
      detections.hardware++;
      return { totalRamGB: 16, cpuCores: 8, gpus: [], freeDiskGB: 120, platform: 'win32' };
    },
    freeDiskBytes: async () => (opts.freeGB ?? 120) * GB,
    modelsDir: 'C:\\Users\\prof\\.ollama\\models',
    emit: e => events.push(e),
    ...(opts.clock ? { now: opts.clock } : {}),
    timings: { startPollMs: 1, startTimeoutMs: 200, installWaitMs: 500, installPollMs: 5, watchIntervalMs: 5, watchTimeoutMs: 2_000, progressThrottleMs: 250 },
  });
  return { manager, events, spawned, opened, config, detections };
}

const APP_EXE = 'C:\\Users\\prof\\AppData\\Local\\Programs\\Ollama\\ollama app.exe';
const CLI_EXE = 'C:\\Users\\prof\\AppData\\Local\\Programs\\Ollama\\ollama.exe';

// ─── Détection et état ──────────────────────────────────────────────────────

describe('détection du moteur', () => {
  it('non installé / installé mais arrêté / en marche', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    expect((await (await makeManager({ ollama })).manager.engineState()).state).toBe('not_installed');
    const { manager } = await makeManager({ ollama, existing: [APP_EXE, CLI_EXE] });
    expect(await manager.engineState()).toEqual({ state: 'installed_stopped', executable: APP_EXE });
    ollama.running = true;
    expect(await manager.engineState()).toMatchObject({ state: 'running', version: '0.12.3' });
  });

  it('trouve ollama.exe dans le PATH', async () => {
    const { manager } = await makeManager({
      ollama: { running: false, models: [], pullRequests: [] },
      env: { LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local', Path: 'C:\\Outils;"D:\\IA\\bin"' },
      existing: ['D:\\IA\\bin\\ollama.exe'],
    });
    expect(await manager.detectExecutable()).toEqual({ cli: 'D:\\IA\\bin\\ollama.exe' });
  });

  it('Linux : ollama dans le PATH ; macOS : Ollama.app', async () => {
    const linux = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, platform: 'linux', env: { PATH: '/usr/bin:/opt/ollama/bin' }, existing: ['/opt/ollama/bin/ollama'] });
    expect(await linux.manager.detectExecutable()).toEqual({ cli: '/opt/ollama/bin/ollama' });
    const mac = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, platform: 'darwin', env: { PATH: '/usr/bin' }, existing: ['/Applications/Ollama.app', '/Applications/Ollama.app/Contents/Resources/ollama'] });
    expect(await mac.manager.detectExecutable()).toEqual({ app: '/Applications/Ollama.app', cli: '/Applications/Ollama.app/Contents/Resources/ollama' });
  });

  it('démarre automatiquement « ollama app.exe » (sans fenêtre) quand il est arrêté', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, spawned } = await makeManager({ ollama, existing: [APP_EXE, CLI_EXE], onSpawn: () => { ollama.running = true; } });
    await manager.autoStart();
    expect(spawned).toEqual([{ file: APP_EXE, args: [] }]);
    expect(ollama.running).toBe(true);
  });

  it('ailleurs que sous Windows : « ollama serve »', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, spawned } = await makeManager({ ollama, platform: 'linux', env: { PATH: '/usr/local/bin' }, existing: ['/usr/local/bin/ollama'], onSpawn: () => { ollama.running = true; } });
    expect(await manager.startEngine()).toBe(true);
    expect(spawned).toEqual([{ file: '/usr/local/bin/ollama', args: ['serve'] }]);
  });
});

describe('état agrégé (ai:status)', () => {
  it('titres en français selon la situation', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, config } = await makeManager({ ollama, existing: [] });
    let status = await manager.status();
    expect(status.headline).toBe('Moteur IA non installé');
    expect(status.engineDownload).toMatchObject({ approxSizeMB: 1200, requiredDiskGB: 5, platformSupported: true });
    // Premier démarrage : le niveau recommandé (16 Go → Standard) est retenu.
    expect(status.selectedTier).toBe('standard');
    expect(config.get().tier).toBe('standard');

    const stopped = await makeManager({ ollama, existing: [APP_EXE] });
    expect((await stopped.manager.status()).headline).toBe('Moteur IA arrêté');

    ollama.running = true;
    status = await manager.status();
    expect(status.headline).toBe('Modèle Magistra Standard non installé');
    expect(status.ready).toBe(false);

    ollama.models = ['ministral-3:14b'];
    status = await manager.status();
    expect(status).toMatchObject({ headline: 'Prête', ready: true, activeModel: 'ministral-3:14b', activeLabel: 'Magistra Standard' });
    expect(status.tiers.map(t => [t.id, t.installed, t.fit])).toEqual([
      ['leger', false, 'ok'],
      ['standard', true, 'recommended'],
      ['qualite', false, 'not_recommended'],
    ]);
    expect(status.installedModels).toEqual([{ name: 'ministral-3:14b', sizeGB: 9.1 }]);
  });

  it('affiche la taille réelle de l’installateur (API GitHub) quand elle est joignable', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const github = makeFetch(ollama, url => url.startsWith('https://api.github.com/')
      ? Response.json({ tag_name: 'v0.12.3', assets: [{ name: 'OllamaSetup.exe', size: 1_300 * 1024 * 1024, browser_download_url: 'https://github.com/ollama/ollama/releases/download/v0.12.3/OllamaSetup.exe' }] })
      : undefined);
    const { manager } = await makeManager({ ollama, netFetch: github });
    expect((await manager.status()).engineDownload.sizeMB).toBe(1300);
  });

  it('la clé API d’un serveur distant ne figure jamais dans l’état renvoyé', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const remoteFetch: FetchLike = async url => (String(url).endsWith('/models') ? Response.json({ data: [{ id: 'mistral-small' }] }) : new Response('', { status: 404 }));
    const { manager } = await makeManager({ ollama, netFetch: remoteFetch });
    const status = await manager.setConfig({
      mode: 'remote',
      remote: { kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'mistral-small', apiKey: 'sk-SECRET-123456', label: 'Serveur de l’université' },
    });
    expect(JSON.stringify(status)).not.toContain('sk-SECRET-123456');
    expect(status.config.remote?.hasApiKey).toBe(true);
    expect(status).toMatchObject({ ready: true, headline: 'Prête', activeLabel: 'Serveur de l’université' });
    const active = await manager.describeActive();
    expect(active.privacy).toEqual({ level: 'remote', message: 'Les données utilisées pour la génération seront transmises au serveur IA configuré (Serveur de l’université).' });
  });

  it('confidentialité : IA locale sur 127.0.0.1', async () => {
    const { manager } = await makeManager({ ollama: { running: true, models: ['ministral-3:14b'], pullRequests: [] } });
    expect(await manager.describeActive()).toEqual({
      label: 'Magistra Standard', contextTokens: 12_288, ready: true, privacy: { level: 'local', message: PRIVACY_LOCAL_MESSAGE },
    });
  });
});

// ─── Modèles ────────────────────────────────────────────────────────────────

describe('nouvelle vérification (ai:refresh)', () => {
  it('relit le moteur à chaque fois, mais la machine et l’installateur au plus une fois par minute', async () => {
    let clock = 1_000_000;
    const releaseCalls: string[] = [];
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const netFetch: FetchLike = async input => {
      releaseCalls.push(String(input));
      return Response.json({ tag_name: 'v0.12.3', assets: [] });
    };
    const { manager, detections } = await makeManager({ ollama, netFetch, clock: () => clock });
    expect((await manager.status()).engine.state).toBe('not_installed');
    expect(detections.hardware).toBe(1);
    const githubAfterStatus = releaseCalls.length;

    // Rafraîchissements rapprochés (retour dans la fenêtre, attente d'installation) : pas de nouvelle détection…
    ollama.running = true;
    for (let i = 0; i < 5; i++) {
      clock += 5_000;
      await manager.refresh();
    }
    expect(detections.hardware).toBe(1);
    expect(releaseCalls.length).toBe(githubAfterStatus);
    // … mais le moteur démarré entre-temps est bien vu.
    expect((await manager.refresh()).engine.state).toBe('running');

    // Une minute plus tard : nouvelle détection complète.
    clock += 60_000;
    await manager.refresh();
    expect(detections.hardware).toBe(2);
  });
});

describe('installation d’un modèle (ai:pull-model)', () => {
  it('progression agrégée, monotone et limitée en fréquence, puis model-ready', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const { manager, events } = await makeManager({ ollama, clock: () => 1_000 }); // horloge figée : seul un changement d'étape passe
    await manager.pullModel({ tier: 'standard' });
    expect(ollama.pullRequests).toEqual(['ministral-3:14b']);
    const pulls = events.filter((e): e is Extract<AIProgressEvent, { kind: 'model-pull' }> => e.kind === 'model-pull');
    expect(pulls.map(p => p.status)).toEqual([
      'Préparation du téléchargement…',
      'Préparation du téléchargement…',
      'Téléchargement du modèle…',
      'Vérification de l’intégrité…',
      'Finalisation de l’installation…',
      'Modèle installé',
    ]);
    expect(pulls.every(p => p.tier === 'standard' && p.model === 'ministral-3:14b')).toBe(true);
    expect(pulls.at(-1)?.percent).toBe(100);
    expect(events.at(-1)).toEqual({ kind: 'model-ready', model: 'ministral-3:14b' });
  });

  it('agrégateur : pourcentage global en Mo sur toutes les couches', () => {
    const agg = new PullAggregator();
    expect(agg.update({ status: 'pulling a', digest: 'a', total: 1000 * 1024 * 1024, completed: 500 * 1024 * 1024 })).toEqual({ status: 'Téléchargement du modèle…', completedMB: 500, totalMB: 1000, percent: 50 });
    // Une nouvelle couche augmente le total : le pourcentage affiché ne recule pas.
    expect(agg.update({ status: 'pulling b', digest: 'b', total: 1000 * 1024 * 1024, completed: 0 }).percent).toBe(50);
    expect(agg.update({ status: 'success' }).percent).toBe(100);
  });

  it('annulation puis reprise là où le téléchargement s’était arrêté', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const { manager, events } = await makeManager({ ollama });
    ollama.pull = (model, signal) => ndjsonResponse(pullLines(model), { hangAfter: 6, signal });
    const pending = manager.pullModel({ tier: 'leger' });
    await new Promise(r => setTimeout(r, 30));
    manager.cancelPull();
    await expect(pending).rejects.toMatchObject({ code: 'GENERATION_ABORTED', message: expect.stringContaining('reprendra') });
    expect(events.at(-1)).toMatchObject({ kind: 'model-error', model: 'ministral-3:8b', message: expect.stringContaining('reprendra') });

    ollama.pull = model => ndjsonResponse(pullLines(model, 4_500_000_000));
    events.length = 0;
    await manager.pullModel({ tier: 'leger' });
    expect(events[0]).toMatchObject({ kind: 'model-pull', status: 'Reprise du téléchargement…' });
    expect(events.at(-1)).toEqual({ kind: 'model-ready', model: 'ministral-3:8b' });
  });

  it('modèle introuvable : message clair en français', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    ollama.pull = () => ndjsonResponse([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]);
    const { manager, events } = await makeManager({ ollama });
    await expect(manager.pullModel({ model: 'modele-inexistant:7b' })).rejects.toMatchObject({ message: expect.stringContaining('introuvable') });
    expect(events.at(-1)).toMatchObject({ kind: 'model-error', message: expect.stringContaining('introuvable') });
  });

  it('espace disque insuffisant : refus avant tout téléchargement', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const { manager } = await makeManager({ ollama, freeGB: 4 });
    await expect(manager.pullModel({ tier: 'qualite' })).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      message: expect.stringMatching(/Espace disque insuffisant pour installer Magistra Qualité : environ 16 Go nécessaires, 4 Go disponibles/),
    });
    expect(ollama.pullRequests).toEqual([]);
  });

  it('moteur arrêté et non installé : erreur claire', async () => {
    const { manager } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] } });
    await expect(manager.pullModel({ tier: 'leger' })).rejects.toMatchObject({ code: 'ENGINE_NOT_RUNNING' });
  });

  it('un seul téléchargement à la fois', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    ollama.pull = (model, signal) => ndjsonResponse(pullLines(model), { hangAfter: 2, signal });
    const { manager } = await makeManager({ ollama });
    const first = manager.pullModel({ tier: 'leger' });
    await new Promise(r => setTimeout(r, 10));
    await expect(manager.pullModel({ tier: 'standard' })).rejects.toMatchObject({ code: 'AI_BUSY' });
    manager.cancelPull();
    await expect(first).rejects.toMatchObject({ code: 'GENERATION_ABORTED' });
  });
});

describe('fournisseur de génération', () => {
  it('local : erreurs claires puis fournisseur Ollama avec le contexte du niveau', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, config } = await makeManager({ ollama });
    await expect(manager.resolveProvider()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED' });
    ollama.running = true;
    await expect(manager.resolveProvider()).rejects.toMatchObject({ code: 'MODEL_NOT_INSTALLED', message: expect.stringContaining('Magistra Standard') });
    ollama.models = ['mistral-small3.2:24b'];
    await config.update({ tier: 'qualite' });
    const provider = await manager.resolveProvider();
    expect(provider).toMatchObject({ kind: 'ollama', model: 'mistral-small3.2:24b', label: 'Magistra Qualité', contextTokens: 16_384, local: true });
  });

  it('« Arrêter » pendant le démarrage du moteur : arrêt immédiat, le démarrage continue en arrière-plan', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, spawned } = await makeManager({ ollama, existing: [APP_EXE, CLI_EXE] });
    const controller = new AbortController();
    const started = Date.now();
    const pending = manager.resolveProvider(controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: 'GENERATION_ABORTED' });
    // Rejet à l'annulation, sans attendre la fin du délai de démarrage (200 ms ici, 30 s en réel).
    expect(Date.now() - started).toBeLessThan(150);
    expect(spawned.map(s => s.file)).toContain(APP_EXE);
  });

  it('mémoire insuffisante : « Magistra Léger » n’est conseillé qu’à ceux qui ne l’utilisent pas déjà', async () => {
    const ollama: FakeOllama = { running: true, models: ['ministral-3:8b', 'ministral-3:14b'], pullRequests: [] };
    const oom = (url: string) => (url.endsWith('/api/chat')
      ? Response.json({ error: 'model requires more system memory (12.3 GiB) than is available (4.1 GiB)' }, { status: 500 })
      : undefined);
    const { manager, config } = await makeManager({ ollama, extra: oom });
    const generate = async () => (await manager.resolveProvider()).generate({ messages: [{ role: 'user', content: 'Bonjour' }] });

    await config.update({ tier: 'leger' });
    await expect(generate()).rejects.toMatchObject({ code: 'OUT_OF_MEMORY', message: LIGHTEST_OUT_OF_MEMORY_MESSAGE });
    await config.update({ tier: 'standard' });
    await expect(generate()).rejects.toMatchObject({ code: 'OUT_OF_MEMORY', message: expect.stringContaining('Essayez « Magistra Léger »') });
    // Aucun détail technique dans les messages.
    await expect(generate()).rejects.not.toMatchObject({ message: expect.stringContaining('GiB') });
  });
});

// ─── Installation du moteur (Windows) ───────────────────────────────────────

describe('installation du moteur (Windows)', () => {
  const installer = randomBytes(300_000);
  const sha = createHash('sha256').update(installer).digest('hex');
  const SETUP_URL = 'https://github.com/ollama/ollama/releases/download/v0.12.3/OllamaSetup.exe';
  const SUMS_URL = 'https://github.com/ollama/ollama/releases/download/v0.12.3/sha256sum.txt';

  /**
   * Faux GitHub. `sums` : empreinte publiée normalement (par défaut), absente de la version (« missing »),
   * injoignable (« network »), en erreur (« 404 ») ou sans ligne pour OllamaSetup.exe (« no-line »).
   */
  function github(ranges: string[], opts: { badSum?: boolean; sums?: 'missing' | 'network' | '404' | 'no-line' } = {}) {
    return (url: string, init?: RequestInit): Response | undefined => {
      if (url.startsWith('https://api.github.com/')) {
        return Response.json({
          tag_name: 'v0.12.3',
          assets: [
            { name: 'OllamaSetup.exe', size: installer.length, browser_download_url: SETUP_URL },
            ...(opts.sums === 'missing' ? [] : [{ name: 'sha256sum.txt', size: 200, browser_download_url: SUMS_URL }]),
          ],
        });
      }
      if (url === SUMS_URL) {
        if (opts.sums === 'network') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
        if (opts.sums === '404') return new Response('Not Found', { status: 404 });
        if (opts.sums === 'no-line') return new Response(`${'0'.repeat(64)}  ./ollama-linux-amd64.tgz\n`);
        return new Response(`${opts.badSum ? 'f'.repeat(64) : sha}  ./OllamaSetup.exe\n${'0'.repeat(64)}  ./ollama-linux-amd64.tgz\n`);
      }
      if (url === SETUP_URL) {
        const range = new Headers(init?.headers).get('range');
        ranges.push(range ?? '');
        const m = range ? /^bytes=(\d+)-$/.exec(range) : null;
        if (m) {
          const start = Number(m[1]);
          return new Response(installer.subarray(start), {
            status: 206,
            headers: { 'content-range': `bytes ${start}-${installer.length - 1}/${installer.length}`, 'content-length': String(installer.length - start) },
          });
        }
        return new Response(installer, { headers: { 'content-length': String(installer.length) } });
      }
      return undefined;
    };
  }

  it('téléchargement repris (Range), SHA-256 vérifié, installation silencieuse, moteur prêt', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const ranges: string[] = [];
    // Téléchargement précédent interrompu à 100 000 octets.
    mkdirSync(path.join(dir, 'magistra-ollama'), { recursive: true });
    writeFileSync(path.join(dir, 'magistra-ollama', 'OllamaSetup-v0.12.3.exe.part'), installer.subarray(0, 100_000));
    let installed: { args: string[]; sha: string } | null = null;
    const { manager, events } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, github(ranges)),
      runInstaller: async (file, args) => {
        installed = { args, sha: createHash('sha256').update(readFileSync(file)).digest('hex') };
        ollama.running = true;
        return 0;
      },
    });
    await manager.installEngine();
    expect(ranges).toEqual(['bytes=100000-']);
    expect(installed).toEqual({ args: INSTALLER_ARGS, sha });
    expect(INSTALLER_ARGS).toEqual(expect.arrayContaining(['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']));
    const kinds = events.map(e => e.kind);
    expect(kinds[0]).toBe('engine-download');
    expect(kinds).toEqual(expect.arrayContaining(['engine-install', 'engine-waiting']));
    expect(events.at(-1)).toEqual({ kind: 'engine-ready', version: '0.12.3' });
    // L'installateur est supprimé après usage.
    expect(existsSync(path.join(dir, 'magistra-ollama', 'OllamaSetup-v0.12.3.exe'))).toBe(false);
  });

  it('connexion coupée en cours de route : erreur reprenable, puis reprise au bon octet', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const ranges: string[] = [];
    let cut = true;
    const base = github(ranges);
    const flaky = (url: string, init?: RequestInit) => {
      if (url === SETUP_URL && cut) {
        cut = false;
        ranges.push(new Headers(init?.headers).get('range') ?? '');
        // Le serveur annonce 300 000 octets mais la connexion s'arrête à 120 000.
        return new Response(installer.subarray(0, 120_000), { headers: { 'content-length': String(installer.length) } });
      }
      return base(url, init);
    };
    const { manager } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, flaky),
      runInstaller: async () => {
        ollama.running = true;
        return 0;
      },
    });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('reprendra') });
    await manager.installEngine();
    expect(ranges).toEqual(['', 'bytes=120000-']);
  });

  it('moteur déjà installé mais arrêté : démarré, rien n’est téléchargé', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const ranges: string[] = [];
    const { manager, events, spawned } = await makeManager({
      ollama,
      existing: [APP_EXE],
      netFetch: makeFetch(ollama, github(ranges)),
      onSpawn: () => {
        ollama.running = true;
      },
    });
    await manager.installEngine();
    expect(ranges).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect(events).toEqual([{ kind: 'engine-ready', version: '0.12.3' }]);
  });

  it('empreinte SHA-256 incorrecte : fichier supprimé, rien n’est lancé', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    let launched = false;
    const { manager, events } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, github([], { badSum: true })),
      runInstaller: async () => {
        launched = true;
        return 0;
      },
    });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: INSTALLER_MISMATCH_MESSAGE });
    expect(INSTALLER_MISMATCH_MESSAGE).toContain('SHA-256');
    expect(launched).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'engine-error' });
    expect(existsSync(path.join(dir, 'magistra-ollama', 'OllamaSetup-v0.12.3.exe.part'))).toBe(false);
  });

  it('empreinte officielle indisponible : installation refusée, rien n’est téléchargé ni lancé', async () => {
    for (const sums of ['missing', 'network', '404', 'no-line'] as const) {
      const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
      const ranges: string[] = [];
      let launched = false;
      const { manager, events } = await makeManager({
        ollama,
        netFetch: makeFetch(ollama, github(ranges, { sums })),
        runInstaller: async () => {
          launched = true;
          return 0;
        },
      });
      await expect(manager.installEngine(), sums).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: INSTALLER_UNVERIFIABLE_MESSAGE });
      expect(launched, sums).toBe(false);
      expect(ranges, sums).toEqual([]);
      expect(events, sums).toEqual([{ kind: 'engine-error', message: INSTALLER_UNVERIFIABLE_MESSAGE }]);
    }
    // Message en français qui renvoie vers le repli existant de l'interface (page officielle).
    expect(INSTALLER_UNVERIFIABLE_MESSAGE).toMatch(/SHA-256/);
    expect(INSTALLER_UNVERIFIABLE_MESSAGE).toContain('« Ouvrir la page officielle d’installation »');
  });

  it('API GitHub injoignable : empreinte de « latest » exigée elle aussi', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const requested: string[] = [];
    let launched = false;
    const { manager } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, url => {
        requested.push(url);
        if (url.startsWith('https://api.github.com/')) throw new TypeError('fetch failed');
        if (url.endsWith('/sha256sum.txt')) return new Response('Not Found', { status: 404 });
        return new Response(installer);
      }),
      runInstaller: async () => {
        launched = true;
        return 0;
      },
    });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: INSTALLER_UNVERIFIABLE_MESSAGE });
    expect(launched).toBe(false);
    expect(requested.some(u => u.endsWith('/OllamaSetup.exe'))).toBe(false);
  });

  it('installateur déjà téléchargé : jamais lancé sans empreinte, réutilisé seulement s’il correspond', async () => {
    const setupDir = path.join(dir, 'magistra-ollama');
    const finalPath = path.join(setupDir, 'OllamaSetup-v0.12.3.exe');
    mkdirSync(setupDir, { recursive: true });

    // 1. Fichier présent mais empreinte injoignable : refus, le fichier n'est pas lancé.
    writeFileSync(finalPath, installer);
    {
      const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
      let launched = false;
      const { manager } = await makeManager({
        ollama,
        netFetch: makeFetch(ollama, github([], { sums: 'network' })),
        runInstaller: async () => {
          launched = true;
          return 0;
        },
      });
      await expect(manager.installEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: INSTALLER_UNVERIFIABLE_MESSAGE });
      expect(launched).toBe(false);
    }

    // 2. Fichier intact : réutilisé sans nouveau téléchargement.
    {
      const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
      const ranges: string[] = [];
      const launched: string[] = [];
      const { manager } = await makeManager({
        ollama,
        netFetch: makeFetch(ollama, github(ranges)),
        runInstaller: async file => {
          launched.push(createHash('sha256').update(readFileSync(file)).digest('hex'));
          ollama.running = true;
          return 0;
        },
      });
      await manager.installEngine();
      expect(ranges).toEqual([]);
      expect(launched).toEqual([sha]);
    }

    // 3. Fichier modifié depuis : supprimé, retéléchargé, et seul l'installateur vérifié est lancé.
    writeFileSync(finalPath, Buffer.concat([installer, Buffer.from('piège')]));
    {
      const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
      const ranges: string[] = [];
      const launched: string[] = [];
      const { manager } = await makeManager({
        ollama,
        netFetch: makeFetch(ollama, github(ranges)),
        runInstaller: async file => {
          launched.push(createHash('sha256').update(readFileSync(file)).digest('hex'));
          ollama.running = true;
          return 0;
        },
      });
      await manager.installEngine();
      expect(ranges).toEqual(['']);
      expect(launched).toEqual([sha]);
    }
  });

  it('espace disque insuffisant : refus avant téléchargement', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const ranges: string[] = [];
    const { manager } = await makeManager({ ollama, freeGB: 2, netFetch: makeFetch(ollama, github(ranges)) });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'STORAGE_ERROR', message: expect.stringContaining('5 Go') });
    expect(ranges).toEqual([]);
  });

  it('échec de l’installateur : message invitant au téléchargement manuel', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager } = await makeManager({ ollama, netFetch: makeFetch(ollama, github([])), runInstaller: async () => 2 });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: expect.stringContaining('Ouvrir la page officielle d’installation') });
  });

  it('hors Windows : pas d’installation automatique', async () => {
    const { manager } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, platform: 'darwin' });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED' });
  });

  it('page officielle + détection automatique de la fin de l’installation', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, events, opened } = await makeManager({ ollama, platform: 'darwin' });
    await manager.openEngineDownload();
    expect(opened).toEqual([OLLAMA_DOWNLOAD_PAGE]);
    expect(events[0]).toMatchObject({ kind: 'engine-waiting' });
    setTimeout(() => {
      ollama.running = true;
    }, 30);
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const check = () => {
        if (events.some(e => e.kind === 'engine-ready')) return resolve();
        if (Date.now() > deadline) return reject(new Error('engine-ready non reçu'));
        setTimeout(check, 10);
      };
      check();
    });
    expect(events.at(-1)).toEqual({ kind: 'engine-ready', version: '0.12.3' });
  });

  it('lit sha256sum.txt', () => {
    expect(parseSha256Sums(`${'a'.repeat(64)}  ./OllamaSetup.exe\n${'b'.repeat(64)} *ollama-windows-amd64.zip`, 'OllamaSetup.exe')).toBe('a'.repeat(64));
    expect(parseSha256Sums('rien', 'OllamaSetup.exe')).toBeUndefined();
  });
});

describe('serveur d’IA distant : la clé ne suit jamais une redirection (non-régression)', () => {
  it('demande redirect=manual et refuse toute réponse 3xx avec un message clair', async () => {
    const seen: RequestInit[] = [];
    const fake: FetchLike = async (_input, init) => {
      seen.push(init ?? {});
      return new Response(null, { status: 302, headers: { Location: 'http://autre-serveur.example/v1/chat/completions' } });
    };
    const guarded = noRedirects(fake, 'Serveur universitaire');
    await expect(guarded('https://ia.univ.fr/v1/chat/completions', { headers: { Authorization: 'Bearer secret' } }))
      .rejects.toMatchObject({ code: 'AI_SERVER_UNAVAILABLE', message: expect.stringContaining('redirige') });
    expect(seen[0].redirect).toBe('manual');
  });

  it('laisse passer les réponses normales', async () => {
    const guarded = noRedirects(async () => new Response('{"data":[]}', { status: 200 }), 'Serveur');
    const res = await guarded('https://ia.univ.fr/v1/models');
    expect(res.status).toBe(200);
  });
});

describe('messages d’installation du moteur', () => {
  it('renvoient au bouton qui existe réellement dans l’interface', async () => {
    const { readFileSync } = await import('node:fs');
    const setup = readFileSync(new URL('../../electron/ollamaSetup.ts', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../../src/components/ai/EngineSetupPanel.tsx', import.meta.url), 'utf8');
    const referenced = new Set([...setup.matchAll(/utilisez « ([^»]+) »/gi)].map(m => m[1].trim()));
    expect(referenced.size).toBeGreaterThan(0);
    for (const label of referenced) expect(panel.replaceAll('\'', '’'), label).toContain(label.replaceAll('\'', '’'));
  });
});
