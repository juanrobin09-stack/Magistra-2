// IA locale face à un vrai Ollama v0.34 (formats reconstitués d'après ses sources) : version minimale et mise à jour
// du moteur, lancement sans fenêtre, délai et diagnostic du démarrage, fin de la surveillance d'une installation
// manuelle, proxy d'établissement, espace disque, modèles installés sous un autre nom, préchargement.
// Chaque test échoue sur le code d'avant ces corrections.

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_OLLAMA_VERSION } from '../../shared/ai/models.js';
import type { AIProgressEvent } from '../../shared/ipc.js';
import {
  ENGINE_STARTING_MESSAGE, ENGINE_VANISHED_MESSAGE, ENGINE_WATCH_TIMEOUT_MESSAGE, OLLAMA_PROCESS_NAMES, PROXY_PROBE_URL,
  PROXY_RESTART_MESSAGE, RESTART_UNSUPPORTED_MESSAGE, envProxy, modelsDirFromServerLog, ollamaServerLogPath, prependOllamaDirs, proxyUrlFromRules, sanitizeLogText,
  serverLogExcerpt, type LocalOllamaProvider,
} from '../../electron/ollamaSetup.js';
import { sanitizeEngineInstallOptions, sanitizeEngineStartOptions } from '../../electron/validate.js';
import {
  ADMIN_APP_EXE, ADMIN_CLI_EXE, APP_EXE, CLI_EXE, GB, RECENT_VERSION, WINDOWS_ENV, makeFetch, makeManager as makeManagerIn, ndjsonResponse,
  pullLines, type FakeOllama, type ManagerOptions,
} from './fakeOllama.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-engine-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const makeManager = (opts: ManagerOptions) => makeManagerIn(dir, { env: WINDOWS_ENV, ...opts });
const OLD_VERSION = '0.12.3';
const PROXY_RULES = 'PROXY proxy.lycee.fr:3128; DIRECT';
const PROXY_URL = 'http://proxy.lycee.fr:3128';

/** Faux GitHub : dernière version d'Ollama avec son empreinte officielle. */
function github(installer: Buffer<ArrayBuffer>, ranges: string[] = []) {
  const sha = createHash('sha256').update(installer).digest('hex');
  const SETUP_URL = 'https://github.com/ollama/ollama/releases/download/v0.34.4/OllamaSetup.exe';
  const SUMS_URL = 'https://github.com/ollama/ollama/releases/download/v0.34.4/sha256sum.txt';
  return (url: string): Response | undefined => {
    if (url.startsWith('https://api.github.com/')) {
      return Response.json({
        tag_name: 'v0.34.4',
        assets: [
          { name: 'OllamaSetup.exe', size: installer.length, browser_download_url: SETUP_URL },
          { name: 'sha256sum.txt', size: 200, browser_download_url: SUMS_URL },
        ],
      });
    }
    if (url === SUMS_URL) return new Response(`${sha}  ./OllamaSetup.exe\n`);
    if (url === SETUP_URL) {
      ranges.push('');
      return new Response(installer, { headers: { 'content-length': String(installer.length) } });
    }
    return undefined;
  };
}

function modelPulls(events: AIProgressEvent[]) {
  return events.filter((e): e is Extract<AIProgressEvent, { kind: 'model-pull' }> => e.kind === 'model-pull');
}

// ─── 1. Version d'Ollama et mise à jour du moteur ──────────────────────────

