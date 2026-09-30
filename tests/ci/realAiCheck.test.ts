// scripts/real-ai-check.mjs (npm run test:real-ai) : options, vérifications de contenu, puis exécution RÉELLE du
// script (compilation du cœur par esbuild, vrais fournisseurs, vraie chaîne runGeneration) contre un petit serveur
// qui imite Ollama (API native NDJSON et /v1 SSE). La validation avec un vrai modèle est faite par
// .github/workflows/real-ai.yml ; ici, on vérifie que le script lui-même est juste.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'real-ai-check.mjs');
const dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-real-ai-'));

interface Citations { cited: number[]; citedInBody: boolean; citesS1: boolean; sourcesSection: boolean; listsDocument: boolean; strayCitations: number[] }
interface ScriptModule {
  DEFAULTS: { url: string; model: string; contextTokens: number; timeoutS: number; attempts: number };
  DOC_NAME: string;
  parseArgs(argv: string[], env?: Record<string, string>): Record<string, unknown> & { baseUrl: string; model: string; timeoutMs: number; attempts: number; apiKey?: string };
  normalizeBaseUrl(raw: string): string;
  displayUrl(raw: string): string;
  looksFrench(text: string): boolean;
  inspectCitations(content: string, docName: string, providedCount?: number): Citations;
}

