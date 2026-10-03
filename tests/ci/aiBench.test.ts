// scripts/ai-bench.mjs et scripts/lib/aiBench.mjs : outil du mainteneur (mesure de la lenteur d'un Ollama). Fonctions
// pures (arguments, demandes synthétiques, médianes, tableau, lecture des durées et de /api/ps), accord avec les lectures
// de l'application (shared/ai/timings.ts), puis exécution RÉELLE contre le faux Ollama (HTTP) et en processus séparé.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isLoopbackUrl as appIsLoopbackUrl } from '../../shared/ai/loopback';
import { ollamaTimingsFromChunk, placementFromPs as appPlacementFromPs } from '../../shared/ai/timings';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-ai-bench-'));

interface Options {
  url: string; baseUrl: string; model: string; ctx: number[]; runs: number; scenarios: string[]; numPredict: number;
  json?: string; allowRemote: boolean; help: boolean; timeoutMs: number;
}
interface Result {
  ctx: number; scenario: string; estimatedTokens: number; skipped?: string; error?: string;
  runs: Record<string, unknown>[];
  summary: Record<string, unknown> & { okRuns: number; reload: boolean; distinctFingerprints: number };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
interface BenchModule {
  DEFAULTS: { url: string; model: string; ctx: number[]; runs: number; scenarios: string[]; numPredict: number };
  SCENARIOS: Record<string, number>;
  SEED: number;
  TABLE_HEADERS: string[];
  USAGE: string[];
  parseArgs(argv: string[]): Options;
  isLoopbackUrl(url: string): boolean;
  normalizeBaseUrl(url: string): string;
  buildPrompt(scenario: string): { messages: { role: string; content: string }[]; estimatedTokens: number };
  skipReason(ctx: number, estimatedTokens: number, numPredict: number): string | undefined;
  textFingerprint(text: string): string;
  timingsFromFinal(chunk: unknown): Record<string, number> | undefined;
  placementFromPs(body: unknown, model: string): Record<string, number | string> | undefined;
  sameModel(a: string, b: string): boolean;
  median(values: unknown[]): number | undefined;
  mostCommon<T>(values: T[]): T | undefined;
  reloadDetected(ms: unknown): boolean;
  summarizeRuns(runs: Record<string, unknown>[]): Result['summary'];
  placementText(placement: unknown): string;
  tableRows(results: unknown[]): string[][];
  formatTable(headers: string[], rows: string[][]): string;
  createLineSplitter(): { push(chunk: string): string[]; flush(): string[] };
  runBench(opts: Options, io?: Record<string, any>): Promise<{ version: string; results: Result[] }>;
  buildReport(opts: Options, version: string, results: unknown[], now?: Date): Record<string, any>;
}
interface CliModule {
  main(argv: string[], out?: (line: string) => void): Promise<number>;
}
interface MockServer { url: string; state: { requests: string[]; loaded: Map<string, unknown> }; close(): Promise<void> }

let bench: BenchModule;
let cli: CliModule;
let startMock: (options?: Record<string, unknown>) => Promise<MockServer>;
const servers: MockServer[] = [];

beforeAll(async () => {
  bench = (await import(pathToFileURL(path.join(root, 'scripts/lib/aiBench.mjs')).href)) as BenchModule;
  cli = (await import(pathToFileURL(path.join(root, 'scripts/ai-bench.mjs')).href)) as CliModule;
  startMock = ((await import(pathToFileURL(path.join(root, 'scripts/mock-ollama.mjs')).href)) as { startMockOllama: typeof startMock }).startMockOllama;
});
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function mock(options: Record<string, unknown> = {}): Promise<MockServer> {
  const server = await startMock({ port: 0, models: ['ministral-3:3b'], chatDelayMs: 0, ...options });
  servers.push(server);
  return server;
}

const opts = (argv: string[] = []) => bench.parseArgs(argv);

describe('arguments', () => {
  it('valeurs par défaut : Ollama local, ministral-3:3b, contexte 12 288, une exécution, scénario court', () => {
    expect(opts()).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434', model: 'ministral-3:3b', ctx: [12_288], runs: 1, scenarios: ['court'], numPredict: 128, allowRemote: false, help: false,
    });
    expect(opts().json).toBeUndefined();
  });