describe('moteur trop ancien (WIN-OLLAMA-VERSION)', () => {
  it('état : outdated, version minimale, titre « Moteur IA à mettre à jour »', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager } = await makeManager({ ollama, existing: [APP_EXE] });
    const status = await manager.status();
    expect(status.engine).toMatchObject({ state: 'running', version: OLD_VERSION, outdated: true, minVersion: MIN_OLLAMA_VERSION });
    expect(status.engine.managedByAdmin).toBeUndefined();
    expect(status.headline).toBe('Moteur IA à mettre à jour');
    expect(status.ready).toBe(false);

    // Version suffisante (ou pré-version de la minimale, ou « inconnue ») : rien n'est signalé.
    for (const version of [RECENT_VERSION, '0.13.1-rc1', 'inconnue', '0.0.0']) {
      ollama.version = version;
      expect((await manager.status()).engine.outdated, version).toBeUndefined();
    }
  });

  it('Ollama dans Program Files : « installé par le service informatique » (managedByAdmin)', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager } = await makeManager({ ollama, existing: [ADMIN_APP_EXE, ADMIN_CLI_EXE] });
    expect((await manager.status()).engine).toMatchObject({ outdated: true, managedByAdmin: true, executable: ADMIN_APP_EXE });
    expect(manager.isManagedByAdmin('c:\\program files\\Ollama\\ollama.exe')).toBe(true);
    expect(manager.isManagedByAdmin(CLI_EXE)).toBe(false);
  });

  it('téléchargement d’un modèle : ENGINE_OUTDATED AVANT tout appel au registre, jamais « à reprendre »', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager, events } = await makeManager({ ollama, existing: [APP_EXE] });
    await expect(manager.pullModel({ tier: 'leger' })).rejects.toMatchObject({
      code: 'ENGINE_OUTDATED',
      message: expect.stringContaining('utilisez « Mettre à jour le moteur IA »'),
    });
    expect(ollama.pullRequests).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: 'model-error', message: expect.stringContaining(`${OLD_VERSION}`) });

    // Après la mise à jour : un nouveau téléchargement, pas une « reprise ».
    ollama.version = RECENT_VERSION;
    events.length = 0;
    await manager.pullModel({ tier: 'leger' });
    expect(modelPulls(events)[0].status).toBe('Préparation du téléchargement…');
    expect(ollama.pullRequests).toEqual(['ministral-3:8b']);
  });

  it('moteur géré par le service informatique : le message l’indique au lieu de proposer la mise à jour', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager } = await makeManager({ ollama, existing: [ADMIN_APP_EXE] });
    await expect(manager.pullModel({ tier: 'standard' })).rejects.toMatchObject({
      code: 'ENGINE_OUTDATED',
      message: expect.stringMatching(/service informatique.*0\.13\.1 minimum/),
    });
  });

  it('412 du registre (ligne NDJSON d’Ollama v0.34) : ENGINE_OUTDATED, jamais ajouté aux téléchargements interrompus', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    ollama.pull = () => ndjsonResponse([
      { status: 'pulling manifest' },
      { error: 'pull model manifest: 412: The model you are attempting to pull requires a newer version of Ollama. Please download the latest version at: https://ollama.com/download' },
    ]);
    const { manager, events } = await makeManager({ ollama, existing: [APP_EXE] });
    await expect(manager.pullModel({ tier: 'standard' })).rejects.toMatchObject({ code: 'ENGINE_OUTDATED' });
    ollama.pull = undefined;
    events.length = 0;
    await manager.pullModel({ tier: 'standard' });
    expect(modelPulls(events)[0].status).toBe('Préparation du téléchargement…');
  });

  it('« Mettre à jour le moteur IA » : pas de retour anticipé, SHA-256 vérifié, installateur lancé, nouvelle version contrôlée', async () => {
    const installer = randomBytes(200_000);
    const ranges: string[] = [];
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const launched: { args: string[]; sha: string }[] = [];
    const { manager, events } = await makeManager({
      ollama,
      existing: [APP_EXE, CLI_EXE],
      netFetch: makeFetch(ollama, github(installer, ranges)),
      runInstaller: async (file, args) => {
        const { readFileSync } = await import('node:fs');
        launched.push({ args, sha: createHash('sha256').update(readFileSync(file)).digest('hex') });
        // L'installateur officiel arrête l'ancien moteur, remplace les fichiers et relance Ollama.
        ollama.version = RECENT_VERSION;
        return 0;
      },
    });
    // Sans « update », le moteur en marche suffit (comportement inchangé) : rien n'est téléchargé.
    await manager.installEngine();
    expect(ranges).toEqual([]);
    events.length = 0;

    await manager.installEngine({ update: true });
    expect(ranges).toEqual(['']);
    expect(launched).toEqual([{ args: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], sha: createHash('sha256').update(installer).digest('hex') }]);
    expect(events.find(e => e.kind === 'engine-install')).toMatchObject({ message: expect.stringContaining('Mise à jour du moteur IA') });
    expect(events.at(-1)).toEqual({ kind: 'engine-ready', version: RECENT_VERSION });
    expect((await manager.status()).engine.outdated).toBeUndefined();
  });

  it('mise à jour sans effet (ancien moteur toujours en service) : ENGINE_OUTDATED explicite', async () => {
    const installer = randomBytes(50_000);
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager, events } = await makeManager({
      ollama,
      existing: [APP_EXE],
      netFetch: makeFetch(ollama, github(installer)),
      runInstaller: async () => 0,
    });
    await expect(manager.installEngine({ update: true })).rejects.toMatchObject({
      code: 'ENGINE_OUTDATED',
      message: expect.stringContaining('toujours trop ancien'),
    });
    expect(events.at(-1)).toMatchObject({ kind: 'engine-error' });
  });

  it('mise à jour refusée (sans rien télécharger) si Ollama est géré par le service informatique', async () => {
    const ranges: string[] = [];
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager, events } = await makeManager({ ollama, existing: [ADMIN_APP_EXE], netFetch: makeFetch(ollama, github(randomBytes(10), ranges)) });
    await expect(manager.installEngine({ update: true })).rejects.toMatchObject({
      code: 'ENGINE_OUTDATED',
      message: expect.stringContaining('Demandez au service informatique'),
    });
    expect(ranges).toEqual([]);
    expect(events).toEqual([{ kind: 'engine-error', message: expect.stringContaining('Program Files') }]);
  });

  it('hors Windows : mise à jour automatique indisponible, message clair', async () => {
    const { manager } = await makeManager({ ollama: { running: true, models: [], pullRequests: [], version: OLD_VERSION }, platform: 'linux', env: { PATH: '' } });
    await expect(manager.installEngine({ update: true })).rejects.toMatchObject({ code: 'ENGINE_OUTDATED', message: expect.stringContaining('ollama.com/download') });
  });
});

