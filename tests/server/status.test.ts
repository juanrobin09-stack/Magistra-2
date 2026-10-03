// GET /api/status et configuration : aucun secret exposé, valeurs dérivées correctes.

import { afterEach, describe, expect, it } from 'vitest';
import { MagistraError } from '../../shared/errors.js';
import { MockProvider } from '../../shared/ai/mock.js';
import type { ServerStatus } from '../../shared/apiContract.js';
import { loadConfig, maxDocumentCharsFor } from '../../server/config.js';
import { createServerDeps } from '../../server/deps.js';
import { MemoryStore } from '../../server/store.js';
import { call, fakeVerifier, silentLog, startApi, testDeps, type TestServer } from './helpers.js';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const SECRETS = {
  AI_API_KEY: 'cle-ia-ultra-secrete',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-supabase-ultra-secrete',
  CLERK_SECRET_KEY: 'sk_test_ultra_secrete',
};

describe('configuration', () => {
  it('valeurs par défaut', () => {
    const cfg = loadConfig({});
    expect(cfg.ai.provider).toBeNull();
    expect(cfg.ai.label).toBe("Serveur d'IA");
    expect(cfg.ai.contextTokens).toBe(32_768);
    expect(cfg.ai.maxOutputTokens).toBe(6_000);
    expect(cfg.rateLimitPerMinute).toBe(10);
    expect(cfg.research).toMatchObject({ academic: true, wikipedia: true, searxngUrl: undefined });
    expect(cfg.clerk).toBeNull();
    expect(cfg.supabase).toBeNull();
    expect(cfg.defaultTimeZone).toBe('Europe/Paris');
    expect(cfg.problems.length).toBeGreaterThan(0);
  });

  it('serveur compatible OpenAI (vLLM universitaire)', () => {
    const cfg = loadConfig({
      AI_BASE_URL: 'https://ia.univ.fr/v1/', AI_MODEL: 'mistral-small', AI_SERVER_LABEL: 'Serveur universitaire',
      AI_CONTEXT_TOKENS: '65536', RESEARCH_ACADEMIC: 'false', SEARXNG_URL: 'https://searx.univ.fr', ...SECRETS,
    });
    expect(cfg.ai.provider).toEqual({
      kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'mistral-small', apiKey: 'cle-ia-ultra-secrete',
      label: 'Serveur universitaire', contextTokens: 65_536, local: false, recipient: 'administrateur', timeZone: 'Europe/Paris',
    });
    expect(cfg.research.academic).toBe(false);
    expect(cfg.research.searxngUrl).toBe('https://searx.univ.fr');
    expect(cfg.maxDocumentChars).toBe(maxDocumentCharsFor(65_536));
  });

  it('Ollama sans URL : adresse locale par défaut', () => {
    const cfg = loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'ministral-3:14b' });
    expect(cfg.ai.provider).toMatchObject({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'ministral-3:14b' });
  });

  it('Ollama : contexte du niveau Magistra, 12 288 tokens pour un autre modèle (mémoire), AI_CONTEXT_TOKENS prioritaire', () => {
    expect(loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'ministral-3:14b' }).ai.contextTokens).toBe(12_288);
    expect(loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:0.6b' }).ai.contextTokens).toBe(12_288);
    expect(loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:0.6b', AI_CONTEXT_TOKENS: '4096' }).ai.contextTokens).toBe(4_096);
    // Serveur compatible OpenAI : contexte non réservé par Magistra, valeur par défaut inchangée.
    expect(loadConfig({ AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'qwen3:0.6b' }).ai.contextTokens).toBe(32_768);
  });

  it('valeurs invalides : signalées et remplacées par les valeurs par défaut', () => {
    const cfg = loadConfig({ AI_BASE_URL: 'file:///etc', AI_MODEL: 'm', RATE_LIMIT_PER_MINUTE: '-4', SEARXNG_URL: 'javascript:1', AI_PROVIDER: 'openai' });
    expect(cfg.ai.provider).toBeNull();
    expect(cfg.rateLimitPerMinute).toBe(10);
    expect(cfg.research.searxngUrl).toBeUndefined();
    expect(cfg.problems.join(' ')).toContain('AI_BASE_URL');
  });

  it('RESEARCH_TRUSTED_ONLY : sites vérifiés seulement par défaut, le web général seulement sur décision de l’administrateur', () => {
    expect(loadConfig({}).research.trustedOnly).toBe(true);
    expect(loadConfig({ RESEARCH_TRUSTED_ONLY: 'true' }).research.trustedOnly).toBe(true);
    for (const value of ['false', 'FALSE', '0', 'non', 'off']) {
      expect(loadConfig({ RESEARCH_TRUSTED_ONLY: value }).research.trustedOnly, value).toBe(false);
    }
    expect(loadConfig({ RESEARCH_TRUSTED_ONLY: 'false' }).problems.join(' ')).not.toContain('RESEARCH_TRUSTED_ONLY');
  });

  it('RESEARCH_TRUSTED_ONLY invalide : problème journalisé comme les autres variables, restriction conservée', () => {
    const cfg = loadConfig({ RESEARCH_TRUSTED_ONLY: 'peut-être' });
    expect(cfg.research.trustedOnly).toBe(true);
    expect(cfg.problems).toContain('RESEARCH_TRUSTED_ONLY doit valoir « true » ou « false » : valeur par défaut (true) utilisée.');
  });

  it('taille des extraits dérivée du contexte, bornée à 120 000 caractères', () => {
    expect(maxDocumentCharsFor(32_768)).toBe(Math.floor((32_768 * 0.55 - 3_000) * 3.2));
    expect(maxDocumentCharsFor(1_000_000)).toBe(120_000);
    expect(maxDocumentCharsFor(2_048)).toBe(2_000);
  });
});