  it('toutes les options', () => {
    const o = opts([
      '--url', 'http://localhost:11500/', '--model', 'ministral-3:8b', '--ctx', '4096, 8192,12288,8192', '--runs', '3',
      '--scenario', 'court,long', '--num-predict', '64', '--json', 'sortie.json',
    ]);
    expect(o).toMatchObject({
      baseUrl: 'http://localhost:11500', model: 'ministral-3:8b', ctx: [4_096, 8_192, 12_288], runs: 3, scenarios: ['court', 'long'], numPredict: 64, json: 'sortie.json',
    });
    expect(opts(['--scenario', 'tous']).scenarios).toEqual(['court', 'moyen', 'long']);
    expect(opts(['--scenario', 'MOYEN']).scenarios).toEqual(['moyen']);
    expect(opts(['--help']).help).toBe(true);
    expect(opts(['-h']).help).toBe(true);
  });

  it('refuse une adresse qui n’est pas celle de cet ordinateur, sauf --allow-remote', () => {
    for (const url of ['http://192.168.1.20:11434', 'https://ia.univ-exemple.fr', 'http://127.0.0.1.nip.io:11434', 'http://127.evil.com']) {
      expect(() => opts(['--url', url])).toThrow(/n'est pas celle de cet ordinateur.*--allow-remote/);
      expect(opts(['--url', url, '--allow-remote']).allowRemote).toBe(true);
    }
    for (const url of ['http://127.0.0.1:11434', 'http://127.1.2.3:1', 'http://localhost:11434', 'http://[::1]:11434']) {
      expect(() => opts(['--url', url])).not.toThrow();
    }
  });

  it('accord avec le prédicat de l’application (shared/ai/loopback.ts)', () => {
    for (const url of ['http://127.0.0.1', 'http://localhost', 'http://[::1]:1', 'http://127.0.0.1.nip.io', 'http://127.evil.com', 'http://10.0.0.1', 'http://127.256.0.1', 'pas une adresse', 'ftp://127.0.0.1', '']) {
      expect(bench.isLoopbackUrl(url), url).toBe(appIsLoopbackUrl(url));
    }
  });

  it('adresses et valeurs invalides : message en français, jamais de secret', () => {
    expect(() => opts(['--url', 'pas une adresse'])).toThrow(/illisible/);
    expect(() => opts(['--url', 'ftp://127.0.0.1'])).toThrow(/http:\/\//);
    expect(() => opts(['--url', 'http://utilisateur:secret@127.0.0.1:11434'])).toThrow(/ni identifiant ni mot de passe/);
    try {
      opts(['--url', 'http://utilisateur:secret@127.0.0.1:11434']);
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
    }
    expect(() => opts(['--ctx', '100'])).toThrow(/entre 512 et/);
    expect(() => opts(['--ctx', 'grand'])).toThrow(/nombre entier/);
    expect(() => opts(['--ctx', ','])).toThrow(/au moins une taille/);
    expect(() => opts(['--ctx', '1000,2000,3000,4000,5000,6000,7000,8000,9000'])).toThrow(/Au plus 8/);
    expect(() => opts(['--runs', '0'])).toThrow(/entre 1 et 20/);
    expect(() => opts(['--runs', '2.5'])).toThrow(/nombre entier/);
    expect(() => opts(['--scenario', 'énorme'])).toThrow(/Scénario inconnu/);
    expect(() => opts(['--scenario', 'toString'])).toThrow(/Scénario inconnu/);
    expect(() => opts(['--num-predict', '5'])).toThrow(/entre 16 et/);
    expect(() => opts(['--model', 'a b'])).toThrow(/Nom de modèle invalide/);
    expect(() => opts(['--model'])).toThrow(/attend une valeur/);
    expect(() => opts(['--json', '--runs', '1'])).toThrow(/attend une valeur/);
    expect(() => opts(['--inconnue'])).toThrow(/Option inconnue/);
  });
});

describe('demandes synthétiques', () => {
  it('trois tailles (~300, ~2 500, ~8 000 jetons), en français, déterministes', () => {
    expect(bench.SCENARIOS).toEqual({ court: 300, moyen: 2_500, long: 8_000 });
    for (const [name, target] of Object.entries(bench.SCENARIOS)) {
      const prompt = bench.buildPrompt(name);
      expect(prompt.estimatedTokens, name).toBeGreaterThan(target * 0.9);
      expect(prompt.estimatedTokens, name).toBeLessThan(target * 1.2);
      expect(prompt.messages.map(m => m.role)).toEqual(['system', 'user']);
      expect(prompt.messages[1].content).toMatch(/Paragraphe 1\. .*\n\nParagraphe 2\./);
      expect(prompt.messages[1].content).toMatch(/Consigne : résume ce document/);
      expect(bench.buildPrompt(name)).toEqual(prompt);
    }
    expect(() => bench.buildPrompt('énorme')).toThrow(/Scénario inconnu/);
  });

  it('aucune donnée réelle : texte fixe, sans nom ni adresse', () => {
    const text = bench.buildPrompt('long').messages.map(m => m.content).join('\n');
    expect(text).not.toMatch(/@|https?:\/\/|\.pdf/);
  });

  it('une combinaison qui ne tient pas dans le contexte est ignorée, avec la raison', () => {
    const long = bench.buildPrompt('long').estimatedTokens;
    expect(bench.skipReason(4_096, long, 128)).toMatch(/^ignoré : la demande \(~\d+ jetons\) et la réponse ne tiennent pas dans 4096 jetons de contexte$/);
    expect(bench.skipReason(12_288, long, 128)).toBeUndefined();
    expect(bench.skipReason(4_096, bench.buildPrompt('court').estimatedTokens, 128)).toBeUndefined();
  });

  it('empreinte : courte, stable, sensible au texte', () => {
    expect(bench.textFingerprint('Bonjour')).toMatch(/^[0-9a-f]{12}$/);
    expect(bench.textFingerprint('Bonjour')).toBe(bench.textFingerprint('Bonjour'));
    expect(bench.textFingerprint('Bonjour')).not.toBe(bench.textFingerprint('Bonjour.'));
  });
});

describe('lecture des mesures : mêmes résultats que l’application (shared/ai/timings.ts)', () => {
  const FINAL = {
    done: true, total_duration: 48_123_456_789, load_duration: 1_234_567_890, prompt_eval_count: 321, prompt_eval_duration: 2_500_000_000,
    eval_count: 45, eval_duration: 4_500_000_000,
  };
  const chunks: unknown[] = [
    FINAL, { ...FINAL, load_duration: 0 }, { ...FINAL, eval_duration: 0 }, { ...FINAL, eval_duration: -1 }, { ...FINAL, eval_duration: '1' },
    { ...FINAL, eval_duration: Number.NaN }, { ...FINAL, total_duration: 9e18 }, { ...FINAL, prompt_eval_count: -3, eval_count: 'x' },
    { eval_count: 2, eval_duration: 400_000 }, { done: true, prompt_eval_count: 5, eval_count: 5 }, {}, null, 42, 'x', [], [FINAL],
    { ...FINAL, prompt_eval_count: 544, prompt_eval_cached_count: 534, prompt_eval_duration: 289_725_000 }, { ...FINAL, prompt_eval_cached_count: 321 },
    { ...FINAL, prompt_eval_cached_count: 999 }, { ...FINAL, prompt_eval_cached_count: 0 }, { ...FINAL, prompt_eval_cached_count: 'x' },
  ];
  it.each(chunks.map((c, i) => [i, c]))('durées, objet %i', (_i, chunk) => {
    expect(bench.timingsFromFinal(chunk)).toEqual(ollamaTimingsFromChunk(chunk));
  });

  const GB = 1_000_000_000;
  const entry = { name: 'ministral-3:3b', model: 'ministral-3:3b', size: 4 * GB, size_vram: 0, context_length: 12_288 };
  const bodies: unknown[] = [
    { models: [entry] }, { models: [{ ...entry, size_vram: 4 * GB }] }, { models: [{ ...entry, size_vram: 1_600_000_000 }] },
    { models: [{ ...entry, size_vram: 3_999_900_000 }] }, { models: [{ ...entry, size_vram: 1 }] }, { models: [{ ...entry, size_vram: undefined }] },
    { models: [{ ...entry, size_vram: null, context_length: -1 }] }, { models: [{ ...entry, size: 0 }] }, { models: [{ ...entry, size_vram: 'x' }] },
    { models: [{ name: 'autre:7b', size: GB, size_vram: GB }, { ...entry, name: 'Ministral-3:LATEST', model: 'x' }] }, { models: [] }, {}, null, 'ps', { models: [null, 4] },
  ];
  it.each(bodies.map((b, i) => [i, b]))('placement, réponse %i', (_i, body) => {
    for (const model of ['ministral-3:3b', 'ministral-3', 'autre:7b', '']) expect(bench.placementFromPs(body, model)).toEqual(appPlacementFromPs(body, model));
  });
});

describe('statistiques et tableau', () => {
  it('médiane : impair, pair, valeurs invalides ignorées, vide', () => {
    expect(bench.median([3, 1, 2])).toBe(2);
    expect(bench.median([4, 1, 3, 2])).toBe(2.5);
    expect(bench.median([5, undefined, Number.NaN, 'x', Number.POSITIVE_INFINITY, 7])).toBe(6);
    expect(bench.median([])).toBeUndefined();
    expect(bench.median([undefined])).toBeUndefined();
    expect(bench.mostCommon(['cpu', 'gpu', 'cpu'])).toBe('cpu');
    expect(bench.mostCommon([undefined])).toBeUndefined();
  });

  it('rechargement : seulement au-delà de 500 ms de chargement à la seconde requête', () => {
    expect(bench.reloadDetected(12)).toBe(false);
    expect(bench.reloadDetected(500)).toBe(false);
    expect(bench.reloadDetected(1_800)).toBe(true);
    expect(bench.reloadDetected(undefined)).toBe(false);
    expect(bench.reloadDetected(Number.NaN)).toBe(false);
  });

  const run = (over: Record<string, unknown> = {}) => ({
    loadMs: 1_800, firstWordMs: 5_000, wallMs: 20_000, fingerprint: 'abc',
    timings: { promptTokens: 300, promptMs: 3_000, promptTokensPerSecond: 100, outputTokens: 100, outputMs: 10_000, tokensPerSecond: 10 },
    placement: { processor: 'cpu', gpuPercent: 0, sizeBytes: 1, sizeVramBytes: 0 }, secondLoadMs: 12, ...over,
  });

  it('synthèse : médianes des durées et des vitesses, placement le plus fréquent, empreintes distinctes', () => {
    const summary = bench.summarizeRuns([
      run(), run({ loadMs: 2_200, timings: { promptTokens: 300, promptMs: 5_000, promptTokensPerSecond: 60, outputTokens: 100, outputMs: 20_000, tokensPerSecond: 5 } }),
      run({ loadMs: 2_000, fingerprint: 'def', placement: { processor: 'gpu', gpuPercent: 100, sizeBytes: 1, sizeVramBytes: 1 } }), { error: '/api/chat : HTTP 500.' },
    ]);
    expect(summary).toMatchObject({
      runs: 4, okRuns: 3, loadMs: 2_000, promptMs: 3_000, promptTokensPerSecond: 100, tokensPerSecond: 10, firstWordMs: 5_000, distinctFingerprints: 2,
      placement: { processor: 'cpu' }, reload: false,
    });
    expect(bench.summarizeRuns([run({ secondLoadMs: 2_000 })]).reload).toBe(true);
    expect(bench.summarizeRuns([{ error: 'x' }])).toMatchObject({ okRuns: 0, loadMs: undefined });
  });

  it('tableau aligné : colonnes séparées, mesures lisibles, combinaisons ignorées ou en échec signalées', () => {
    const ok = { ctx: 12_288, scenario: 'court', estimatedTokens: 311, runs: [], summary: bench.summarizeRuns([run()]) };
    const skipped = { ctx: 4_096, scenario: 'long', estimatedTokens: 8_000, skipped: 'ignoré : trop long', runs: [], summary: bench.summarizeRuns([]) };
    const failed = { ctx: 8_192, scenario: 'moyen', estimatedTokens: 2_500, error: '/api/chat : HTTP 500.', runs: [], summary: bench.summarizeRuns([{ error: 'x' }]) };
    const rows = bench.tableRows([ok, skipped, failed]);
    expect(rows[0]).toEqual(['12288', 'court (~311)', '1.80 s', '300 j · 3.00 s · 100.0 j/s', '100 j · 10.0 s · 10.0 j/s', '5.00 s', 'processeur', 'abc', 'non']);
    expect(rows[1][2]).toBe('ignoré : trop long');
    expect(rows[2][2]).toBe('échec : /api/chat : HTTP 500.');
    for (const row of rows) expect(row).toHaveLength(bench.TABLE_HEADERS.length);
    const table = bench.formatTable(bench.TABLE_HEADERS, rows).split('\n');
    expect(table[0]).toMatch(/^contexte \| scénario\s+\| chargement/);
    expect(table[1]).toMatch(/^-+(-\+-+)+$/);
    expect(table).toHaveLength(2 + rows.length);
    const cached = { ctx: 12_288, scenario: 'court', estimatedTokens: 311, runs: [], summary: bench.summarizeRuns([run({ timings: { promptTokens: 544, promptCachedTokens: 534, promptMs: 290, promptTokensPerSecond: 34.5, outputTokens: 10, outputMs: 1_000, tokensPerSecond: 10 } })]) };
    expect(bench.tableRows([cached])[0][3]).toBe('10 j · 0.29 s · 34.5 j/s (+534 en mémoire)');
    expect(bench.placementText({ processor: 'mixed', gpuPercent: 40 })).toBe('partagé (40 % carte)');
    expect(bench.placementText({ processor: 'gpu' })).toBe('carte graphique');
    expect(bench.placementText(undefined)).toBe('inconnu');
  });

  it('flux NDJSON : lignes complètes seulement, reste conservé jusqu’au flush', () => {
    const splitter = bench.createLineSplitter();
    expect(splitter.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(splitter.push(':2}\n{"c":3}')).toEqual(['{"b":2}']);
    expect(splitter.flush()).toEqual(['{"c":3}']);
    expect(splitter.flush()).toEqual([]);
  });
});

describe('exécution contre le faux Ollama (HTTP réel)', () => {
  const run = async (url: string, argv: string[] = []) => {
    const options = opts(['--url', url, '--model', 'ministral-3:3b', '--num-predict', '64', ...argv]);
    return bench.runBench(options);
  };

  it('court, contexte 12 288 : chargement à froid, lecture, rédaction, placement, empreinte, aucun rechargement', async () => {
    const server = await mock({ vram: 'none' });
    const { version, results } = await run(server.url, ['--ctx', '12288', '--scenario', 'court']);
    expect(version).toMatch(/mock/);
    expect(results).toHaveLength(1);
    const [r] = results;
    expect(r).toMatchObject({ ctx: 12_288, scenario: 'court' });
    expect(r.error).toBeUndefined();
    expect(r.summary).toMatchObject({ okRuns: 1, loadMs: 1_800, placement: { processor: 'cpu', gpuPercent: 0, contextTokens: 12_288 }, reload: false, distinctFingerprints: 1 });
    expect(r.summary.tokensPerSecond).toBeCloseTo(9, 0);
    expect(r.summary.promptTokensPerSecond).toBeCloseTo(80, 0);
    expect(r.summary.promptTokens).toBeGreaterThan(200);
    expect(r.summary.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(r.summary.firstWordMs).toBeGreaterThanOrEqual(0);
    // Déchargé avant la mesure, jamais téléchargé.
    expect(server.state.requests).toContain('POST /api/generate');
    expect(server.state.requests.some(q => q.includes('/api/pull'))).toBe(false);
  });

  it('placement relevé : processeur, partagé, carte graphique ; vitesse plus élevée avec la carte', async () => {
    const speeds: number[] = [];
    for (const [vram, processor] of [['none', 'cpu'], ['partial', 'mixed'], ['full', 'gpu']] as const) {
      const server = await mock({ vram });
      const { results } = await run(server.url, ['--scenario', 'court']);
      expect(results[0].summary.placement, vram).toMatchObject({ processor });
      speeds.push(results[0].summary.tokensPerSecond as number);
      await server.close();
      servers.pop();
    }
    expect(speeds[0]).toBeLessThan(speeds[1]);
    expect(speeds[1]).toBeLessThan(speeds[2]);
  });

  it('plusieurs contextes et scénarios, plusieurs exécutions : médianes ; une combinaison trop grande est ignorée', async () => {
    const server = await mock();
    const { results } = await run(server.url, ['--ctx', '4096,12288', '--scenario', 'court,long', '--runs', '2']);
    expect(results.map(r => [r.ctx, r.scenario, r.skipped ? 'ignorée' : 'mesurée'])).toEqual([
      [4_096, 'court', 'mesurée'], [4_096, 'long', 'ignorée'], [12_288, 'court', 'mesurée'], [12_288, 'long', 'mesurée'],
    ]);
    expect(results[0].runs).toHaveLength(2);
    expect(results[0].summary).toMatchObject({ runs: 2, okRuns: 2, distinctFingerprints: 1 });
    expect(results[1].skipped).toMatch(/4096 jetons de contexte/);
    // Mêmes réglages, même texte : empreinte identique d'une exécution à l'autre.
    expect(new Set(results[3].runs.map(x => x.fingerprint)).size).toBe(1);
  });

  it('rechargement détecté : la seconde requête change de contexte, le moteur recharge le modèle', async () => {
    const server = await mock();
    const options = opts(['--url', server.url, '--model', 'ministral-3:3b', '--ctx', '8192', '--scenario', 'court']);
    const io = {
      fetch: (url: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { options?: { num_predict?: number; num_ctx?: number } }) : undefined;
        if (body?.options?.num_predict === 1 && init) return fetch(url, { ...init, body: JSON.stringify({ ...body, options: { ...body.options, num_ctx: 9_999 } }) });
        return fetch(url, init);
      },
    };
    const { results } = await bench.runBench(options, io);
    expect(results[0].summary.reload).toBe(true);
    expect((await bench.runBench(options)).results[0].summary.reload).toBe(false);
  });

  it('requêtes de mesure : graine fixe, température 0, réponse bornée, contexte demandé, aucun autre hôte', async () => {
    const server = await mock();
    const seen: { path: string; method: string; body?: Record<string, any> }[] = [];
    const io = {
      fetch: (url: string, init?: RequestInit) => {
        expect(url.startsWith(server.url)).toBe(true);
        seen.push({ path: url.slice(server.url.length), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        return fetch(url, init);
      },
    };
    const options = opts(['--url', server.url, '--model', 'ministral-3:3b', '--ctx', '8192', '--scenario', 'court', '--num-predict', '48']);
    await bench.runBench(options, io);
    const chats = seen.filter(r => r.path === '/api/chat').map(r => r.body!);
    // Préchargement (messages vides), génération mesurée, seconde requête (rechargement ?).
    expect(chats).toHaveLength(3);
    expect(chats[0]).toMatchObject({ messages: [], stream: false, options: { num_ctx: 8_192 } });
    for (const body of chats.slice(1)) {
      expect(body).toMatchObject({ model: 'ministral-3:3b', stream: true, think: false, options: { num_ctx: 8_192, temperature: 0, seed: 42 } });
    }
    expect(chats[1].options.num_predict).toBe(48);
    expect(chats[2].options.num_predict).toBe(1);
    expect(seen.find(r => r.path === '/api/generate')?.body).toEqual({ model: 'ministral-3:3b', keep_alive: 0 });
    // Seuls des chemins d'Ollama sont appelés ; jamais de téléchargement.
    expect(new Set(seen.map(r => r.path))).toEqual(new Set(['/api/version', '/api/tags', '/api/generate', '/api/ps', '/api/chat']));
  });

  it('une exécution en échec est notée, sans arrêter les autres combinaisons', async () => {
    const server = await mock({ oom: true });
    const { results } = await run(server.url, ['--scenario', 'court,moyen']);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.summary.okRuns).toBe(0);
      expect(r.error).toMatch(/\/api\/chat : HTTP 500/);
    }
  });

  it('moteur arrêté, modèle absent, adresse qui n’est pas Ollama : message clair avant toute mesure, rien de téléchargé', async () => {
    const server = await mock();
    await expect(bench.runBench(opts(['--url', server.url, '--model', 'ministral-3:14b']))).rejects.toThrow(/ministral-3:14b n'est pas installé.*rien n'est téléchargé/);
    expect(server.state.requests.some(q => q.includes('/api/pull') || q.includes('/api/chat'))).toBe(false);
    await expect(bench.runBench(opts(['--url', 'http://127.0.0.1:9']), { fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } }))
      .rejects.toThrow(/Ollama ne répond pas \(ECONNREFUSED\)/);
  });

  it('rapport JSON : paramètres et mesures, jamais le texte produit ni l’adresse du moteur', async () => {
    const server = await mock();
    const options = opts(['--url', server.url, '--model', 'ministral-3:3b', '--scenario', 'court']);
    const { version, results } = await bench.runBench(options);
    const report = bench.buildReport(options, version, results, new Date('2026-10-03T10:00:00Z'));
    expect(report).toMatchObject({ generatedAt: '2026-10-03T10:00:00.000Z', model: 'ministral-3:3b', local: true, ctx: [12_288], runs: 1, seed: 42 });
    const json = JSON.stringify(report);
    expect(json).not.toContain('http://');
    expect(json).not.toContain('Cours');
    expect(json).not.toContain('Paragraphe');
    expect(json).toContain('fingerprint');
  });
});

describe('ligne de commande', () => {
  it('main : tableau, fichier JSON, code 0', async () => {
    const server = await mock({ vram: 'full' });
    const file = path.join(dir, 'bench.json');
    const lines: string[] = [];
    const code = await cli.main(['--url', server.url, '--model', 'ministral-3:3b', '--ctx', '12288', '--scenario', 'court', '--runs', '1', '--json', file], l => lines.push(l));
    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('contexte | scénario');
    expect(out).toContain('carte graphique');
    expect(out).toContain('Graine 42');
    expect(out).toContain('inference compute');
    const report = JSON.parse(readFileSync(file, 'utf8')) as { results: { summary: { placement: { processor: string } } }[] };
    expect(report.results[0].summary.placement.processor).toBe('gpu');
  });

  it('processeur seul : pas de réserve sur la lecture de /api/ps', async () => {
    const server = await mock({ vram: 'none' });
    const lines: string[] = [];
    expect(await cli.main(['--url', server.url, '--model', 'ministral-3:3b', '--scenario', 'court'], l => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toContain('processeur');
    expect(lines.join('\n')).not.toContain('inference compute');
  });

  it('options invalides : code 2 et aide ; aide demandée : code 0 ; adresse distante refusée : code 2', async () => {
    const lines: string[] = [];
    expect(await cli.main(['--ctx', '12'], l => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toMatch(/entre 512 et.*Usage : node scripts\/ai-bench\.mjs/s);
    const help: string[] = [];
    expect(await cli.main(['--help'], l => help.push(l))).toBe(0);
    expect(help.join('\n')).toContain('--allow-remote');
    const remote: string[] = [];
    expect(await cli.main(['--url', 'http://10.1.2.3:11434'], l => remote.push(l))).toBe(2);
    expect(remote.join('\n')).toContain('--allow-remote');
  });

  it('moteur injoignable ou modèle absent : code 1, message clair', async () => {
    const server = await mock();
    const lines: string[] = [];
    expect(await cli.main(['--url', server.url, '--model', 'absent:1b'], l => lines.push(l))).toBe(1);
    expect(lines.join('\n')).toMatch(/Mesure impossible : Le modèle absent:1b n'est pas installé/);
  });

  it('exécution réelle du script en processus séparé', async () => {
    const server = await mock({ vram: 'partial' });
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        path.join(root, 'scripts/ai-bench.mjs'), '--url', server.url, '--model', 'ministral-3:3b', '--ctx', '12288', '--scenario', 'court', '--runs', '1',
      ], { stdio: ['ignore', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', c => {
        stdout += c;
      });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout }));
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('partagé (40 % carte)');
    expect(out.stdout).toMatch(/court \(~\d+\)/);
  }, 60_000);
});
