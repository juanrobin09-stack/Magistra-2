// Détection automatique d'une IA locale (Ollama, LM Studio) pour le serveur autonome et npm run dev.

import { afterEach, describe, expect, it } from 'vitest';
import { MODEL_TIERS } from '../../shared/ai/models.js';
import type { ServerStatus } from '../../shared/apiContract.js';
import { isOllamaCloudName, ollamaDestination } from '../../shared/ai/ollamaRemote.js';
import { loadConfig, maxDocumentCharsFor } from '../../server/config.js';
import { createServerDeps, describeStartup } from '../../server/deps.js';
import { LocalAIDetector, pickTier } from '../../server/localAI.js';
import { MemoryStore } from '../../server/store.js';
import { closedPortUrl, startFakeAI, type FakeAI } from './fakeAI.js';
import { call, fakeVerifier, silentLog, startApi, validRequest, type TestServer } from './helpers.js';

const fakes: FakeAI[] = [];
let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(fakes.splice(0).map(f => f.close()));
});

async function fakeAI(options: Parameters<typeof startFakeAI>[0]): Promise<FakeAI> {
  const f = await startFakeAI(options);
  fakes.push(f);
  return f;
}

describe('LocalAIDetector', () => {
  it('Ollama : niveau Magistra installé sous un alias, modèles d’embedding écartés, contexte du niveau', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['nomic-embed-text:latest', 'ministral-3:latest'] } });
    const result = await new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl(), totalRamGB: 8 }).detect();
    expect(result).toMatchObject({
      found: true, engine: 'ollama', version: '0.34.4', model: 'ministral-3:latest', contextTokens: 12_288,
      label: 'IA locale (Ollama – Magistra Léger)', loaded: false,
      provider: { kind: 'ollama', baseUrl: ollama.url, model: 'ministral-3:latest', modelLabel: 'Magistra Léger', recipient: 'administrateur' },
    });
    expect(result.found && result.summary).toContain('IA locale détectée');
    expect(result.found && result.warnings).toEqual([]);
  });

  it('préférence : modèle déjà chargé, sinon le plus riche qui tient en mémoire', () => {
    const [leger, standard, qualite] = MODEL_TIERS;
    const installed = [{ tier: leger, model: 'ministral-3:8b' }, { tier: standard, model: 'ministral-3:14b' }, { tier: qualite, model: 'mistral-small3.2:24b' }];
    expect(pickTier(installed, ['ministral-3:8b'], 64)).toMatchObject({ model: 'ministral-3:8b', loaded: true });
    expect(pickTier(installed, [], 64)).toMatchObject({ model: 'mistral-small3.2:24b', loaded: false });
    expect(pickTier(installed, [], 16)).toMatchObject({ model: 'ministral-3:14b' });
    expect(pickTier(installed, [], 4)).toMatchObject({ model: 'ministral-3:8b' });
    expect(pickTier([], [], 64)).toBeUndefined();
  });

  it('Ollama sans niveau Magistra : premier modèle de conversation (de préférence chargé), contexte d’un modèle déclaré (12 288)', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['bge-m3:latest', 'llama3.2:3b', 'qwen3:0.6b'], loaded: ['qwen3:0.6b'] } });
    const result = await new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() }).detect();
    expect(result).toMatchObject({ found: true, model: 'qwen3:0.6b', loaded: true, contextTokens: 12_288, label: 'IA locale (Ollama – qwen3:0.6b)' });
    // Même modèle déclaré par AI_MODEL : même contexte (mêmes extraits acceptés, même num_ctx).
    expect(loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:0.6b' }).ai.contextTokens).toBe(12_288);
  });

  it('Ollama sans modèle de conversation : non trouvé, conseil « ollama pull »', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['nomic-embed-text:latest'] } });
    const result = await new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() }).detect();
    expect(result).toMatchObject({ found: false, engine: 'ollama', summary: expect.stringContaining('ollama pull ministral-3:8b') });
  });

  it('Ollama trop ancien : avertissement', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.12.3', models: ['ministral-3:8b'] } });
    const result = await new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() }).detect();
    expect(result.found && result.warnings.join(' ')).toContain('0.13.1');
  });

  it('LM Studio : modèle de conversation chargé choisi (API REST v0), API compatible OpenAI', async () => {
    const lms = await fakeAI({
      lmStudio: [
        { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', state: 'loaded' },
        { id: 'qwen2.5-7b-instruct', type: 'llm', state: 'not-loaded', max_context_length: 32_768 },
        { id: 'mistralai/ministral-3-8b-instruct-2512', type: 'llm', state: 'loaded', max_context_length: 262_144 },
      ],
    });
    const result = await new LocalAIDetector({ ollamaUrl: await closedPortUrl(), lmStudioUrl: lms.url }).detect();
    expect(result).toMatchObject({
      found: true, engine: 'lmstudio', model: 'mistralai/ministral-3-8b-instruct-2512', loaded: true, contextTokens: 8_192,
      provider: { kind: 'openai-compatible', baseUrl: `${lms.url}/v1`, local: true },
    });
  });

  it('LM Studio ancien (sans /api/v0) : repli sur /v1/models', async () => {
    const lms = await fakeAI({ openaiModels: [{ id: 'text-embedding-bge' }, { id: 'phi-4' }] });
    const result = await new LocalAIDetector({ ollamaUrl: await closedPortUrl(), lmStudioUrl: lms.url }).detect();
    expect(result).toMatchObject({ found: true, engine: 'lmstudio', model: 'phi-4' });
  });

  it('rien d’installé : message clair ; nouvelle détection après 5 s ou après invalidate()', async () => {
    let t = 0;
    const closed = await closedPortUrl();
    const detector = new LocalAIDetector({ ollamaUrl: closed, lmStudioUrl: closed, now: () => t });
    const first = await detector.detect();
    expect(first).toMatchObject({ found: false, summary: expect.stringContaining('ollama pull ministral-3:8b') });
    expect(await detector.detect()).toBe(first);
    t += 6_000;
    expect(await detector.detect()).not.toBe(first);
  });

  it('succès mis en cache 30 s', async () => {
    let t = 0;
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:8b'] } });
    const detector = new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl(), now: () => t });
    await detector.detect();
    const probes = ollama.requests.length;
    t += 20_000;
    await detector.detect();
    expect(ollama.requests.length).toBe(probes);
    detector.invalidate();
    await detector.detect();
    expect(ollama.requests.length).toBeGreaterThan(probes);
  });
});

