// POST /api/generate : flux NDJSON, annulation, anti-abus, validation, limites techniques.

import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { GenerationEvent, HistoryPage } from '../../shared/types.js';
import { loadConfig } from '../../server/config.js';
import { MemoryStore } from '../../server/store.js';
import { jsonResponse, mockFetch } from '../shared/helpers.js';
import { call, readNdjson, startApi, testDeps, validRequest, waitFor, type TestServer } from './helpers.js';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('POST /api/generate', () => {
  it('diffuse les évènements dans l’ordre et enregistre sous l’utilisateur du jeton', async () => {
    const store = new MemoryStore();
    const provider = new MockProvider({ reply: '# Les graphes\n\nUn graphe orienté est un couple (S, A).', chunkSize: 8 });
    server = await startApi(testDeps({ store, provider: () => provider }));

    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();

    const events = await readNdjson(res);
    const types = events.map(e => e.type);
    expect(types[0]).toBe('sources');
    expect(types[1]).toBe('status');
    expect(types.filter(t => t === 'delta').length).toBeGreaterThan(1);
    expect(types.indexOf('delta')).toBeGreaterThan(types.indexOf('status'));
    expect(types[types.length - 1]).toBe('done');
    const lastDelta = types.lastIndexOf('delta');
    expect(types.slice(lastDelta + 1)).toEqual(['status', 'done']);

    const text = events.filter((e): e is Extract<GenerationEvent, { type: 'delta' }> => e.type === 'delta').map(e => e.text).join('');
    expect(text).toBe('# Les graphes\n\nUn graphe orienté est un couple (S, A).');
    const done = events[events.length - 1] as Extract<GenerationEvent, { type: 'done' }>;
    expect(done.saved).toBe(true);
    expect(done.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(done.model).toBe('mock-model');
    expect(store.ownerOf(done.id!)).toBe('user_A');
    expect(provider.calls[0].maxTokens).toBeGreaterThan(0);
  });

  it('recherche en ligne : le serveur ne retient que les sites vérifiés (RESEARCH_TRUSTED_ONLY), le web général seulement sur décision de l’administrateur', async () => {
    const searx = mockFetch(url => {
      const q = new URL(url).searchParams.get('q') ?? '';
      const official = { url: 'https://www.unesco.org/fr/articles/graphes', title: 'Les graphes', content: 'L’UNESCO publie des ressources sur l’enseignement des graphes et des mathématiques discrètes à l’université.' };
      const blog = { url: 'https://blog.example.org/graphes', title: 'Mon blog sur les graphes', content: 'Un blog d’étudiant explique les graphes orientés, leurs parcours et leurs applications aux réseaux.' };
      return jsonResponse({ results: q.includes('site:') ? (q.includes('site:education.gouv.fr') ? [official, blog] : []) : [blog] });
    });
    const sourcesFor = async (env: Record<string, string>) => {
      const research = { config: loadConfig({ SEARXNG_URL: 'https://searx.example.fr', RESEARCH_ACADEMIC: 'false', RESEARCH_WIKIPEDIA: 'false', ...env }).research, deps: { fetch: searx } };
      server = await startApi(testDeps({ overrides: { research } }));
      const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify({ ...validRequest, researchMode: 'internet' }) });
      const events = await readNdjson(res);
      await server.close();
      server = undefined;
      return (events.find(e => e.type === 'sources') as Extract<GenerationEvent, { type: 'sources' }>).sources.map(s => [s.kind, s.url]);
    };
    expect(await sourcesFor({})).toEqual([['institutional', 'https://www.unesco.org/fr/articles/graphes']]);
    expect(await sourcesFor({ RESEARCH_TRUSTED_ONLY: 'false' })).toEqual([
      ['institutional', 'https://www.unesco.org/fr/articles/graphes'],
      ['web', 'https://blog.example.org/graphes'],
    ]);
  });

  it('interrompt le fournisseur d’IA quand le client ferme la connexion', async () => {
    const store = new MemoryStore();
    const provider = new MockProvider({ reply: 'x'.repeat(4_000), chunkSize: 10, delayMs: 20 });
    server = await startApi(testDeps({ store, provider: () => provider }));

    const controller = new AbortController();
    const res = await call(server.url, '/api/generate', 'token-A', {
      method: 'POST',
      body: JSON.stringify(validRequest),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('"delta"')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    expect(received).toContain('"delta"');
    controller.abort();

    await waitFor(() => provider.calls[0]?.signal?.aborted === true);
    // Le flux du fournisseur s'arrête et rien n'est enregistré.
    await new Promise(r => setTimeout(r, 100));
    const page = await store.listGenerations('user_A', { limit: 10 });
    expect(page.items).toHaveLength(0);
  });

  it('anti-abus : 429 RATE_LIMITED après N demandes par minute, sans toucher aux autres utilisateurs', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '3' } }));
    for (let i = 0; i < 3; i++) {
      const ok = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const limited = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('content-type')).toContain('application/json');
    expect(await limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Trop de demandes en peu de temps : patientez quelques secondes.', retryable: true },
    });
    const other = await call(server.url, '/api/generate', 'token-B', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(other.status).toBe(200);
    await other.text();
    // Aucun compteur « produit » : l'historique n'est pas limité.
    const page = await (await call(server.url, '/api/history', 'token-A')).json() as HistoryPage;
    expect(page.items).toHaveLength(3);
  });

  it('RATE_LIMIT_PER_MINUTE=0 et RATE_LIMIT_GLOBAL_PER_MINUTE=0 désactivent la protection', async () => {
    const store = new MemoryStore();
    server = await startApi(testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '0', RATE_LIMIT_GLOBAL_PER_MINUTE: '0' } }));
    for (let i = 0; i < 12; i++) {
      const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(store.requestCount('user_A')).toBe(0);
  });

  it('validation : 400 avec un message explicite, avant tout flux', async () => {
    server = await startApi(testDeps());
    const cases: [unknown, string][] = [
      [{ ...validRequest, type: 'inconnu' }, 'Type de contenu inconnu.'],
      [{ ...validRequest, niveau: 'maternelle_xl' }, 'Niveau inconnu.'],
      [{ ...validRequest, sujet: '' }, 'Indiquez un sujet.'],
      [{ ...validRequest, sujet: 'x'.repeat(301) }, 'Le champ « sujet » est trop long (300 caractères maximum).'],
    ];
    for (const [body, message] of cases) {
      const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: { code: 'INVALID_REQUEST', message, retryable: false } });
    }
    const notJson = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: '{ pas du json' });
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error.message).toBe('Corps de requête JSON invalide.');
    const wrongType = await call(server.url, '/api/generate', 'token-A', {
      method: 'POST',
      body: JSON.stringify(validRequest),
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(wrongType.status).toBe(400);
  });

  it('corps > 1 Mo : 413', async () => {
    server = await startApi(testDeps());
    const huge = JSON.stringify({ ...validRequest, consignes: 'x'.repeat(1_100_000) });
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: huge });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe('DOCUMENT_TOO_LARGE');
    expect(json.error.message).toContain('1 Mo');
  });

  it('corps > 1 Mo envoyé en flux (sans Content-Length) : 413', async () => {
    server = await startApi(testDeps());
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 1_200_000) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await fetch(`${server.url}/api/generate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-A', 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }).catch(() => null);
    // Le serveur répond 413 et ferme la connexion sans lire le reste.
    if (res) expect(res.status).toBe(413);
  });

  it('méthode interdite : 405 JSON avec l’en-tête Allow', async () => {
    server = await startApi(testDeps());
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect((await res.json()).error.code).toBe('INVALID_REQUEST');
    const put = await call(server.url, '/api/history', 'token-A', { method: 'PUT', body: '{}' });
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET');
  });

  it('serveur d’IA non configuré : 503 AI_NOT_CONFIGURED, sans flux', async () => {
    const deps = testDeps({ overrides: { providerFactory: undefined } });
    server = await startApi(deps);
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('AI_NOT_CONFIGURED');
    expect(json.error.message).toContain('AI_BASE_URL');
  });

  it('erreur du fournisseur : évènement « error » dans le flux, rien d’enregistré', async () => {
    const store = new MemoryStore();
    const { MagistraError } = await import('../../shared/errors.js');
    const provider = new MockProvider({ failWith: new MagistraError('AI_BUSY') });
    server = await startApi(testDeps({ store, provider: () => provider }));
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);
    expect(events[events.length - 1]).toEqual({
      type: 'error', code: 'AI_BUSY', message: "Le serveur d'IA est surchargé. Réessayez dans quelques instants.", retryable: true,
    });
    expect((await store.listGenerations('user_A', { limit: 5 })).items).toHaveLength(0);
  });

  it('dépassement de la durée maximale : évènement AI_TIMEOUT', async () => {
    const provider = new MockProvider({ reply: 'y'.repeat(2_000), chunkSize: 10, delayMs: 50 });
    const deps = testDeps({ provider: () => provider });
    deps.config.ai.timeoutMs = 300;
    server = await startApi(deps);
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    const events = await readNdjson(res);
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    expect(last.type === 'error' && last.code).toBe('AI_TIMEOUT');
  });

  it('stockage non configuré : 500 SERVER_MISCONFIGURED sans détail technique', async () => {
    server = await startApi(testDeps({ store: null }));
    const res = await call(server.url, '/api/generate', 'token-A', { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'SERVER_MISCONFIGURED', message: 'Le serveur Magistra est mal configuré. Contactez l’administrateur.', retryable: false },
    });
  });
});
