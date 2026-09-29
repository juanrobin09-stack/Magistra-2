// Configuration de l'IA du site : préréglages (AI_PRESET), alias d'AI_PROVIDER, adresses impossibles sur Vercel,
// transparence sur le prestataire (/api/status), GET /api/mode, journal des générations échouées.

import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { ModeInfo, ServerStatus } from '../../shared/apiContract.js';
import { MagistraError } from '../../shared/errors.js';
import { DEFAULTS, loadConfig, maxDocumentCharsFor } from '../../server/config.js';
import { createServerDeps } from '../../server/deps.js';
import { MemoryStore } from '../../server/store.js';
import { startFakeAI, type FakeAI } from './fakeAI.js';
import { call, fakeVerifier, readNdjson, silentLog, startApi, testDeps, validRequest, type TestServer } from './helpers.js';

let server: TestServer | undefined;
let fake: FakeAI | undefined;
afterEach(async () => {
  await server?.close();
  await fake?.close();
  server = undefined;
  fake = undefined;
});

const offlineResearch = {
  config: { academic: false, wikipedia: false, timeoutMs: 1_000 },
  deps: { fetch: () => Promise.reject(new Error('réseau interdit pendant les tests')) },
};

/** API authentifiée par le faux vérificateur, avec la VRAIE configuration de l'IA (aucun fournisseur simulé). */
function realAIDeps(env: Record<string, string>) {
  return createServerDeps({ RATE_LIMIT_PER_MINUTE: '1000', ...env }, { verifier: fakeVerifier, store: new MemoryStore(), research: offlineResearch, log: silentLog });
}