describe('options du canal IPC (validation)', () => {
  it('installEngine : { update: booléen } uniquement', () => {
    expect(sanitizeEngineInstallOptions(undefined)).toEqual({});
    expect(sanitizeEngineInstallOptions(null)).toEqual({});
    expect(sanitizeEngineInstallOptions({ update: true })).toEqual({ update: true });
    expect(sanitizeEngineInstallOptions({ update: false })).toEqual({});
    for (const bad of [{ update: 'oui' }, { update: true, url: 'https://evil.example/setup.exe' }, [true], 'update', 1]) {
      expect(() => sanitizeEngineInstallOptions(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    }
  });

  it('startEngine : { restart: booléen } uniquement', () => {
    expect(sanitizeEngineStartOptions(undefined)).toEqual({});
    expect(sanitizeEngineStartOptions({ restart: true })).toEqual({ restart: true });
    for (const bad of [{ restart: 1 }, { restart: true, env: { HTTPS_PROXY: 'x' } }, 'restart']) {
      expect(() => sanitizeEngineStartOptions(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    }
  });
});

// ─── 3. Démarrage : délai de 120 s et diagnostic ───────────────────────────

describe('démarrage du moteur (WIN-OLLAMA-START-TIMEOUT, G6)', () => {
  /** Horloge simulée : chaque attente fait avancer le temps, sans attendre réellement. */
  function fakeTime() {
    let clock = 1_000_000;
    return { now: () => clock, sleep: async (ms: number) => { clock += ms; }, advance: (ms: number) => { clock += ms; } };
  }

  it('un moteur qui répond au bout de 60 s est attendu (délai par défaut : 120 s)', async () => {
    const time = fakeTime();
    const ollama: FakeOllama = { running: false, models: ['ministral-3:14b'], pullRequests: [] };
    let startedAt = 0;
    const { manager } = await makeManager({
      ollama,
      existing: [APP_EXE],
      timings: null,
      clock: time.now,
      sleep: time.sleep,
      onSpawn: () => {
        startedAt = time.now();
      },
      extra: () => {
        if (startedAt && time.now() - startedAt >= 60_000) ollama.running = true;
        return undefined;
      },
    });
    const statuses: string[] = [];
    const provider = await manager.resolveProvider(undefined, m => statuses.push(m));
    expect(provider.model).toBe('ministral-3:14b');
    expect(statuses).toEqual([ENGINE_STARTING_MESSAGE]);
    expect(ENGINE_STARTING_MESSAGE).toBe('Le moteur IA démarre, cela peut prendre une minute au premier lancement…');
  });

  it('échec : dernière erreur du journal (filtrée), antivirus évoqué, « redémarrez » seulement en dernier recours', async () => {
    const log = [
      'time=2026-09-28T10:00:00.000+02:00 level=INFO source=routes.go:1 msg="server config" env="map[HTTPS_PROXY:http://jean:secret@proxy.lycee.fr:3128]"',
      'time=2026-09-28T10:00:01.000+02:00 level=ERROR source=server.go:42 msg="unable to load runner" error="open C:\\Users\\Jean Dupont\\AppData\\Local\\Programs\\Ollama\\lib\\ollama\\ggml-cpu.dll: Access is denied."',
    ].join('\n');
    const read: string[] = [];
    const { manager } = await makeManager({
      ollama: { running: false, models: [], pullRequests: [] },
      existing: ['C:\\Users\\Jean Dupont\\AppData\\Local\\Programs\\Ollama\\ollama app.exe'],
      env: { ...WINDOWS_ENV, LOCALAPPDATA: 'C:\\Users\\Jean Dupont\\AppData\\Local' },
      readFileTail: async file => {
        read.push(file);
        return log;
      },
    });
    const err = await manager.startEngineOrExplain().catch((e: Error) => e) as Error & { code?: string };
    expect(err).toMatchObject({ code: 'ENGINE_NOT_RUNNING' });
    expect(read).toEqual(['C:\\Users\\Jean Dupont\\AppData\\Local\\Ollama\\server.log']);
    expect(err.message).toContain('Dernière erreur signalée par le moteur : « unable to load runner : open ');
    expect(err.message).toContain('antivirus');
    expect(err.message).not.toMatch(/Jean|Dupont|secret|proxy\.lycee/);
    expect(err.message.indexOf('redémarrez')).toBeGreaterThan(err.message.indexOf('antivirus'));
    expect(err.message.startsWith('Le moteur IA ne démarre pas.')).toBe(true);
  });

  it('port déjà utilisé (journal « bind ») : message dédié', async () => {
    const { manager } = await makeManager({
      ollama: { running: false, models: [], pullRequests: [] },
      existing: [APP_EXE],
      readFileTail: async () => 'Error: listen tcp 127.0.0.1:11434: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.',
    });
    await expect(manager.startEngineOrExplain()).rejects.toMatchObject({
      code: 'ENGINE_NOT_RUNNING',
      message: expect.stringContaining('le port 11434 est déjà utilisé par un autre programme'),
    });
  });

  it('port ouvert mais pas encore de réponse (détection des cartes graphiques) : « patientez »', async () => {
    const ollama: FakeOllama = { running: true, versionMode: 'hang', models: [], pullRequests: [] };
    const { manager } = await makeManager({ ollama, existing: [APP_EXE] });
    await expect(manager.startEngineOrExplain()).rejects.toMatchObject({ code: 'ENGINE_NOT_RUNNING', message: expect.stringContaining('démarre encore') });
  });

  it('exécutable disparu juste après son lancement : quarantaine antivirus évoquée', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, existing } = await makeManager({ ollama, existing: [APP_EXE, CLI_EXE], onSpawn: () => existing.clear() });
    await expect(manager.startEngineOrExplain()).rejects.toMatchObject({ code: 'ENGINE_NOT_INSTALLED', message: ENGINE_VANISHED_MESSAGE });
  });

  it('génération : la cause probable remplace « Redémarrez l’ordinateur »', async () => {
    const { manager } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, existing: [APP_EXE] });
    const err = await manager.resolveProvider().catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'ENGINE_NOT_RUNNING', message: expect.stringMatching(/^Le moteur IA ne démarre pas\..*antivirus/) });
  });

  it('installation terminée mais moteur muet : diagnostic, pas « Redémarrez l’ordinateur » en premier', async () => {
    const installer = randomBytes(20_000);
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager } = await makeManager({ ollama, netFetch: makeFetch(ollama, github(installer)), runInstaller: async () => 0 });
    const err = await manager.installEngine().catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'ENGINE_NOT_INSTALLED' });
    expect((err as Error).message).not.toMatch(/^Le moteur IA est installé mais ne répond pas\. Redémarrez/);
  });

  it('extraits de journal : format slog, identifiants et dossiers personnels retirés', () => {
    expect(ollamaServerLogPath('win32', { LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local' }, 'C:\\Users\\prof')).toBe('C:\\Users\\prof\\AppData\\Local\\Ollama\\server.log');
    expect(ollamaServerLogPath('linux', {}, '/home/prof')).toBe('/home/prof/.ollama/logs/server.log');
    expect(serverLogExcerpt('level=INFO msg="tout va bien"')).toBeUndefined();
    expect(serverLogExcerpt(undefined)).toBeUndefined();
    const excerpt = serverLogExcerpt('time=x level=ERROR source=a.go:1 msg="llama runner terminated" error="exit status 0xc0000135"\npanic: runtime error', 'C:\\Users\\prof');
    expect(excerpt).toBe('llama runner terminated : exit status 0xc0000135 / panic: runtime error');
    expect(sanitizeLogText('proxy http://marie:MotDePasse@10.0.0.1:3128 refusé')).toBe('proxy http://…@10.0.0.1:3128 refusé');
    expect(sanitizeLogText('C:\\Users\\marie.curie\\.ollama\\models absent', 'C:\\Users\\marie.curie')).toBe('~\\.ollama\\models absent');
    expect(sanitizeLogText('/home/paul/.ollama/logs', '/home/autre')).toBe('/home/…/.ollama/logs');
    expect(sanitizeLogText('D:\\Users\\Léa Martin\\x.dll')).toBe('D:\\Users\\…\\x.dll');
  });
});

// ─── 4. Fin de la surveillance d'une installation manuelle ─────────────────

describe('installation manuelle non détectée (WIN-OLLAMA-WATCH-SILENT-END)', () => {
  it('à l’échéance, une erreur claire est émise (plus d’écran d’attente sans fin)', async () => {
    const { manager, events } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, timings: { watchTimeoutMs: 40 } });
    await manager.openEngineDownload();
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ kind: 'engine-error', message: ENGINE_WATCH_TIMEOUT_MESSAGE }), { timeout: 2_000 });
    expect(ENGINE_WATCH_TIMEOUT_MESSAGE).toContain('utilisez « Installer le moteur IA »');
  });

  it('installé mais qui ne démarre pas : la cause probable est donnée', async () => {
    const { manager, events } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, existing: [APP_EXE], timings: { watchTimeoutMs: 60 } });
    await manager.openEngineDownload();
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ kind: 'engine-error', message: expect.stringContaining('Le moteur IA ne démarre pas.') }), { timeout: 3_000 });
  });

  it('annulation : aucune erreur émise', async () => {
    const { manager, events } = await makeManager({ ollama: { running: false, models: [], pullRequests: [] }, timings: { watchTimeoutMs: 80 } });
    await manager.openEngineDownload();
    manager.cancelEngineInstall();
    await new Promise(r => setTimeout(r, 200));
    expect(events.some(e => e.kind === 'engine-error')).toBe(false);
  });
});

