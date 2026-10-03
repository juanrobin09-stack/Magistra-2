// Faux Ollama (scripts/mock-ollama.mjs) : durées en nanosecondes dans le dernier objet du flux, GET /api/ps avec
// size_vram configurable, déchargement par keep_alive 0. Les valeurs sont déterministes ; les mêmes lectures que
// l'application (shared/ai/timings.ts) les interprètent, de bout en bout avec le vrai client HTTP.

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../shared/ai/ollama.js';
import { ollamaTimingsFromChunk, placementFromPs } from '../../shared/ai/timings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL = 'ministral-3:3b';

interface MockServer {
  url: string;
  state: { loaded: Map<string, { numCtx: number }> };
  close(): Promise<void>;
}
type StartMock = (options?: Record<string, unknown>) => Promise<MockServer>;

const servers: MockServer[] = [];
const children: ChildProcess[] = [];

async function start(options: Record<string, unknown> = {}): Promise<{ server: MockServer; options: Record<string, unknown> }> {
  const mod = (await import(pathToFileURL(path.join(root, 'scripts/mock-ollama.mjs')).href)) as { startMockOllama: StartMock };
  // Objet d'options relu à chaque requête : un test peut le modifier pendant que le serveur tourne.
  const opts = { port: 0, models: [MODEL], chatDelayMs: 0, ...options };
  const server = await mod.startMockOllama(opts);
  servers.push(server);
  return { server, options: opts };
}

afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});
afterAll(() => {
  for (const c of children) c.kill();
});

const MESSAGES = [{ role: 'user' as const, content: 'Un cours sur les fractions pour une classe de sixième, avec des exemples.' }];

async function chat(url: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: MESSAGES, stream: true, think: false, options: { num_ctx: 8_192 }, ...body }),
  });
  const lines = (await res.text()).split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l) as Record<string, unknown>);
}

const ps = async (url: string) => (await fetch(`${url}/api/ps`)).json() as Promise<{ models: Record<string, unknown>[] }>;

describe('faux Ollama — durées du dernier objet (nanosecondes)', () => {
  it('total, chargement, lecture et rédaction, déterministes, lues juste par ollamaTimingsFromChunk', async () => {
    const { server } = await start({ vram: 'none' });
    const first = (await chat(server.url)).at(-1)!;
    expect(first).toMatchObject({ done: true, done_reason: 'stop' });
    for (const key of ['total_duration', 'load_duration', 'prompt_eval_duration', 'eval_duration']) {
      expect(Number.isInteger(first[key]) && (first[key] as number) > 1_000_000, key).toBe(true);
    }
    const timings = ollamaTimingsFromChunk(first)!;
    // Chargement à froid : 1,8 s ; lecture à 80 jetons/s ; rédaction à 9 jetons/s (processeur).
    expect(timings.loadMs).toBe(1_800);
    expect(timings.promptTokensPerSecond).toBeCloseTo(80, 0);
    expect(timings.tokensPerSecond).toBeCloseTo(9, 0);
    expect(timings.promptTokens).toBe(first.prompt_eval_count);
    expect(timings.outputTokens).toBe(first.eval_count);
    expect(timings.totalMs).toBeGreaterThan(timings.loadMs! + timings.promptMs! + timings.outputMs! - 5);

    // Même demande : même durée de rédaction ; presque tout est déjà en mémoire (moins à lire) ; le modèle est chargé,
    // le chargement n'est plus qu'un rappel.
    const second = ollamaTimingsFromChunk((await chat(server.url)).at(-1)!)!;
    expect(second.promptMs).toBeLessThan(timings.promptMs! / 10);
    expect(second.outputMs).toBe(timings.outputMs);
    expect(second.loadMs).toBe(12);
  });

  it('cache de préfixe : le début commun avec la requête précédente est « déjà en mémoire », hors de la vitesse de lecture', async () => {
    const { server } = await start({ vram: 'none' });
    const long = { messages: [{ role: 'user', content: `${'Paragraphe de cours. '.repeat(60)}Question A` }] };
    const first = (await chat(server.url, long)).at(-1)!;
    expect(first.prompt_eval_cached_count).toBe(0);
    const again = (await chat(server.url, { messages: [{ role: 'user', content: `${'Paragraphe de cours. '.repeat(60)}Question B` }] })).at(-1)!;
    expect(again.prompt_eval_count).toBe(first.prompt_eval_count);
    expect(again.prompt_eval_cached_count as number).toBeGreaterThan(350);
    expect(again.prompt_eval_duration as number).toBeLessThan((first.prompt_eval_duration as number) / 10);
    // Lue en tenant compte du cache, la vitesse reste celle du moteur (80 jetons/s), pas un chiffre gonflé.
    expect(ollamaTimingsFromChunk(again)?.promptTokensPerSecond).toBeCloseTo(80, 0);
    // Rechargement (autre contexte) : le cache est vidé.
    const reloaded = (await chat(server.url, { ...long, options: { num_ctx: 4_096 } })).at(-1)!;
    expect(reloaded.prompt_eval_cached_count).toBe(0);
  });

  it('la vitesse suit l’emplacement : processeur < partagé < carte graphique', async () => {
    const speeds: number[] = [];
    for (const vram of ['none', 'partial', 'full']) {
      const { server } = await start({ vram });
      speeds.push(ollamaTimingsFromChunk((await chat(server.url)).at(-1)!)!.tokensPerSecond!);
      await server.close();
      servers.pop();
    }
    expect(speeds[0]).toBeLessThan(speeds[1]);
    expect(speeds[1]).toBeLessThan(speeds[2]);
  });

  it('délai de chargement à froid (--load-ms) annoncé dans load_duration, une seule fois', async () => {
    const { server } = await start({ loadMs: 40 });
    const cold = ollamaTimingsFromChunk((await chat(server.url)).at(-1)!)!;
    expect(cold.loadMs).toBe(1_840);
    expect(ollamaTimingsFromChunk((await chat(server.url)).at(-1)!)!.loadMs).toBe(12);
  });

  it('préchargement (messages vides) : durées de chargement dans la réponse JSON, modèle chargé ensuite', async () => {
    const { server } = await start();
    expect((await ps(server.url)).models).toEqual([]);
    const res = await (await fetch(`${server.url}/api/chat`, {
      method: 'POST', body: JSON.stringify({ model: MODEL, messages: [], stream: false, options: { num_ctx: 4_096 } }),
    })).json() as Record<string, unknown>;
    expect(res).toMatchObject({ done: true, done_reason: 'load' });
    expect(ollamaTimingsFromChunk(res)?.loadMs).toBe(1_800);
    expect((await ps(server.url)).models).toHaveLength(1);
  });
});