describe('préréglages (AI_PRESET)', () => {
  it('ovhcloud : la solution gratuite la plus simple (sans clé), prestataire annoncé', () => {
    const cfg = loadConfig({ AI_PRESET: 'ovhcloud' });
    expect(cfg.ai.provider).toMatchObject({
      kind: 'openai-compatible', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', model: 'Mistral-Small-3.2-24B-Instruct-2506',
      label: 'OVHcloud AI Endpoints', contextTokens: 32_768, recipient: 'administrateur', timeZone: 'Europe/Paris',
    });
    expect(cfg.ai.preset).toBe('ovhcloud');
    expect(cfg.ai.maxOutputTokens).toBe(4_000);
    expect(cfg.ai.timeoutMs).toBe(DEFAULTS.aiTimeoutSeconds * 1_000);
    expect(cfg.ai.providerInfo).toMatchObject({ label: 'OVHcloud AI Endpoints', thirdParty: true, country: expect.stringContaining('France') });
    expect(cfg.ai.providerInfo?.privacyUrl).toMatch(/^https:\/\//);
    // Accès anonyme : limite signalée à l'administrateur.
    expect(cfg.problems.join('\n')).toMatch(/sans AI_API_KEY.*2 requêtes par minute/);
    expect(loadConfig({ AI_PRESET: 'OVH' }).ai.preset).toBe('ovhcloud');
  });

  it('les valeurs explicites l’emportent sur le préréglage', () => {
    const cfg = loadConfig({
      AI_PRESET: 'ovhcloud', AI_MODEL: 'Mistral-Nemo-Instruct-2407', AI_MAX_OUTPUT_TOKENS: '3000', AI_CONTEXT_TOKENS: '16384',
      AI_SERVER_LABEL: 'IA du rectorat', AI_API_KEY: 'cle-ovh',
    });
    expect(cfg.ai.provider).toMatchObject({ model: 'Mistral-Nemo-Instruct-2407', contextTokens: 16_384, label: 'IA du rectorat', apiKey: 'cle-ovh' });
    expect(cfg.ai.maxOutputTokens).toBe(3_000);
    // Le prestataire réel reste nommé, même avec un libellé personnalisé.
    expect(cfg.ai.providerInfo?.label).toBe('IA du rectorat (OVHcloud AI Endpoints)');
  });

  it('clé obligatoire absente (mistral, albert, scaleway) : problème explicite, aucune tentative', () => {
    for (const preset of ['mistral', 'albert', 'scaleway']) {
      const cfg = loadConfig({ AI_PRESET: preset });
      expect(cfg.ai.provider, preset).toBeNull();
      expect(cfg.ai.unavailable, preset).toMatchObject({ code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('AI_API_KEY') });
      expect(cfg.problems.join('\n'), preset).toContain('AI_API_KEY manquante');
    }
    expect(loadConfig({ AI_PRESET: 'albert', AI_API_KEY: 'k' }).ai.provider).toMatchObject({ baseUrl: 'https://albert.api.etalab.gouv.fr/v1', model: 'openweight-medium' });
    // Même contrôle quand l'adresse d'un prestataire à clé est saisie à la main.
    expect(loadConfig({ AI_BASE_URL: 'https://api.mistral.ai/v1', AI_MODEL: 'ministral-14b-2512' }).ai.unavailable?.message).toContain('Mistral AI');
  });

  it('ollama : API native, contexte du niveau, IA locale (aucun tiers)', () => {
    const cfg = loadConfig({ AI_PRESET: 'ollama' });
    expect(cfg.ai.provider).toMatchObject({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'ministral-3:14b', contextTokens: 12_288 });
    expect(cfg.ai.providerInfo).toMatchObject({ thirdParty: false });
    expect(cfg.ai.label).toBe('IA locale du serveur Magistra');
    // IA de cette machine, hors Vercel : génération plus longue permise.
    expect(cfg.ai.timeoutMs).toBe(DEFAULTS.localAiTimeoutSeconds * 1_000);
    expect(loadConfig({ AI_PRESET: 'ollama', AI_TIMEOUT_SECONDS: '600' }).ai.timeoutMs).toBe(600_000);
  });

  it('préréglage inconnu : signalé, sans repli silencieux', () => {
    const cfg = loadConfig({ AI_PRESET: 'gratuit' });
    expect(cfg.ai.provider).toBeNull();
    expect(cfg.ai.autodetect).toBe(false);
    expect(cfg.ai.unavailable?.message).toContain('ovhcloud');
    expect(cfg.problems.join('\n')).toContain('AI_PRESET inconnu');
  });
});

describe('AI_PROVIDER et adresses', () => {
  it('valeurs naturelles comprises comme « openai-compatible », avec un avertissement', () => {
    for (const value of ['lmstudio', 'llamacpp', 'localai', 'LM-Studio', 'vllm', 'openai']) {
      const cfg = loadConfig({ AI_PROVIDER: value, AI_BASE_URL: 'http://192.168.1.5:1234/v1', AI_MODEL: 'm' });
      expect(cfg.ai.provider?.kind, value).toBe('openai-compatible');
      expect(cfg.problems.join('\n'), value).toContain('compris comme « openai-compatible »');
    }
    // Nom d'un prestataire dans AI_PROVIDER : compris comme le préréglage.
    const cfg = loadConfig({ AI_PROVIDER: 'mistral', AI_API_KEY: 'k' });
    expect(cfg.ai.preset).toBe('mistral');
    expect(cfg.ai.provider).toMatchObject({ baseUrl: 'https://api.mistral.ai/v1', model: 'ministral-14b-2512' });
    expect(cfg.problems.join('\n')).toContain('AI_PRESET=mistral');
    for (const [value, preset] of [['ovh', 'ovhcloud'], ['scaleway', 'scaleway'], ['albert', 'albert']] as const) {
      const hinted = loadConfig({ AI_PROVIDER: value, AI_API_KEY: 'k' });
      expect(hinted.ai.provider?.kind, value).toBe('openai-compatible');
      expect(hinted.ai.preset, value).toBe(preset);
      expect(hinted.problems.join('\n'), value).toContain(`AI_PRESET=${preset}`);
    }
    expect(loadConfig({ AI_PROVIDER: 'gpt', AI_BASE_URL: 'https://x.fr/v1', AI_MODEL: 'm' }).ai.provider).toBeNull();
  });

  it('Ollama : AI_API_KEY transmise (proxy à clé), destinataire administrateur, /v1 retiré', () => {
    const cfg = loadConfig({ AI_PROVIDER: 'ollama', AI_BASE_URL: 'https://ollama.univ.fr/v1', AI_MODEL: 'ministral-3:8b', AI_API_KEY: 'cle-proxy' });
    expect(cfg.ai.provider).toMatchObject({
      kind: 'ollama', baseUrl: 'https://ollama.univ.fr', apiKey: 'cle-proxy', recipient: 'administrateur', timeZone: 'Europe/Paris', contextTokens: 12_288,
    });
    expect(cfg.problems.join('\n')).toContain('/v1');
  });

  it('Vercel : adresse locale, privée (RFC 1918) ou en .local → problème explicite, injoignable', () => {
    for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:1234/v1', 'http://192.168.1.20:8000/v1', 'http://10.0.0.3/v1', 'http://172.16.4.2/v1', 'http://ia.local:8080/v1']) {
      const cfg = loadConfig({ VERCEL: '1', AI_BASE_URL: url, AI_MODEL: 'm' });
      expect(cfg.ai.provider, url).toBeNull();
      expect(cfg.ai.unavailable, url).toMatchObject({ code: 'AI_SERVER_UNREACHABLE' });
      expect(cfg.ai.unavailable?.message, url).not.toContain(new URL(url).hostname);
      expect(cfg.problems.join('\n'), url).toContain('injoignable depuis Vercel');
    }
    expect(loadConfig({ VERCEL: '1', AI_PRESET: 'ollama' }).ai.unavailable?.code).toBe('AI_SERVER_UNREACHABLE');
    expect(loadConfig({ VERCEL: '1', AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'm' }).ai.provider).not.toBeNull();
    expect(loadConfig({ VERCEL: '1', AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'm' }).ai.timeoutMs).toBe(280_000);
    // Hors Vercel, une adresse du réseau local est normale (serveur de l'établissement).
    expect(loadConfig({ AI_BASE_URL: 'http://192.168.1.20:8000/v1', AI_MODEL: 'm' }).ai.provider).not.toBeNull();
  });

  it('rien de configuré : AI_BASE_URL et AI_MODEL signalés ensemble (Vercel), détection locale ailleurs', () => {
    const vercel = loadConfig({ VERCEL: '1' });
    expect(vercel.ai.autodetect).toBe(false);
    expect(vercel.problems.find(p => p.includes('AI_BASE_URL'))).toMatch(/AI_BASE_URL et AI_MODEL manquants/);
    expect(vercel.ai.unavailable?.message).toContain('AI_PRESET');
    const local = loadConfig({});
    expect(local.ai.autodetect).toBe(true);
    expect(local.problems.join('\n')).not.toContain('AI_MODEL');
    expect(loadConfig({ AI_AUTODETECT: 'false' }).ai.autodetect).toBe(false);
    expect(loadConfig({ AI_BASE_URL: 'https://ia.univ.fr/v1' }).ai.unavailable?.message).toContain('AI_MODEL');
  });

  it('prestataire public non identifié sans AI_SERVER_LABEL : nom d’hôte seul, conseil au journal', () => {
    const cfg = loadConfig({ AI_BASE_URL: 'https://ia.exemple.org/v1', AI_MODEL: 'm' });
    expect(cfg.ai.label).toBe("Service d'IA en ligne non identifié (ia.exemple.org)");
    expect(cfg.ai.providerInfo).toMatchObject({ thirdParty: true });
    expect(cfg.problems.join('\n')).toContain('AI_SERVER_LABEL vide');
    const withUrl = loadConfig({ AI_BASE_URL: 'https://ia.exemple.org/v1', AI_MODEL: 'm', AI_PROVIDER_PRIVACY_URL: 'https://ia.exemple.org/confidentialite' });
    expect(withUrl.ai.providerInfo?.privacyUrl).toBe('https://ia.exemple.org/confidentialite');
  });
});