// ─── 5. Proxy d'établissement ──────────────────────────────────────────────

describe('proxy d’établissement (WIN-OLLAMA-PROXY)', () => {
  it('règles du système → HTTPS_PROXY pour Ollama', () => {
    expect(proxyUrlFromRules('PROXY proxy.lycee.fr:3128; DIRECT')).toBe(PROXY_URL);
    expect(proxyUrlFromRules('HTTPS secure.proxy:443')).toBe('https://secure.proxy:443');
    expect(proxyUrlFromRules('SOCKS5 10.0.0.2:1080')).toBe('socks5://10.0.0.2:1080');
    expect(proxyUrlFromRules('PROXY [fd00::1]:8080')).toBe('http://[fd00::1]:8080');
    expect(proxyUrlFromRules('DIRECT')).toBeNull();
    expect(proxyUrlFromRules('DIRECT; PROXY p:1')).toBeNull();
    expect(proxyUrlFromRules('SOCKS 10.0.0.2:1080')).toBeNull(); // SOCKS4 : non géré par Ollama (Go)
    expect(proxyUrlFromRules('PROXY a b:1')).toBeNull();
    expect(proxyUrlFromRules('')).toBeNull();
    expect(envProxy({ https_proxy: ' http://p:1 ' })).toBe('http://p:1');
  });

  it('Ollama lancé par Magistra reçoit le proxy du système (HTTPS_PROXY), sans écraser celui déjà défini', async () => {
    const asked: string[] = [];
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const { manager, spawned } = await makeManager({
      ollama,
      existing: [APP_EXE],
      resolveProxy: async url => {
        asked.push(url);
        return PROXY_RULES;
      },
      onSpawn: () => {
        ollama.running = true;
      },
    });
    expect(await manager.startEngine()).toBe(true);
    expect(asked).toEqual([PROXY_PROBE_URL]);
    expect(spawned[0].env?.HTTPS_PROXY).toBe(PROXY_URL);

    const ollama2: FakeOllama = { running: false, models: [], pullRequests: [] };
    const other = await makeManager({
      ollama: ollama2,
      existing: [APP_EXE],
      env: { ...WINDOWS_ENV, HTTPS_PROXY: 'http://proxy-perso:8080' },
      resolveProxy: async () => PROXY_RULES,
      onSpawn: () => {
        ollama2.running = true;
      },
    });
    await other.manager.startEngine();
    expect(other.spawned[0].env?.HTTPS_PROXY).toBe('http://proxy-perso:8080');
  });

  it('l’installateur (qui lance Ollama à la fin) reçoit aussi le proxy', async () => {
    const installer = randomBytes(20_000);
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    let installerProxy: string | undefined;
    const { manager } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, github(installer)),
      resolveProxy: async () => PROXY_RULES,
      runInstaller: async (_file, _args, _signal, env) => {
        installerProxy = env?.HTTPS_PROXY;
        ollama.running = true;
        return 0;
      },
    });
    await manager.installEngine();
    expect(installerProxy).toBe(PROXY_URL);
  });

  it('téléchargement en échec réseau, Ollama démarré sans le proxy : message dédié, puis relance consentie et reprise', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const killed: string[][] = [];
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    ollama.pull = () => ndjsonResponse([
      { status: 'pulling manifest' },
      { error: 'pull model manifest: Get "https://registry.ollama.ai/v2/library/ministral-3/manifests/14b": dial tcp 104.21.75.227:443: i/o timeout' },
    ]);
    const { manager, events, spawned } = await makeManager({
      ollama,
      existing: [APP_EXE, CLI_EXE],
      resolveProxy: async () => PROXY_RULES,
      killProcesses: async names => {
        killed.push([...names]);
        ollama.running = false;
      },
      onSpawn: (_file, _args, env) => {
        // Le « vrai » Ollama ne joint le registre qu'avec le proxy.
        ollama.running = true;
        ollama.pull = env?.HTTPS_PROXY === PROXY_URL ? undefined : ollama.pull;
      },
    });
    await expect(manager.pullModel({ tier: 'standard' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: PROXY_RESTART_MESSAGE });
    expect(events.at(-1)).toEqual({ kind: 'model-error', model: 'ministral-3:14b', message: PROXY_RESTART_MESSAGE });
    expect((await manager.status()).engine.proxyRestart).toBe(true);
    expect(killed).toEqual([]);

    // « Reprendre le téléchargement » : le moteur est relancé avec le proxy, puis le téléchargement reprend.
    events.length = 0;
    await manager.pullModel({ tier: 'standard' });
    expect(killed).toEqual([[...OLLAMA_PROCESS_NAMES]]);
    expect(spawned.at(-1)).toMatchObject({ file: APP_EXE, args: ['--hide', '--fast-startup'], env: expect.objectContaining({ HTTPS_PROXY: PROXY_URL }) });
    expect(modelPulls(events)[0].status).toBe('Relance du moteur IA avec le proxy de l’établissement…');
    expect(modelPulls(events)[1].status).toBe('Reprise du téléchargement…');
    expect(events.at(-1)).toEqual({ kind: 'model-ready', model: 'ministral-3:14b' });
    expect((await manager.status()).engine.proxyRestart).toBeUndefined();
    // L'adresse du proxy (et d'éventuels identifiants) n'est jamais journalisée.
    expect(logs.join('\n')).not.toContain('proxy.lycee.fr');
  });

  it('bouton « Relancer le moteur IA » (startEngine({ restart: true })) : arrêt puis relance avec le proxy', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const killed: string[][] = [];
    const { manager, spawned } = await makeManager({
      ollama,
      existing: [APP_EXE],
      resolveProxy: async () => PROXY_RULES,
      killProcesses: async names => {
        killed.push([...names]);
        ollama.running = false;
      },
      onSpawn: () => {
        ollama.running = true;
      },
    });
    await expect(manager.restartEngine()).resolves.toBe(true);
    expect(killed).toEqual([['ollama app.exe', 'ollama.exe']]);
    expect(spawned.at(-1)?.env?.HTTPS_PROXY).toBe(PROXY_URL);
  });

  it('moteur impossible à arrêter (démarré par le service informatique) : message clair', async () => {
    const { manager } = await makeManager({
      ollama: { running: true, models: [], pullRequests: [] },
      existing: [APP_EXE],
      resolveProxy: async () => PROXY_RULES,
      killProcesses: async () => undefined,
    });
    await expect(manager.restartEngine()).rejects.toMatchObject({ code: 'ENGINE_NOT_RUNNING', message: expect.stringContaining('HTTPS_PROXY') });
  });

  it('hors Windows : relance non proposée', async () => {
    const { manager } = await makeManager({ ollama: { running: true, models: [], pullRequests: [] }, platform: 'linux', env: { PATH: '' } });
    await expect(manager.restartEngine()).rejects.toMatchObject({ message: RESTART_UNSUPPORTED_MESSAGE });
  });

  it('échec réseau sans proxy système, ou moteur lancé par Magistra avec le proxy : message réseau habituel', async () => {
    const failing = () => ndjsonResponse([{ status: 'pulling manifest' }, { error: 'pull model manifest: dial tcp: lookup registry.ollama.ai: no such host' }]);
    const direct = await makeManager({ ollama: { running: true, models: [], pullRequests: [], pull: failing }, existing: [APP_EXE], resolveProxy: async () => 'DIRECT' });
    await expect(direct.manager.pullModel({ tier: 'leger' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.not.stringContaining('Reprendre le téléchargement') });

    const ollama: FakeOllama = { running: false, models: [], pullRequests: [], pull: failing };
    const own = await makeManager({ ollama, existing: [APP_EXE], resolveProxy: async () => PROXY_RULES, onSpawn: () => { ollama.running = true; } });
    await own.manager.startEngine();
    await expect(own.manager.pullModel({ tier: 'leger' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.not.stringContaining('Reprendre le téléchargement') });
    expect((await own.manager.status()).engine.proxyRestart).toBeUndefined();
  });
});