describe('détection dans le serveur', () => {
  it('/api/status : IA locale détectée, fiche locale, extraits adaptés au contexte du niveau ; ligne de démarrage', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:14b'] } });
    const deps = createServerDeps({}, {
      verifier: fakeVerifier, store: new MemoryStore(), log: silentLog,
      localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl(), totalRamGB: 32 },
    });
    expect(deps.localAI).not.toBeNull();
    server = await startApi(deps);
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: true, label: 'IA locale (Ollama – Magistra Standard)', model: 'ministral-3:14b' });
    expect(status.ai.providerInfo).toMatchObject({ thirdParty: false });
    expect(status.maxDocumentChars).toBe(maxDocumentCharsFor(12_288));
    expect((await describeStartup(deps)).join('\n')).toContain('IA locale détectée : Ollama 0.34.4');
  });

  it('rien de détecté : AI_NOT_CONFIGURED avec la marche à suivre, sans adresse interne', async () => {
    const closed = await closedPortUrl();
    const deps = createServerDeps({}, { verifier: fakeVerifier, store: new MemoryStore(), log: silentLog, localAI: { ollamaUrl: closed, lmStudioUrl: closed } });
    server = await startApi(deps);
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: false, code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('ollama pull ministral-3:8b') });
    expect(JSON.stringify(status)).not.toContain('127.0.0.1');
    expect((await describeStartup(deps)).join('\n')).toContain('Aucune IA locale détectée');
  });

  it('génération sans IA détectée : AI_NOT_CONFIGURED et une ligne de journal « Génération échouée »', async () => {
    const closed = await closedPortUrl();
    const logs: string[] = [];
    const deps = createServerDeps({ RATE_LIMIT_PER_MINUTE: '1000' }, {
      verifier: fakeVerifier, store: new MemoryStore(), log: m => logs.push(m), localAI: { ollamaUrl: closed, lmStudioUrl: closed },
    });
    server = await startApi(deps);
    logs.length = 0;
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({
      code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('ollama pull ministral-3:8b'),
    });
    expect(logs).toEqual(['Génération échouée : AI_NOT_CONFIGURED (IA locale (détection automatique), modèle non renseigné)']);
  });

  it('Ollama sans modèle de conversation : ligne de démarrage précise (« ollama pull »), rappel des autres choix', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['nomic-embed-text:latest'] } });
    const deps = createServerDeps({}, {
      verifier: fakeVerifier, store: new MemoryStore(), log: silentLog, localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() },
    });
    const lines = (await describeStartup(deps)).join('\n');
    expect(lines).toContain('Ollama 0.34.4 détecté');
    expect(lines).toContain('« ollama pull ministral-3:8b »');
    expect(lines).toContain('AI_PRESET');
    expect(lines).toContain('AI_BASE_URL et AI_MODEL');
  });

  it('jamais sur Vercel, jamais si AI_AUTODETECT=false ou si une IA est configurée', () => {
    expect(createServerDeps({ VERCEL: '1' }, { log: silentLog }).localAI).toBeNull();
    expect(createServerDeps({ AI_AUTODETECT: 'false' }, { log: silentLog }).localAI).toBeNull();
    expect(createServerDeps({ AI_PRESET: 'ovhcloud' }, { log: silentLog }).localAI).toBeNull();
  });
});