describe('GET /api/status : cause précise et fiche du prestataire, jamais d’adresse ni de clé', () => {
  it('préréglage avec clé : fiche du prestataire, sans l’URL de base ni la clé', async () => {
    fake = await startFakeAI({ openaiModels: [{ id: 'ministral-14b-2512' }], requireKey: 'cle-mistral-ultra-secrete' });
    // Adresse du faux serveur à la place de celle de Mistral, libellé du préréglage conservé par AI_SERVER_LABEL.
    server = await startApi(realAIDeps({ AI_PRESET: 'mistral', AI_BASE_URL: `${fake.url}/v1`, AI_API_KEY: 'cle-mistral-ultra-secrete', AI_SERVER_LABEL: 'Mistral AI' }));
    const res = await call(server.url, '/api/status', 'token-A');
    const raw = await res.text();
    expect(raw).not.toContain('cle-mistral-ultra-secrete');
    expect(raw).not.toContain(fake.url);
    expect(raw).not.toContain('127.0.0.1');
    const status = JSON.parse(raw) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: true, label: 'Mistral AI', model: 'ministral-14b-2512' });
    expect(status.ai.providerInfo).toMatchObject({ label: 'Mistral AI', thirdParty: false });
  });

  it('prestataire en ligne : fiche complète (pays, conservation, entraînement, lien)', async () => {
    server = await startApi(testDeps({ env: { AI_PRESET: 'ovhcloud' } }));
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai.providerInfo).toEqual({
      label: 'OVHcloud AI Endpoints', thirdParty: true, country: expect.any(String), retention: expect.any(String),
      training: expect.any(String), privacyUrl: expect.stringMatching(/^https:\/\//),
    });
    expect(JSON.stringify(status)).not.toContain('kepler');
  });

  it('configuration impossible : code et message précis (et plus « indisponible »)', async () => {
    server = await startApi(realAIDeps({ VERCEL: '1', AI_BASE_URL: 'http://192.168.1.20:8000/v1', AI_MODEL: 'm' }));
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: false, code: 'AI_SERVER_UNREACHABLE', message: expect.stringContaining('adresse locale ou privée') });
    expect(JSON.stringify(status)).not.toContain('192.168');
    await server.close();
    server = await startApi(realAIDeps({ VERCEL: '1', AI_PRESET: 'albert' }));
    const albert = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(albert.ai).toMatchObject({ ok: false, code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('AI_API_KEY') });
    expect(albert.ai.providerInfo?.thirdParty).toBe(true);
  });

  it('avertissement non bloquant recopié (état non vérifié)', async () => {
    const warning = { code: 'AI_STATUS_UNKNOWN' as const, message: "L'état du serveur d'IA n'a pas pu être vérifié : la génération reste possible." };
    server = await startApi(testDeps({ provider: () => new MockProvider({ healthStatus: { ok: true, warning } }) }));
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: true, warning });
  });

  it('liste des modèles trop lente : test borné par AI_HEALTH_TIMEOUT_MS, « non vérifié » mais génération possible', async () => {
    fake = await startFakeAI({ openaiModels: [{ id: 'm' }], delayFor: { '/v1/models': 3_000 } });
    server = await startApi(realAIDeps({ AI_BASE_URL: `${fake.url}/v1`, AI_MODEL: 'm', AI_SERVER_LABEL: 'Serveur lent', AI_HEALTH_TIMEOUT_MS: '500' }));
    const started = Date.now();
    const status = (await (await call(server.url, '/api/status', 'token-A')).json()) as ServerStatus;
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(status.ai).toMatchObject({ ok: true, warning: { code: 'AI_STATUS_UNKNOWN' } });
    expect(status.ai.code).toBeUndefined();
  });

  it('délai du test de santé : 10 s par défaut', () => {
    expect(loadConfig({}).ai.healthTimeoutMs).toBe(10_000);
  });
});