describe('GET /api/status', () => {
  it('ne révèle aucun secret et reflète la configuration', async () => {
    const deps = createServerDeps(
      { AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'mistral-small', AI_SERVER_LABEL: 'Serveur universitaire', SEARXNG_URL: 'https://searx.univ.fr', ...SECRETS },
      {
        verifier: fakeVerifier,
        store: new MemoryStore(),
        providerFactory: () => new MockProvider({ model: 'mistral-small' }),
        log: silentLog,
      },
    );
    server = await startApi(deps);
    const res = await call(server.url, '/api/status', 'token-A');
    expect(res.status).toBe(200);
    const raw = await res.text();
    for (const secret of Object.values(SECRETS)) expect(raw).not.toContain(secret);
    expect(raw).not.toContain('ia.univ.fr');
    const status = JSON.parse(raw) as ServerStatus;
    expect(status).toEqual({
      ai: {
        ok: true, label: 'IA simulée', model: 'mistral-small',
        // Prestataire non identifié : le libellé de l'administrateur est repris, jamais l'adresse.
        providerInfo: {
          label: 'Serveur universitaire', thirdParty: true, country: 'Inconnu',
          retention: 'Selon les conditions du prestataire', training: 'Selon les conditions du prestataire',
        },
      },
      research: { academic: true, web: true, institutional: true, wikipedia: true, trustedCatalogue: true },
      maxDocumentChars: maxDocumentCharsFor(32_768),
    });
  });

  it('sites officiels vérifiés : disponibles par SearXNG, ou sans lui par les références de Wikipédia (page récupérée par le serveur)', async () => {
    const research = async (env: Record<string, string>) => {
      const deps = createServerDeps(
        { AI_BASE_URL: 'https://ia.univ.fr/v1', AI_MODEL: 'mistral-small', ...env, ...SECRETS },
        { verifier: fakeVerifier, store: new MemoryStore(), providerFactory: () => new MockProvider({ model: 'mistral-small' }), log: silentLog },
      );
      server = await startApi(deps);
      const status = await (await call(server.url, '/api/status', 'token-A')).json() as ServerStatus;
      await server.close();
      server = undefined;
      return status.research;
    };
    // Cas normal d'un serveur sans SearXNG : Wikipédia actif (défaut) et récupération de pages.
    expect(await research({})).toEqual({ academic: true, web: false, institutional: true, wikipedia: true, trustedCatalogue: true });
    // Wikipédia désactivé, aucun moteur : plus aucun chemin vers les sites officiels.
    expect(await research({ RESEARCH_WIKIPEDIA: 'false' })).toEqual({ academic: true, web: false, institutional: false, wikipedia: false, trustedCatalogue: true });
    // SearXNG suffit, même sans Wikipédia.
    expect(await research({ RESEARCH_WIKIPEDIA: 'false', SEARXNG_URL: 'https://searx.univ.fr' })).toEqual({ academic: true, web: true, institutional: true, wikipedia: false, trustedCatalogue: true });
  });

  it('sans récupération de pages (hébergement qui n’en fournit pas) et sans SearXNG : sites officiels non disponibles', async () => {
    const research = { config: { academic: true, wikipedia: true, timeoutMs: 1_000 }, deps: { fetch: () => Promise.reject(new Error('réseau interdit')) } };
    server = await startApi(testDeps({ overrides: { research } }));
    const status = await (await call(server.url, '/api/status', 'token-A')).json() as ServerStatus;
    expect(status.research).toEqual({ academic: true, web: false, institutional: false, wikipedia: true, trustedCatalogue: true });
  });

  it('serveur d’IA non configuré : ai.ok = false avec un message clair', async () => {
    server = await startApi(testDeps({ overrides: { providerFactory: undefined } }));
    const status = await (await call(server.url, '/api/status', 'token-A')).json() as ServerStatus;
    expect(status.ai.ok).toBe(false);
    expect(status.ai.code).toBe('AI_NOT_CONFIGURED');
    expect(status.ai.label).toBe("Serveur d'IA");
    expect(status.research).toEqual({ academic: false, web: false, institutional: false, wikipedia: false, trustedCatalogue: true });
  });

  it('serveur d’IA injoignable : ai.ok = false (délai court)', async () => {
    const provider = new MockProvider({ failWith: new MagistraError('AI_SERVER_UNAVAILABLE') });
    server = await startApi(testDeps({ provider: () => provider }));
    const status = await (await call(server.url, '/api/status', 'token-A')).json() as ServerStatus;
    expect(status.ai).toMatchObject({ ok: false, code: 'AI_SERVER_UNAVAILABLE' });
  });

  it('authentification non configurée : SERVER_MISCONFIGURED, sans secret', async () => {
    const deps = createServerDeps({}, { store: new MemoryStore(), log: silentLog });
    server = await startApi(deps);
    const res = await call(server.url, '/api/status', 'token-A');
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('mode développement (comptes Clerk demandés) : le message indique la variable à renseigner', async () => {
    const deps = createServerDeps({ MAGISTRA_AUTH: 'clerk' }, { log: silentLog, dev: true });
    expect(deps.store?.kind).toBe('memory');
    server = await startApi(deps);
    const res = await call(server.url, '/api/history', 'token-A');
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toContain('CLERK_SECRET_KEY');
  });

  it('route inconnue : 404 JSON', async () => {
    server = await startApi(testDeps());
    const res = await call(server.url, '/api/usage', 'token-A');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