describe('modèles « en ligne » d’Ollama (Ollama Cloud, hôte distant) : jamais présentés comme une IA locale', () => {
  it('noms « cloud » reconnus comme Ollama (dernière partie après « : »)', () => {
    for (const n of ['gpt-oss:120b-cloud', 'kimi-k2.6:cloud', 'gpt-oss:20b:cloud', 'Qwen3.5:CLOUD', ' glm-5.1:cloud ']) expect(isOllamaCloudName(n), n).toBe(true);
    for (const n of ['ministral-3:8b', 'mycloud', 'cloud', 'llama3.1:8b', 'hf.co/x/cloud:q4', '', undefined]) expect(isOllamaCloudName(n), String(n)).toBe(false);
    expect(ollamaDestination('kimi-k2.6:cloud')).toMatchObject({ label: 'Ollama Cloud', thirdParty: true });
    expect(ollamaDestination('assistant:latest', 'http://192.168.1.20:11434')).toMatchObject({ thirdParty: false });
    expect(ollamaDestination('assistant:latest', 'ollama.com:443')).toMatchObject({ label: 'Ollama Cloud', thirdParty: true });
    expect(ollamaDestination('ministral-3:8b')).toBeUndefined();
  });

  it('détection : un modèle local plus ancien est retenu plutôt qu’un modèle cloud plus récent ; hôte distant écarté', async () => {
    const ollama = await fakeAI({
      ollama: {
        version: '0.34.4',
        // Ollama trie par date : le modèle cloud, plus récent, vient en premier.
        models: ['gpt-oss:20b-cloud', 'assistant:latest', 'qwen3:0.6b'],
        remote: { 'gpt-oss:20b-cloud': 'https://ollama.com:443', 'assistant:latest': 'http://127.0.0.1:11679' },
        loaded: ['gpt-oss:20b-cloud'],
      },
    });
    const result = await new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() }).detect();
    expect(result).toMatchObject({ found: true, model: 'qwen3:0.6b' });
  });

  it('seulement des modèles en ligne : rien de retenu, message clair (installer un modèle local), jamais « IA locale » dans /api/status', async () => {
    const ollama = await fakeAI({
      ollama: { version: '0.34.4', models: ['gpt-oss:20b-cloud', 'kimi-k2.6:cloud', 'assistant:latest'], remote: { 'assistant:latest': 'https://relais.example.org' } },
      reply: 'Réponse du NUAGE.',
    });
    const detector = new LocalAIDetector({ ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() });
    const result = await detector.detect();
    expect(result).toMatchObject({ found: false, engine: 'ollama', onlyRemoteModels: true });
    expect(!result.found && result.summary).toContain('seuls des modèles en ligne (Ollama Cloud)');

    const deps = createServerDeps({ RATE_LIMIT_PER_MINUTE: '1000' }, {
      verifier: fakeVerifier, store: new MemoryStore(), log: silentLog, localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() },
    });
    server = await startApi(deps);
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: false, code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('modèles en ligne') });
    expect(status.ai.providerInfo?.thirdParty).not.toBe(false);
    // Aucune génération n'atteint le modèle en ligne.
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(503);
    expect(ollama.requests.filter(r => r.path === '/api/chat')).toEqual([]);
  });

  it('configuration explicite d’un modèle « cloud » sur un Ollama local : fiche « Ollama Cloud », prestataire tiers', () => {
    for (const env of [
      { AI_PRESET: 'ollama', AI_MODEL: 'gpt-oss:120b-cloud' },
      { AI_PROVIDER: 'ollama', AI_BASE_URL: 'http://127.0.0.1:11434', AI_MODEL: 'kimi-k2.6:cloud' },
    ]) {
      const cfg = loadConfig(env);
      expect(cfg.ai.providerInfo, JSON.stringify(env)).toMatchObject({ label: 'Ollama Cloud', thirdParty: true });
      expect(cfg.ai.label).toBe('Ollama Cloud');
      expect(cfg.problems.join('\n')).toContain('modèle en ligne (Ollama Cloud)');
    }
    // Modèle local : inchangé.
    expect(loadConfig({ AI_PRESET: 'ollama' }).ai.providerInfo).toMatchObject({ thirdParty: false });
  });

  it('configuration explicite d’un modèle à hôte distant (remote_host) : /api/status nomme le vrai destinataire', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['assistant:latest'], remote: { 'assistant:latest': 'https://ollama.com:443' } } });
    const logs: string[] = [];
    const deps = createServerDeps({ AI_PROVIDER: 'ollama', AI_BASE_URL: ollama.url, AI_MODEL: 'assistant:latest' }, {
      verifier: fakeVerifier, store: new MemoryStore(), log: m => logs.push(m),
    });
    server = await startApi(deps);
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai.providerInfo).toMatchObject({ label: 'Ollama Cloud', thirdParty: true });
    expect(logs.join('\n')).toContain('n\'est pas exécuté par ce serveur Ollama');
  });
});

