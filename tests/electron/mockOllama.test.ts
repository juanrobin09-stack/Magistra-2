// Intégration HTTP réelle : AIManager + GenerationManager contre scripts/mock-ollama.mjs
// (lancé dans un processus séparé, comme un vrai Ollama).

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { AIProgressEvent } from '../../shared/ipc.js';
import type { GenerationEvent } from '../../shared/types.js';
import { AIConfigStore } from '../../electron/aiConfig.js';
import { GenerationManager, type GenerationPayload } from '../../electron/generation.js';
import { LocalStore } from '../../electron/localStore.js';
import { AIManager } from '../../electron/ollamaSetup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const children: ChildProcess[] = [];
const dirs: string[] = [];

afterAll(() => {
  for (const c of children) c.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function startMock(args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/mock-ollama.mjs'), '--port', '0', '--pull-ms', '150', '--chat-delay-ms', '1', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    children.push(child);
    let out = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', chunk => {
      out += chunk;
      const m = /MOCK_OLLAMA_URL (\S+)/.exec(out);
      if (m) resolve(m[1]);
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('le faux Ollama ne démarre pas')), 10_000);
  });
}

async function setup(url: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-mock-'));
  dirs.push(dir);
  const store = new LocalStore(dir, { warn: () => undefined });
  await store.init();
  const config = new AIConfigStore(path.join(dir, 'ai-config.json'), { isAvailable: () => false, encrypt: s => s, decrypt: s => s }, { ollamaUrl: url });
  await config.load();
  const progress: AIProgressEvent[] = [];
  const realFetch = (input: string, init?: RequestInit) => fetch(input, init);
  const ai = new AIManager({
    config,
    localFetch: realFetch,
    netFetch: async () => {
      throw new Error('Internet interdit dans ce test');
    },
    platform: 'linux',
    env: { PATH: '' },
    homedir: dir,
    tmpdir: dir,
    fileExists: async () => false,
    spawnDetached: () => undefined,
    runInstaller: async () => 1,
    openExternal: async () => undefined,
    detectHardware: async () => ({ totalRamGB: 8, cpuCores: 4, gpus: [], freeDiskGB: 100, platform: 'linux' }),
    freeDiskBytes: async () => 100 * 1024 ** 3,
    modelsDir: dir,
    emit: e => progress.push(e),
  });
  const payloads: GenerationPayload[] = [];
  const generation = new GenerationManager({
    store,
    resolveProvider: (signal, onStatus) => ai.resolveProvider(signal, onStatus),
    describeActive: () => ai.describeActive(),
    send: p => {
      payloads.push(p);
      return true;
    },
    fetch: realFetch,
  });
  const run = async (request: unknown): Promise<GenerationEvent[]> => {
    const { jobId } = generation.start(request);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const events = payloads.filter(p => p.jobId === jobId).map(p => p.event);
      if (events.some(e => e.type === 'done' || e.type === 'error')) {
        await new Promise(r => setTimeout(r, 0));
        return events;
      }
      if (Date.now() > deadline) throw new Error('génération non terminée');
      await new Promise(r => setTimeout(r, 10));
    }
  };
  return { ai, store, progress, generation, run };
}

const REQUEST = {
  type: 'cours',
  niveau: 'master_1',
  sujet: 'Apprentissage automatique',
  researchMode: 'documents',
  documents: [{ docId: 'd', docName: 'cours.md', kind: 'md', locator: { type: 'section', start: 1, end: 1, title: 'Définitions' }, text: 'L’apprentissage automatique construit des modèles à partir de données.' }],
};

describe('faux serveur Ollama (HTTP réel)', () => {
  it('état → installation du modèle → génération citée et enregistrée', async () => {
    const url = await startMock(['--models', 'ministral-3:14b']);
    const { ai, store, progress, generation, run } = await setup(url);

    let status = await ai.status();
    expect(status.engine).toMatchObject({ state: 'running', version: '0.12.3-mock', url });
    expect(status.installedModels.map(m => m.name)).toEqual(['ministral-3:14b']);
    expect(status.selectedTier).toBe('leger'); // 8 Go → Léger recommandé au premier démarrage
    expect(status.headline).toBe('Modèle Magistra Léger non installé');
    expect((await generation.capabilities()).ready).toBe(false);

    await ai.pullModel({ tier: 'leger' });
    const pulls = progress.filter((e): e is Extract<AIProgressEvent, { kind: 'model-pull' }> => e.kind === 'model-pull');
    expect(pulls.length).toBeGreaterThan(2);
    const percents = pulls.map(p => p.percent ?? 0);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(progress.at(-1)).toEqual({ kind: 'model-ready', model: 'ministral-3:8b' });

    status = await ai.status();
    expect(status).toMatchObject({ ready: true, headline: 'Prête' });
    expect(await generation.capabilities()).toMatchObject({ ready: true, engineLabel: 'Magistra Léger', privacy: { level: 'local' } });

    const events = await run(REQUEST);
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.content).toContain('# Cours : Apprentissage automatique');
    expect(done.content).toContain('[S1]');
    expect(done.sources.map(s => s.docName)).toEqual(['cours.md']);
    expect(done.saved).toBe(true);
    expect((await store.list({ favoritesOnly: false, limit: 10 })).items).toHaveLength(1);
  });

  it('mémoire insuffisante et modèle absent : erreurs claires', async () => {
    const oom = await setup(await startMock(['--models', 'ministral-3:8b,ministral-3:14b', '--oom']));
    await oom.ai.setConfig({ tier: 'standard' });
    const e1 = (await oom.run(REQUEST)).at(-1);
    expect(e1).toMatchObject({ type: 'error', code: 'OUT_OF_MEMORY', message: expect.stringContaining('Magistra Léger') });

    const missing = await setup(await startMock(['--models', 'ministral-3:14b', '--missing-model']));
    const e2 = (await missing.run(REQUEST)).at(-1);
    expect(e2).toMatchObject({ type: 'error', code: 'MODEL_NOT_INSTALLED' });

    const unknown = await setup(await startMock(['--unknown-pull']));
    await expect(unknown.ai.pullModel({ tier: 'leger' })).rejects.toMatchObject({ message: expect.stringContaining('introuvable') });
  });
});