// ─── 6. Espace disque de l'installateur ────────────────────────────────────

describe('espace disque (WIN-OLLAMA-INSTALLER-SIZE)', () => {
  it('dossier temporaire (installateur) et %LOCALAPPDATA% (binaires) mesurés séparément', async () => {
    const ranges: string[] = [];
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const measured: string[] = [];
    const { manager } = await makeManager({
      ollama,
      netFetch: makeFetch(ollama, github(randomBytes(10), ranges)),
      freeBytes: d => {
        measured.push(d);
        return d === dir ? 1 * GB : 120 * GB;
      },
    });
    await expect(manager.installEngine()).rejects.toMatchObject({ code: 'STORAGE_ERROR', message: expect.stringContaining('dossier temporaire') });
    expect(measured).toEqual(['C:\\Users\\prof\\AppData\\Local', dir]);
    expect(ranges).toEqual([]);
  });
});

// ─── 7. Modèle déjà installé sous un autre nom (G4) ────────────────────────

describe('modèle installé sous un autre nom (G4)', () => {
  it('« ministral-3:latest » : Léger installé, prêt, utilisé tel quel pour /api/chat, aucun /api/pull', async () => {
    const ollama: FakeOllama = { running: true, models: ['ministral-3:latest'], pullRequests: [] };
    const { manager, config, events } = await makeManager({ ollama, existing: [APP_EXE] });
    await config.update({ tier: 'leger' });
    const status = await manager.status();
    expect(status.tiers.find(t => t.id === 'leger')?.installed).toBe(true);
    expect(status).toMatchObject({ ready: true, headline: 'Prête', activeLabel: 'Magistra Léger' });

    const provider = await manager.resolveProvider() as LocalOllamaProvider;
    expect(provider).toMatchObject({ model: 'ministral-3:latest', modelLabel: 'Magistra Léger', label: 'Magistra Léger' });
    const result = await provider.generate({ messages: [{ role: 'user', content: 'Bonjour' }] });
    expect(result.text).toBe('Bonjour');
    expect(ollama.chats?.at(-1)).toMatchObject({ model: 'ministral-3:latest', think: false });

    await manager.pullModel({ tier: 'leger' });
    expect(ollama.pullRequests).toEqual([]);
    expect(events.at(-1)).toEqual({ kind: 'model-ready', model: 'ministral-3:8b' });
    expect((await manager.describeActive()).ready).toBe(true);
  });

  it('une variante q8_0 n’est pas « Léger » (mémoire bien plus grande)', async () => {
    const ollama: FakeOllama = { running: true, models: ['ministral-3:8b-instruct-2512-q8_0'], pullRequests: [] };
    const { manager, config } = await makeManager({ ollama });
    await config.update({ tier: 'leger' });
    expect((await manager.status()).tiers.find(t => t.id === 'leger')?.installed).toBe(false);
    await expect(manager.resolveProvider()).rejects.toMatchObject({ code: 'MODEL_NOT_INSTALLED' });
  });
});