describe('faux Ollama — GET /api/ps', () => {
  it('modèle chargé avec size, size_vram, context_length ; processeur par défaut', async () => {
    const { server } = await start();
    expect((await ps(server.url)).models).toEqual([]);
    await chat(server.url, { options: { num_ctx: 8_192 } });
    const { models } = await ps(server.url);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ name: MODEL, model: MODEL, size_vram: 0, context_length: 8_192 });
    expect(models[0].size).toBe(4_000_000_000 + 8_192 * 100_000);
    expect(typeof models[0].expires_at).toBe('string');
    expect(placementFromPs({ models }, MODEL)).toMatchObject({ processor: 'cpu', gpuPercent: 0, contextTokens: 8_192 });
  });

  it('size_vram configurable : 0, partiel, plein, ou un nombre d’octets ; modifiable en cours de route', async () => {
    const { server, options } = await start({ vram: 'none' });
    await chat(server.url);
    const placement = async () => placementFromPs(await ps(server.url), MODEL);
    expect(await placement()).toMatchObject({ processor: 'cpu' });
    options.vram = 'partial';
    expect(await placement()).toMatchObject({ processor: 'mixed', gpuPercent: 40 });
    options.vram = 'full';
    expect(await placement()).toMatchObject({ processor: 'gpu', gpuPercent: 100 });
    options.vram = 1_000_000_000;
    expect(await placement()).toMatchObject({ processor: 'mixed', sizeVramBytes: 1_000_000_000 });
  });

  it('--no-ps : 404 comme un moteur qui ne connaît pas /api/ps', async () => {
    const { server } = await start({ noPs: true });
    expect((await fetch(`${server.url}/api/ps`)).status).toBe(404);
  });

  it('keep_alive 0 (POST /api/generate) décharge le modèle : il n’est plus listé et le chargement redevient à froid', async () => {
    const { server } = await start();
    await chat(server.url);
    expect((await ps(server.url)).models).toHaveLength(1);
    const unload = await (await fetch(`${server.url}/api/generate`, {
      method: 'POST', body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
    })).json();
    expect(unload).toMatchObject({ done: true, done_reason: 'unload' });
    expect((await ps(server.url)).models).toEqual([]);
    expect(ollamaTimingsFromChunk((await chat(server.url)).at(-1)!)?.loadMs).toBe(1_800);
    // Modèle inconnu : 404.
    const missing = await fetch(`${server.url}/api/generate`, { method: 'POST', body: JSON.stringify({ model: 'absent:1b', keep_alive: 0 }) });
    expect(missing.status).toBe(404);
  });
});

describe('faux Ollama — de bout en bout avec le client de Magistra', () => {
  it('OllamaProvider.stream : durées du moteur et placement joints à la fin, selon --vram', async () => {
    for (const [vram, processor] of [['none', 'cpu'], ['partial', 'mixed'], ['full', 'gpu']] as const) {
      const { server } = await start({ vram, chatDelayMs: 25 });
      const provider = new OllamaProvider({ baseUrl: server.url, model: MODEL, contextTokens: 8_192 });
      await provider.preload();
      let end: { usage?: { timings?: { loadMs?: number; tokensPerSecond?: number }; placement?: { processor: string; contextTokens?: number }; timeToFirstDeltaMs?: number } } | undefined;
      for await (const event of provider.stream({ messages: MESSAGES })) if (event.type === 'end') end = event;
      expect(end?.usage?.placement, vram).toMatchObject({ processor, contextTokens: 8_192 });
      // Modèle préchargé : le chargement dans la requête de rédaction n'est plus qu'un rappel.
      expect(end?.usage?.timings?.loadMs).toBe(12);
      expect(end?.usage?.timings?.tokensPerSecond).toBeGreaterThan(0);
      expect(end?.usage?.timeToFirstDeltaMs).toBeGreaterThanOrEqual(0);
      await server.close();
      servers.pop();
    }
  });

  it('processus séparé : --vram et --no-ps en ligne de commande', async () => {
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/mock-ollama.mjs'), '--port', '0', '--models', MODEL, '--chat-delay-ms', '0', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
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
    const partial = await run(['--vram', 'partial']);
    await chat(partial);
    expect(placementFromPs(await ps(partial), MODEL)).toMatchObject({ processor: 'mixed', gpuPercent: 40 });
    const bytes = await run(['--vram', '2000000000']);
    await chat(bytes);
    expect(placementFromPs(await ps(bytes), MODEL)).toMatchObject({ processor: 'mixed', sizeVramBytes: 2_000_000_000 });
    const none = await run(['--no-ps']);
    expect((await fetch(`${none}/api/ps`)).status).toBe(404);
  });
});