let mod: ScriptModule;
beforeAll(async () => {
  mod = (await import(pathToFileURL(script).href)) as ScriptModule;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('options', () => {
  it('valeurs par défaut : Ollama local, ministral-3:3b, délais généreux', () => {
    const o = mod.parseArgs([], {});
    expect(o).toMatchObject({ baseUrl: 'http://127.0.0.1:11434', model: 'ministral-3:3b', contextTokens: 12_288, timeoutMs: 900_000, attempts: 2 });
  });

  it('REAL_AI_URL et REAL_AI_MODEL, puis la ligne de commande qui l’emporte', () => {
    const env = { REAL_AI_URL: 'http://gpu.lan:11434/v1/', REAL_AI_MODEL: 'ministral-3:8b', REAL_AI_TIMEOUT_S: '60' };
    expect(mod.parseArgs([], env)).toMatchObject({ baseUrl: 'http://gpu.lan:11434', model: 'ministral-3:8b', timeoutMs: 60_000 });
    expect(mod.parseArgs(['--url', 'http://127.0.0.1:11501', '--model', 'qwen3:0.6b'], env)).toMatchObject({ baseUrl: 'http://127.0.0.1:11501', model: 'qwen3:0.6b' });
  });

  it('options invalides : message clair en français', () => {
    expect(() => mod.parseArgs(['--url', 'ftp://x'])).toThrow(/http:\/\/ ou https:\/\//);
    expect(() => mod.parseArgs(['--url', 'pas une adresse'])).toThrow(/illisible/);
    expect(() => mod.parseArgs(['--model'])).toThrow(/attend une valeur/);
    expect(() => mod.parseArgs(['--vite'])).toThrow(/Option inconnue/);
    expect(() => mod.parseArgs([], { REAL_AI_TIMEOUT_S: 'dix' })).toThrow(/nombre entier/);
    expect(() => mod.parseArgs(['--model', 'modèle; rm -rf /'])).toThrow(/Nom de modèle invalide/);
  });

  it('adresse affichée sans identifiants', () => {
    expect(mod.displayUrl('https://moi:secret@ia.exemple.fr:8443/ollama')).toBe('https://ia.exemple.fr:8443/ollama');
    expect(mod.normalizeBaseUrl('https://ia.exemple.fr/ollama/v1?x=1#y')).toBe('https://ia.exemple.fr/ollama');
  });
});

describe('vérifications de contenu', () => {
  it('reconnaît un texte en français', () => {
    expect(mod.looksFrench("Les élèves sauront comparer des fractions et les placer sur une droite graduée.")).toBe(true);
    expect(mod.looksFrench('Students will compare fractions and place them on a number line.')).toBe(false);
    expect(mod.looksFrench('')).toBe(false);
  });

  it('citation [S1] dans le corps, section « Sources utilisées » avec le document', () => {
    const ok = `# Cours\n\nL'eau s'évapore [S1].\n\n---\n\n## Sources utilisées\n\n- [S1] ${mod.DOC_NAME} — lignes 1 à 14\n`;
    expect(mod.inspectCitations(ok, mod.DOC_NAME, 1)).toEqual({
      cited: [1], citedInBody: true, citesS1: true, sourcesSection: true, listsDocument: true, strayCitations: [],
    });
    // Une citation qui ne figure que dans la liste finale ne compte pas comme citée dans le texte.
    const listOnly = `# Cours\n\nTexte.\n\n## Sources utilisées\n\n- [S1] ${mod.DOC_NAME}\n`;
    expect(mod.inspectCitations(listOnly, mod.DOC_NAME, 1)).toMatchObject({ citedInBody: false, sourcesSection: true });
    // Numéro hors des sources fournies : signalé (la pipeline doit l'avoir retiré).
    expect(mod.inspectCitations('Texte [S4].', mod.DOC_NAME, 1)).toMatchObject({ citedInBody: false, strayCitations: [4] });
  });
});

// ─── Faux Ollama (API native + /v1), pour exécuter le script de bout en bout ───

interface FakeOptions { models?: string[]; fence?: boolean; neverCite?: boolean; key?: string }
interface Fake { url: string; seenAuth: Set<string>; chats: number; close(): Promise<void> }

const SHORT_REPLY = "Les élèves sauront comparer deux fractions simples et les placer sur une droite graduée.";

function citedReply(fence: boolean, neverCite: boolean): string {
  const body = [
    "# Le cycle de l'eau",
    '',
    `L'eau des océans s'évapore sous l'effet de la chaleur du Soleil${neverCite ? '' : ' [S1, p. 2]'}.`,
    `La vapeur se condense en nuages, puis retombe en précipitations${neverCite ? '' : ' [S1]'}. Une étude inventée [S5] est retirée.`,
  ].join('\n');
  return fence ? `\`\`\`markdown\n${body}\n\`\`\`\n` : body;
}

async function startFake(opts: FakeOptions = {}): Promise<Fake> {
  const models = opts.models ?? ['ministral-3:3b', 'qwen3:0.6b'];
  const seenAuth = new Set<string>();
  const state = { chats: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      if (req.headers.authorization) seenAuth.add(req.headers.authorization);
      if (opts.key && req.headers.authorization !== `Bearer ${opts.key}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; messages?: { content: string }[]; stream?: boolean } : {};
      const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      const known = (m?: string) => models.some(n => n === m || n === `${m}:latest`);
      if (url.pathname === '/api/version') return json(200, { version: '0.34.4' });
      if (url.pathname === '/api/tags') return json(200, { models: models.map(name => ({ name, model: name, size: 3_000_000_000 })) });
      if (url.pathname === '/v1/models') return json(200, { object: 'list', data: models.map(id => ({ id, object: 'model' })) });
      if (url.pathname === '/api/chat') {
        if (!known(body.model)) return json(404, { error: `model '${body.model}' not found` });
        const messages = body.messages ?? [];
        if (messages.length === 0) return json(200, { model: body.model, done: true, done_reason: 'load' });
        state.chats++;
        const withSources = messages.some(m => m.content.includes('[S1]'));
        const reply = withSources ? citedReply(Boolean(opts.fence), Boolean(opts.neverCite)) : SHORT_REPLY;
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (let i = 0; i < reply.length; i += 20) res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: reply.slice(i, i + 20) }, done: false })}\n`);
        res.end(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 40, eval_count: 30 })}\n`);
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        if (!known(body.model)) return json(404, { error: { message: `model "${body.model}" not found`, type: 'not_found_error' } });
        state.chats++;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (let i = 0; i < SHORT_REPLY.length; i += 20) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: SHORT_REPLY.slice(i, i + 20) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      json(404, { error: 'not found' });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seenAuth,
    get chats() { return state.chats; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** Lance le script dans un processus séparé (comme « npm run test:real-ai ») ; le faux serveur reste dans ce processus. */
function run(env: Record<string, string>, args: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('REAL_AI_') && k !== 'GITHUB_ACTIONS'));
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...clean, REAL_AI_TIMEOUT_S: '20', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { out += String(d); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
  });
}

describe('exécution de bout en bout (faux Ollama)', () => {
  it('tout passe : API native, /v1, chaîne complète avec citation [S1] et « Sources utilisées »', async () => {
    const fake = await startFake();
    try {
      const report = path.join(dir, 'ok.json');
      const { code, out } = await run({ REAL_AI_URL: fake.url, REAL_AI_MODEL: 'ministral-3:3b' }, ['--report', report]);
      expect(out, out).toContain('Résultat : tout fonctionne avec la vraie IA.');
      expect(code).toBe(0);
      for (const text of ['✓ Version d\'Ollama : 0.34.4', '2. Même Ollama par /v1', '✓ Sources numérotées : [S1] cycle-de-l-eau.txt',
        'loading_model → generating → finalizing', '✓ Citation [S1] vérifiée dans le texte', '✓ Section « Sources utilisées » : [S1] cycle-de-l-eau.txt']) {
        expect(out).toContain(text);
      }
      const json = JSON.parse(readFileSync(report, 'utf8')) as { result: { failures: number }; samples: { pipeline: { content: string } } };
      expect(json.result.failures).toBe(0);
      expect(json.samples.pipeline.content).not.toContain('[S5]');
    } finally {
      await fake.close();
    }
  });

  it('réponse entourée de « ```markdown » (petits modèles) : citations quand même vérifiées', async () => {
    const fake = await startFake({ fence: true });
    try {
      const { code, out } = await run({ REAL_AI_URL: fake.url });
      expect(out, out).toContain('✓ Section « Sources utilisées »');
      expect(code).toBe(0);
    } finally {
      await fake.close();
    }
  });

  it('modèle qui ne cite jamais : nouvel essai, puis échec explicite', async () => {
    const fake = await startFake({ neverCite: true });
    try {
      const { code, out } = await run({ REAL_AI_URL: fake.url, REAL_AI_ATTEMPTS: '2' });
      expect(out).toContain('! Citation [S1] vérifiée (essai 1/2) : le modèle n\'a pas cité le document : nouvel essai');
      expect(out).toContain('✗ Citation [S1] vérifiée (essai 2/2)');
      expect(code).toBe(1);
    } finally {
      await fake.close();
    }
  });

  it('modèle absent : échec avec la liste des modèles et la commande à lancer', async () => {
    const fake = await startFake({ models: ['qwen3:0.6b'] });
    try {
      const { code, out } = await run({ REAL_AI_URL: fake.url, REAL_AI_MODEL: 'ministral-3:3b' });
      expect(out).toContain('ollama pull ministral-3:3b');
      expect(out).toContain('✗');
      expect(code).toBe(1);
    } finally {
      await fake.close();
    }
  });

  it('Ollama arrêté : message clair, sans génération', async () => {
    const fake = await startFake();
    const url = fake.url;
    await fake.close();
    const { code, out } = await run({ REAL_AI_URL: url });
    expect(out).toContain(`Ollama ne répond pas à ${url}`);
    expect(out).toContain('corrigez REAL_AI_URL');
    expect(code).toBe(1);
  });

  it('clé de proxy : envoyée au serveur, jamais affichée ni écrite dans le rapport', async () => {
    const key = 'cle-proxy-tres-secrete-123';
    const fake = await startFake({ key });
    try {
      const report = path.join(dir, 'cle.json');
      const { code, out } = await run({ REAL_AI_URL: fake.url, REAL_AI_API_KEY: key, REAL_AI_REPORT: report });
      expect(out, out).toContain('Clé de proxy : fournie (masquée).');
      expect(code).toBe(0);
      expect(fake.seenAuth).toEqual(new Set([`Bearer ${key}`]));
      expect(out).not.toContain(key);
      expect(readFileSync(report, 'utf8')).not.toContain(key);
    } finally {
      await fake.close();
    }
  });

  it('options invalides : code 2', async () => {
    const { code, out } = await run({}, ['--timeout-s', '0']);
    expect(code).toBe(2);
    expect(out).toContain('Usage : npm run test:real-ai');
  });
});