// ─── 8. Premier mot : préchargement et délai adapté ────────────────────────

describe('génération sur PC sans carte graphique (WIN-OLLAMA-FIRST-TOKEN-TIMEOUT)', () => {
  it('le fournisseur local précharge le modèle (messages [], done_reason « load ») et adapte le délai du premier mot', async () => {
    const ollama: FakeOllama = { running: true, models: ['ministral-3:14b'], pullRequests: [] };
    const { manager } = await makeManager({ ollama });
    const provider = await manager.resolveProvider() as LocalOllamaProvider;
    await provider.preload();
    expect(ollama.chats?.[0]).toMatchObject({ model: 'ministral-3:14b', messages: [], options: { num_ctx: 12_288 } });
    // Long prompt (documents) : bien plus que les 300 s d'avant, plafonné à 30 min.
    const long = [{ role: 'user' as const, content: 'x'.repeat(21_000) }];
    expect(provider.firstChunkTimeoutMs([{ role: 'user', content: 'Bonjour' }])).toBe(300_000);
    expect(provider.firstChunkTimeoutMs(long)).toBeGreaterThan(600_000);
    expect(provider.firstChunkTimeoutMs([{ role: 'user', content: 'x'.repeat(200_000) }])).toBe(30 * 60_000);
  });

  it('mémoire insuffisante au préchargement (format llama-server d’Ollama v0.34) : conseil adapté au niveau', async () => {
    const ollama: FakeOllama = { running: true, models: ['ministral-3:8b', 'ministral-3:14b'], pullRequests: [] };
    const oom = (url: string) => (url.endsWith('/api/chat')
      ? Response.json({ error: 'llama-server reported out-of-memory during startup: cudaMalloc failed: out of memory' }, { status: 500 })
      : undefined);
    const { manager, config } = await makeManager({ ollama, extra: oom });
    await config.update({ tier: 'standard' });
    await expect((await manager.resolveProvider()).preload!()).rejects.toMatchObject({ code: 'OUT_OF_MEMORY', message: expect.stringContaining('Essayez « Magistra Léger »') });
    await config.update({ tier: 'leger' });
    await expect((await manager.resolveProvider()).preload!()).rejects.toMatchObject({ code: 'OUT_OF_MEMORY', message: expect.stringContaining('Magistra Léger sur cet ordinateur') });
  });

  it('capacités : cause précise quand l’IA n’est pas prête (moteur trop ancien, modèle absent, moteur absent)', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager } = await makeManager({ ollama, existing: [APP_EXE] });
    expect((await manager.describeActive()).notReady).toMatchObject({ code: 'ENGINE_OUTDATED' });
    ollama.version = RECENT_VERSION;
    expect((await manager.describeActive()).notReady).toMatchObject({ code: 'MODEL_NOT_INSTALLED', message: expect.stringContaining('Magistra Standard') });
    ollama.running = false;
    expect((await manager.describeActive()).notReady).toMatchObject({ code: 'ENGINE_NOT_RUNNING' });
    const none = await makeManager({ ollama: { running: false, models: [], pullRequests: [] } });
    expect((await none.manager.describeActive()).notReady).toMatchObject({ code: 'ENGINE_NOT_INSTALLED' });
  });

  it('serveur distant : prestataire annoncé (providerInfo), sans URL ni clé', async () => {
    const remoteFetch = async (url: string) => (String(url).endsWith('/models') ? Response.json({ data: [{ id: 'mistral-small-latest' }] }) : new Response('', { status: 404 }));
    const { manager } = await makeManager({ ollama: { running: true, models: [], pullRequests: [] }, netFetch: remoteFetch });
    await manager.setConfig({ mode: 'remote', remote: { kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', apiKey: 'sk-SECRET-42' } });
    const active = await manager.describeActive();
    expect(active.providerInfo).toMatchObject({ thirdParty: true });
    expect(JSON.stringify(active)).not.toMatch(/sk-SECRET-42|api\.mistral\.ai\/v1/);
  });
});

// Garde-fou : le harnais simule bien un moteur récent par défaut (les autres tests en dépendent).
it('le faux Ollama annonce une version récente par défaut', async () => {
  const res = await makeFetch({ running: true, models: [], pullRequests: [] })('http://127.0.0.1:11434/api/version');
  expect(await res.json()).toEqual({ version: RECENT_VERSION });
  void pullLines;
});

// ─── Ollama installé pendant la session, ou par un autre compte : PATH du moteur ───

describe('« ollama app.exe » lancé avec le dossier d’Ollama dans son PATH', () => {
  /** Modèle d'« ollama app.exe » v0.34.4 : il ne trouve ollama.exe QUE par le PATH (première clé, casse ignorée). */
  function appThatNeedsPath(ollama: FakeOllama, files: readonly string[]) {
    return (_file: string, _args: string[], env?: NodeJS.ProcessEnv) => {
      const key = Object.keys(env ?? {}).sort().find(k => k.toUpperCase() === 'PATH');
      const dirs = (key ? env![key] ?? '' : '').split(';').map(d => d.trim()).filter(Boolean);
      if (dirs.some(d => files.includes(path.win32.join(d, 'ollama.exe')))) ollama.running = true;
    };
  }
  // PATH de Magistra figé AVANT l'installation d'Ollama (clé « Path », casse Windows habituelle).
  const FROZEN = { LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local', ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows\\system32;C:\\Windows' };

  it('installé pendant la session (compte de l’enseignant) ou dans Program Files : le moteur démarre', async () => {
    for (const files of [[APP_EXE, CLI_EXE], [ADMIN_APP_EXE, ADMIN_CLI_EXE]]) {
      const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
      const { manager, spawned } = await makeManager({ ollama, env: { ...FROZEN }, existing: files, onSpawn: appThatNeedsPath(ollama, files) });
      await expect(manager.startEngineOrExplain()).resolves.toBe(true);
      const env = spawned[0].env!;
      expect(Object.keys(env).filter(k => k.toUpperCase() === 'PATH')).toEqual(['Path']);
      expect(env.Path).toBe(`${path.win32.dirname(files[0])};${FROZEN.Path}`);
    }
  });

  it('prependOllamaDirs : clé existante modifiée quelle que soit sa casse ; sans PATH, « Path » créé ; dossier de l’app en premier', () => {
    const env: NodeJS.ProcessEnv = { PaTh: 'C:\\A' };
    prependOllamaDirs(env, { app: ADMIN_APP_EXE, cli: ADMIN_CLI_EXE });
    expect(env).toEqual({ PaTh: 'C:\\Program Files\\Ollama;C:\\A' });
    const empty: NodeJS.ProcessEnv = {};
    prependOllamaDirs(empty, { app: APP_EXE, cli: ADMIN_CLI_EXE });
    expect(empty).toEqual({ Path: 'C:\\Users\\prof\\AppData\\Local\\Programs\\Ollama;C:\\Program Files\\Ollama' });
  });

  it('l’environnement de Magistra lui-même n’est jamais modifié', async () => {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const env = { ...FROZEN };
    const { manager } = await makeManager({ ollama, env, existing: [APP_EXE, CLI_EXE], onSpawn: appThatNeedsPath(ollama, [APP_EXE, CLI_EXE]) });
    await manager.startEngineOrExplain();
    expect(env.Path).toBe(FROZEN.Path);
  });
});

// ─── Ollama ancien que Magistra ne peut pas remplacer (service Windows, autre session) ───

describe('moteur ancien géré hors de Magistra : plus de boucle de mise à jour', () => {
  it('Ollama sans « ollama app.exe » (service, autre session) : pas de mise à jour en un clic, message pour le service informatique', async () => {
    for (const [env, existing] of [
      [{ ...WINDOWS_ENV }, [] as string[]],
      [{ ...WINDOWS_ENV, Path: 'C:\\Windows\\System32;C:\\Ollama' }, ['C:\\Ollama\\ollama.exe']],
    ] as const) {
      const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
      let runs = 0;
      const ranges: string[] = [];
      const { manager } = await makeManager({
        ollama, env, existing: [...existing], netFetch: makeFetch(ollama, github(randomBytes(10), ranges)), runInstaller: async () => { runs++; return 0; },
      });
      expect((await manager.status()).engine).toMatchObject({ outdated: true, managedByAdmin: true });
      const pull = await manager.pullModel({ tier: 'leger' }).catch((e: Error) => e);
      expect((pull as Error).message).toMatch(/service informatique/);
      expect((pull as Error).message).not.toMatch(/Program Files|Mettre à jour le moteur IA/);
      const update = await manager.installEngine({ update: true }).catch((e: Error) => e);
      expect((update as Error).message).toMatch(/service informatique/);
      expect(runs).toBe(0);
      expect(ranges).toEqual([]);
    }
  });

  it('mise à jour installée mais l’ancien moteur reste (Magistra ne peut pas l’arrêter) : message dédié, puis plus de bouton', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    let kills = 0;
    const { manager, events } = await makeManager({
      ollama, existing: [APP_EXE, CLI_EXE], netFetch: makeFetch(ollama, github(randomBytes(10))), runInstaller: async () => 0,
      killProcesses: async () => {
        kills++; // accès refusé : le service reste
      },
    });
    expect((await manager.status()).engine.managedByAdmin).toBeUndefined();
    const err = await manager.installEngine({ update: true }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/autre Ollama/);
    expect(kills).toBe(1);
    expect(events.at(-1)).toMatchObject({ kind: 'engine-error' });
    expect((await manager.status()).engine.managedByAdmin).toBe(true);
    // Le service informatique met le service à jour : état normal.
    ollama.version = RECENT_VERSION;
    expect((await manager.status()).engine.outdated).toBeUndefined();
  });

  it('ancien moteur par utilisateur non arrêté par l’installateur : Magistra l’arrête et démarre la nouvelle copie', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    let installed = false;
    const { manager, events } = await makeManager({
      ollama, existing: [APP_EXE, CLI_EXE], netFetch: makeFetch(ollama, github(randomBytes(10))),
      runInstaller: async () => {
        installed = true;
        return 0;
      },
      killProcesses: async () => {
        ollama.running = false;
      },
      onSpawn: () => {
        if (installed) {
          ollama.version = RECENT_VERSION;
          ollama.running = true;
        }
      },
    });
    await manager.installEngine({ update: true });
    expect(events.at(-1)).toEqual({ kind: 'engine-ready', version: RECENT_VERSION });
  });

  it('installation dans un autre dossier (PATH de l’utilisateur, avec « ollama app.exe ») : mise à jour en un clic conservée', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [], version: OLD_VERSION };
    const { manager } = await makeManager({
      ollama, env: { ...WINDOWS_ENV, Path: 'C:\\Windows\\System32;D:\\Ollama' }, existing: ['D:\\Ollama\\ollama.exe', 'D:\\Ollama\\ollama app.exe'],
    });
    const st = await manager.status();
    expect(st.engine).toMatchObject({ outdated: true, executable: 'D:\\Ollama\\ollama app.exe' });
    expect(st.engine.managedByAdmin).toBeUndefined();
  });
});