describe('GET /api/mode (public, sans secret)', () => {
  it('Clerk : clé PUBLIABLE lue côté serveur ; contact de l’administrateur', async () => {
    const deps = createServerDeps(
      { CLERK_SECRET_KEY: 'sk_test_ultra_secrete', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhlbXBsZS5mciQ', MAGISTRA_ADMIN_CONTACT: 'dsi@univ.fr\u0007' },
      { store: new MemoryStore(), log: silentLog },
    );
    server = await startApi(deps);
    const res = await fetch(`${server.url}/api/mode`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('sk_test_ultra_secrete');
    expect(JSON.parse(raw) as ModeInfo).toEqual({ auth: 'clerk', clerkPublishableKey: 'pk_test_Y2xlcmsuZXhlbXBsZS5mciQ', adminContact: 'dsi@univ.fr' });
    expect((await fetch(`${server.url}/api/mode`, { method: 'POST' })).status).toBe(405);
  });

  it('clé secrète collée par erreur dans VITE_CLERK_PUBLISHABLE_KEY : jamais renvoyée ni journalisée', async () => {
    const logs: string[] = [];
    const deps = createServerDeps({ VITE_CLERK_PUBLISHABLE_KEY: 'sk_live_cle_secrete_erronee', CLERK_SECRET_KEY: 'sk_live_x' }, { store: new MemoryStore(), log: m => logs.push(m) });
    server = await startApi(deps);
    const raw = await (await fetch(`${server.url}/api/mode`)).text();
    expect(raw).not.toContain('sk_live');
    expect(JSON.parse(raw)).toEqual({ auth: 'clerk' });
    expect(logs.join('\n')).not.toContain('sk_live_cle_secrete_erronee');
  });

  it('prestataire configuré : fiche statique transmise (nom, pays…), jamais d’adresse d’API ni de clé ; absente en démonstration', async () => {
    const deps = createServerDeps(
      { CLERK_SECRET_KEY: 'sk_test_x', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhlbXBsZS5mciQ', AI_PRESET: 'ovhcloud', AI_API_KEY: 'cle-ovh-secrete' },
      { store: new MemoryStore(), log: silentLog },
    );
    server = await startApi(deps);
    const raw = await (await fetch(`${server.url}/api/mode`)).text();
    const info = JSON.parse(raw) as ModeInfo;
    expect(info.providerInfo).toMatchObject({ label: 'OVHcloud AI Endpoints', thirdParty: true, country: expect.stringContaining('France') });
    expect(raw).not.toContain('cle-ovh-secrete');
    expect(raw).not.toContain('endpoints.kepler');
    expect(raw).not.toContain('/v1');
    await server.close();
    server = await startApi(createServerDeps({ VERCEL: '1', AI_PRESET: 'ovhcloud' }, { store: new MemoryStore(), log: silentLog }));
    expect(await (await fetch(`${server.url}/api/mode`)).json()).toEqual({ auth: 'none' });
  });

  it('aucune authentification (Vercel sans Clerk) : « none »', async () => {
    server = await startApi(createServerDeps({ VERCEL: '1' }, { store: new MemoryStore(), log: silentLog }));
    expect(await (await fetch(`${server.url}/api/mode`)).json()).toEqual({ auth: 'none' });
    expect((await call(server.url, '/api/status', 'token-A')).status).toBe(500);
  });
});

describe('journal des générations échouées (F8)', () => {
  it('code, libellé et modèle seulement : ni le sujet, ni la demande, ni l’identifiant, ni la clé', async () => {
    const logs: string[] = [];
    const deps = testDeps({
      env: { AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'mistral-small', AI_API_KEY: 'cle-ultra-secrete' },
      provider: () => new MockProvider({ model: 'mistral-small', failWith: new MagistraError('AI_AUTH_FAILED') }),
      overrides: { log: m => logs.push(m) },
    });
    server = await startApi(deps);
    const body = { ...validRequest, sujet: 'Sujet-confidentiel-de-l-enseignant', consignes: 'Consigne-privee-unique' };
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(body) });
    const events = await readNdjson(res);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'AI_AUTH_FAILED' });
    const journal = logs.join('\n');
    expect(journal).toContain('Génération échouée : AI_AUTH_FAILED (IA simulée, modèle mistral-small)');
    for (const secret of ['Sujet-confidentiel', 'Consigne-privee-unique', 'user_A', 'token-A', 'cle-ultra-secrete', 'graphes']) {
      expect(journal, secret).not.toContain(secret);
    }
  });

  it('aucune IA utilisable avant même la génération : une seule ligne « Génération échouée », sans contenu', async () => {
    const logs: string[] = [];
    const deps = createServerDeps(
      { VERCEL: '1', AI_BASE_URL: 'http://192.168.1.20:8000/v1', AI_MODEL: 'mistral-small', RATE_LIMIT_PER_MINUTE: '1000' },
      { verifier: fakeVerifier, store: new MemoryStore(), research: offlineResearch, log: m => logs.push(m) },
    );
    server = await startApi(deps);
    logs.length = 0;
    const body = { ...validRequest, sujet: 'Sujet-confidentiel-avant-flux' };
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('AI_SERVER_UNREACHABLE');
    expect(logs).toEqual(["Génération échouée : AI_SERVER_UNREACHABLE (Serveur d'IA du réseau local, modèle mistral-small)"]);
    expect(logs.join('\n')).not.toMatch(/Sujet-confidentiel|user_A|192\.168/);
  });

  it('échec réel d’un serveur (modèle absent) journalisé avec son code', async () => {
    fake = await startFakeAI({ ollama: { version: '0.34.4', models: ['autre:latest'] } });
    const logs: string[] = [];
    const deps = createServerDeps(
      { AI_PROVIDER: 'ollama', AI_BASE_URL: fake.url, AI_MODEL: 'ministral-3:8b', RATE_LIMIT_PER_MINUTE: '1000' },
      { verifier: fakeVerifier, store: new MemoryStore(), research: offlineResearch, log: m => logs.push(m) },
    );
    deps.config.ai.retryDelaysMs = [];
    server = await startApi(deps);
    const events = await readNdjson(await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'MODEL_NOT_INSTALLED' });
    expect(logs.join('\n')).toMatch(/Génération échouée : MODEL_NOT_INSTALLED \(IA locale du serveur Magistra, modèle ministral-3:8b\)/);
  });
});

describe('taille des extraits', () => {
  it('reste dérivée du contexte configuré', () => {
    expect(loadConfig({ AI_PRESET: 'ollama' }).maxDocumentChars).toBe(maxDocumentCharsFor(12_288));
  });
});