describe('AI_API_KEY jamais transmise à une IA détectée automatiquement', () => {
  it('faux Ollama local : aucune clé reçue (détection, test de santé, génération) ; problème signalé à l’administrateur', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:8b'] }, reply: '# Cours\n\nContenu.' });
    const logs: string[] = [];
    const deps = createServerDeps({ AI_API_KEY: 'sk-CLE-PAYANTE-42', RATE_LIMIT_PER_MINUTE: '1000' }, {
      verifier: fakeVerifier, store: new MemoryStore(), log: m => logs.push(m), localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() },
    });
    expect(deps.config.problems.join('\n')).toContain('la clé n\'est pas utilisée');
    expect(logs.join('\n')).toContain('la clé n\'est pas utilisée');
    expect(logs.join('\n')).not.toContain('sk-CLE-PAYANTE-42');
    const active = await deps.resolveAI();
    expect((await active.provider.health(AbortSignal.timeout(5_000))).ok).toBe(true);
    server = await startApi(deps);
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    await res.text();
    expect(ollama.requests.some(r => r.path === '/api/chat')).toBe(true);
    expect(ollama.requests.map(r => r.headers.authorization).filter(Boolean)).toEqual([]);
  });

  it('faux LM Studio local : aucune clé reçue non plus', async () => {
    const lms = await fakeAI({ lmStudio: [{ id: 'qwen3-8b', type: 'llm', state: 'loaded' }], openaiModels: [{ id: 'qwen3-8b' }] });
    const deps = createServerDeps({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-CLE-PAYANTE-42' }, {
      verifier: fakeVerifier, store: new MemoryStore(), log: silentLog, localAI: { ollamaUrl: await closedPortUrl(), lmStudioUrl: lms.url },
    });
    const active = await deps.resolveAI();
    await active.provider.health(AbortSignal.timeout(5_000));
    expect(lms.requests.length).toBeGreaterThan(0);
    expect(lms.requests.map(r => r.headers.authorization).filter(Boolean)).toEqual([]);
  });
});