// ─── Emplacement des modèles changé dans l'application Ollama (D:\…) ───

describe('espace disque mesuré là où le moteur écrit les modèles', () => {
  // Ligne réelle d'Ollama 0.34.4 (Windows : barres obliques inverses échappées, espaces et accents conservés).
  const WIN_LOG = [
    'time=2026-09-29T08:00:00.000+02:00 level=INFO source=routes.go:2005 msg="server config" env="map[HTTPS_PROXY: '
      + 'OLLAMA_MAX_TRANSFER_STREAMS:4 OLLAMA_MODELS:D:\\\\ollama\\\\mes modèles OLLAMA_NOHISTORY:false OLLAMA_ORIGINS:[http://localhost] ROCR_VISIBLE_DEVICES:]"',
    '[GIN] 2026/09/29 - 08:01:05 | 200 |     118.305µs |       127.0.0.1 | GET      "/api/version"',
  ].join('\n');

  it('dossier lu dans la dernière ligne « server config » du journal ; journal illisible → undefined', () => {
    expect(modelsDirFromServerLog(WIN_LOG)).toBe('D:\\ollama\\mes modèles');
    const older = WIN_LOG.replace('D:\\\\ollama\\\\mes modèles', 'C:\\\\ancien');
    expect(modelsDirFromServerLog(`${older}\n${WIN_LOG}`)).toBe('D:\\ollama\\mes modèles');
    expect(modelsDirFromServerLog('time=… level=INFO msg="Listening on 127.0.0.1:11434"')).toBeUndefined();
    expect(modelsDirFromServerLog('')).toBeUndefined();
  });

  it('C: presque plein, modèles sur D: : téléchargement accepté, recommandation « IA locale possible »', async () => {
    const measured: string[] = [];
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const { manager } = await makeManager({
      ollama, existing: [APP_EXE, CLI_EXE],
      freeBytes: d => {
        measured.push(d);
        return /^D:/i.test(d) ? 500 * GB : 5 * GB;
      },
      readFileTail: async file => (file.endsWith('server.log') ? WIN_LOG : undefined),
    });
    await manager.pullModel({ tier: 'leger' });
    expect(ollama.pullRequests).toHaveLength(1);
    expect(measured).toContain('D:\\ollama\\mes modèles');
    expect((await manager.getHardware(true)).freeDiskGB).toBe(500);
  });

  it('sans journal lisible : dossier par défaut, comme avant (disque plein → refus clair, rien téléchargé)', async () => {
    const ollama: FakeOllama = { running: true, models: [], pullRequests: [] };
    const { manager } = await makeManager({ ollama, existing: [APP_EXE, CLI_EXE], freeBytes: () => 1 * GB });
    await expect(manager.pullModel({ tier: 'leger' })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(ollama.pullRequests).toEqual([]);
  });
});

// ─── Installation manuelle : ne pas devancer l'installateur officiel ───

describe('installation manuelle depuis la page officielle : le moteur démarre toujours', () => {
  // Modèle d'« ollama app.exe » v0.34.4 et de son installateur (app/ollama.iss) : une seule instance (un second
  // lancement se ferme) ; ollama.exe trouvé par le PATH à l'initialisation (0,15 s) puis au démarrage du serveur (1 s
  // plus tard) ; l'installateur copie l'application, puis ollama.exe, puis ses bibliothèques, et lance Ollama à la fin.
  const S = 20; // ms par seconde simulée
  const OLLAMA_DIR = path.win32.dirname(APP_EXE);

  function world(ollama: FakeOllama, files: Set<string>) {
    let instance = false;
    const lookPath = (env?: NodeJS.ProcessEnv) => {
      const key = Object.keys(env ?? {}).sort().find(k => k.toUpperCase() === 'PATH');
      for (const d of (key ? env![key] ?? '' : '').split(';').filter(Boolean)) {
        const c = path.win32.join(d, 'ollama.exe');
        if (files.has(c)) return c;
      }
      return undefined;
    };
    const launch = (env?: NodeJS.ProcessEnv) => {
      if (instance) return; // instance existante : fermeture immédiate
      instance = true;
      setTimeout(() => {
        const bin = lookPath(env) ?? 'ollama';
        setTimeout(() => {
          const resolved = bin === 'ollama' ? lookPath(env) : bin;
          if (resolved && files.has(resolved)) setTimeout(() => { ollama.running = true; }, 2 * S);
        }, 1 * S);
      }, 0.15 * S);
    };
    return { launch };
  }

  async function scenario(opts: { gap: number; installerLaunches: boolean }) {
    const ollama: FakeOllama = { running: false, models: [], pullRequests: [] };
    const ref: { w?: ReturnType<typeof world> } = {};
    const { manager, events, existing, spawned } = await makeManager({
      ollama, existing: [],
      timings: { watchIntervalMs: 3 * S, startPollMs: 0.5 * S, startTimeoutMs: 20 * S, watchTimeoutMs: 90 * S, installSettleMs: 40 * S },
      onSpawn: (_f, _a, env) => ref.w!.launch(env),
    });
    const w = world(ollama, existing);
    ref.w = w;
    await manager.openEngineDownload();
    // Application copiée à 2,5 s, ollama.exe `gap` s plus tard, bibliothèques pendant 30 s, puis lancement final.
    setTimeout(() => existing.add(APP_EXE), 2.5 * S);
    setTimeout(() => existing.add(CLI_EXE), (2.5 + opts.gap) * S);
    if (opts.installerLaunches) setTimeout(() => w.launch({ Path: `${OLLAMA_DIR};C:\\Windows\\System32` }), (2.5 + opts.gap + 30) * S);
    await vi.waitFor(() => expect(events.some(e => e.kind === 'engine-ready' || e.kind === 'engine-error')).toBe(true), { timeout: 100 * S, interval: S });
    return { running: ollama.running, last: events.at(-1), spawned: spawned.length, events };
  }

  it('ollama.exe copié 1 s ou 3 s après l’application : Magistra laisse l’installateur lancer Ollama', async () => {
    for (const gap of [1, 3]) {
      const r = await scenario({ gap, installerLaunches: true });
      expect(r.running, `gap ${gap}`).toBe(true);
      expect(r.last).toMatchObject({ kind: 'engine-ready' });
      expect(r.spawned).toBe(0);
      expect(r.events.some(e => e.kind === 'engine-waiting' && e.message.includes('Terminer'))).toBe(true);
    }
  });

  it('lancement final décoché dans l’installateur : Magistra démarre Ollama après le délai, avec le bon PATH', async () => {
    const r = await scenario({ gap: 1, installerLaunches: false });
    expect(r.running).toBe(true);
    expect(r.last).toMatchObject({ kind: 'engine-ready' });
    expect(r.spawned).toBe(1);
  });
});
