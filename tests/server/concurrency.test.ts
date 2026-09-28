// Générations simultanées : limite par utilisateur (partagée entre instances via le stockage),
// plafond par instance vers le serveur d'IA, libération en fin de flux et expiration.

import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import { collectStream, type AIProvider, type ChatOptions, type StreamEvent } from '../../shared/ai/provider.js';
import { MagistraError } from '../../shared/errors.js';
import type { GenerationEvent } from '../../shared/types.js';
import { InstanceGenerations } from '../../server/concurrency.js';
import { generationSlotTtlSeconds, loadConfig } from '../../server/config.js';
import { handleApi, type ApiRequest } from '../../server/handlers.js';
import { MemoryStore, type GenerationLimits } from '../../server/store.js';
import { call, readNdjson, startApi, testDeps, validRequest, waitFor, type TestServer } from './helpers.js';

/** Fournisseur dont chaque génération reste en cours jusqu'à finishOne() ou l'annulation. */
class GatedProvider implements AIProvider {
  readonly kind = 'mock' as const;
  readonly model = 'gated-model';
  readonly label = 'IA simulée';
  readonly local = false;
  readonly contextTokens = 16_384;
  readonly calls: ChatOptions[] = [];
  private readonly waiting: (() => void)[] = [];
  /** Erreurs levées, dans l'ordre, par les premiers appels (avant tout texte). */
  private readonly failures: MagistraError[];

  constructor(options: { failFirst?: MagistraError[] } = {}) {
    this.failures = [...(options.failFirst ?? [])];
  }

  get pending(): number {
    return this.waiting.length;
  }

  /** Termine la plus ancienne génération en attente. */
  finishOne(): void {
    this.waiting.shift()?.();
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    this.calls.push(options);
    const failure = this.failures.shift();
    if (failure) throw failure;
    yield { type: 'delta', text: '# Cours\n\nDébut du cours. ' };
    await new Promise<void>(resolve => {
      const done = () => {
        const i = this.waiting.indexOf(done);
        if (i >= 0) this.waiting.splice(i, 1);
        resolve();
      };
      this.waiting.push(done);
      options.signal?.addEventListener('abort', done, { once: true });
    });
    if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    yield { type: 'delta', text: 'Fin du cours.' };
    yield { type: 'end', finishReason: 'stop' };
  }

  generate(options: ChatOptions) {
    return collectStream(this, options);
  }

  async health() {
    return { ok: true };
  }

  async listModels() {
    return [];
  }
}

interface Running {
  res: Response;
  controller: AbortController;
}

const servers: TestServer[] = [];
const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) r.controller.abort();
  for (const s of servers.splice(0)) await s.close();
});

async function serve(deps: Parameters<typeof startApi>[0]): Promise<string> {
  const s = await startApi(deps);
  servers.push(s);
  return s.url;
}

function post(base: string, token: string, signal?: AbortSignal): Promise<Response> {
  return call(base, '/api/generate', token, { method: 'POST', body: JSON.stringify(validRequest), signal });
}

/** Lance une génération et attend l'en-tête de la réponse (la place est alors réservée). */
async function start(base: string, token: string): Promise<Running> {
  const controller = new AbortController();
  const res = await post(base, token, controller.signal);
  const r = { res, controller };
  running.push(r);
  return r;
}

const BUSY = { code: 'GENERATION_BUSY', message: 'Une génération est déjà en cours. Attendez sa fin ou arrêtez-la.', retryable: true };

describe('générations simultanées par utilisateur', () => {
  it('A lance 2 générations lentes : la 3e est refusée (429 GENERATION_BUSY) sans appeler l’IA ; B n’est pas affecté', async () => {
    const provider = new GatedProvider();
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => provider });
    const url = await serve(deps);

    const a1 = await start(url, 'token-A');
    await waitFor(() => provider.pending === 1);
    const a2 = await start(url, 'token-A');
    await waitFor(() => provider.pending === 2);
    expect([a1.res.status, a2.res.status]).toEqual([200, 200]);
    expect(store.activeCount('user_A')).toBe(2);

    const a3 = await post(url, 'token-A');
    expect(a3.status).toBe(429);
    expect(a3.headers.get('content-type')).toContain('application/json');
    expect(a3.headers.get('retry-after')).toBe('30');
    expect(await a3.json()).toEqual({ error: BUSY });
    expect(provider.calls).toHaveLength(2);
    // Une demande refusée n'est pas comptée dans le contrôle de débit.
    expect(store.requestCount('user_A')).toBe(2);

    const b1 = await start(url, 'token-B');
    expect(b1.res.status).toBe(200);
    await waitFor(() => provider.pending === 3);
    const b2 = await start(url, 'token-B');
    expect(b2.res.status).toBe(200);
  });

  it('après la fin d’une génération, ou son abandon par le client, une nouvelle est acceptée', async () => {
    const provider = new GatedProvider();
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => provider });
    const url = await serve(deps);

    const a1 = await start(url, 'token-A');
    await waitFor(() => provider.pending === 1);
    const a2 = await start(url, 'token-A');
    await waitFor(() => provider.pending === 2);
    expect((await post(url, 'token-A')).status).toBe(429);

    // Fin normale : la place est libérée avant la fin de la réponse.
    provider.finishOne();
    const events = await readNdjson(a1.res);
    expect(events[events.length - 1].type).toBe('done');
    expect(store.activeCount('user_A')).toBe(1);
    expect(deps.activeGenerations.count('user_A')).toBe(1);
    const a3 = await start(url, 'token-A');
    expect(a3.res.status).toBe(200);
    await waitFor(() => provider.pending === 2);
    expect((await post(url, 'token-A')).status).toBe(429);

    // Abandon (fermeture de la connexion) : le modèle est arrêté et la place libérée.
    a2.controller.abort();
    await waitFor(() => store.activeCount('user_A') === 1 && deps.activeGenerations.count('user_A') === 1);
    expect(provider.calls[1].signal?.aborted).toBe(true);
    const a4 = await start(url, 'token-A');
    expect(a4.res.status).toBe(200);

    // Les générations restantes sont abandonnées : tout est libéré.
    a3.controller.abort();
    a4.controller.abort();
    await waitFor(() => store.activeCount('user_A') === 0 && deps.activeGenerations.count() === 0);
  });

  it('une erreur du serveur d’IA termine le flux et libère la place', async () => {
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => new MockProvider({ failWith: new MagistraError('AI_SERVER_UNAVAILABLE') }) });
    const url = await serve(deps);
    for (let i = 0; i < 4; i++) {
      const res = await post(url, 'token-A');
      expect(res.status).toBe(200);
      const events = await readNdjson(res);
      expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'AI_SERVER_UNAVAILABLE' });
      expect(store.activeCount('user_A')).toBe(0);
    }
  });

  it('plusieurs instances du serveur : la limite est partagée par le stockage', async () => {
    const provider = new GatedProvider();
    const store = new MemoryStore();
    const deps1 = testDeps({ store, provider: () => provider });
    const deps2 = testDeps({ store, provider: () => provider });
    const url1 = await serve(deps1);
    const url2 = await serve(deps2);

    await start(url1, 'token-A');
    await waitFor(() => provider.pending === 1);
    await start(url2, 'token-A');
    await waitFor(() => provider.pending === 2);
    // Chaque instance n'en voit qu'une : c'est le compteur partagé qui refuse.
    expect(deps1.activeGenerations.count('user_A')).toBe(1);
    const refused = await post(url1, 'token-A');
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toEqual(BUSY);
    expect(deps1.activeGenerations.count('user_A')).toBe(1);
    expect((await start(url2, 'token-B')).res.status).toBe(200);
  });

  it('MAX_CONCURRENT_GENERATIONS_PER_USER=0 : pas de limite, aucune place réservée', async () => {
    const provider = new GatedProvider();
    const store = new MemoryStore();
    const url = await serve(testDeps({ store, provider: () => provider, env: { MAX_CONCURRENT_GENERATIONS_PER_USER: '0' } }));
    for (let i = 1; i <= 4; i++) {
      expect((await start(url, 'token-A')).res.status).toBe(200);
      await waitFor(() => provider.pending === i);
    }
    expect(store.activeCount('user_A')).toBe(0);
    expect(store.requestCount('user_A')).toBe(4);
  });

  it('expiration : une place jamais libérée (échec de la libération) cesse de compter après AI_TIMEOUT_SECONDS + marge', async () => {
    let now = Date.parse('2026-09-28T10:00:00Z');
    const logs: string[] = [];
    class FailingEndStore extends MemoryStore {
      async endGeneration(): Promise<void> {
        throw new Error('base injoignable');
      }
    }
    const store = new FailingEndStore({ now: () => new Date(now) });
    const deps = testDeps({ store, overrides: { log: message => logs.push(message) } });
    const url = await serve(deps);

    for (let i = 0; i < 2; i++) {
      const res = await post(url, 'token-A');
      expect(res.status).toBe(200);
      const events = await readNdjson(res);
      expect(events[events.length - 1].type).toBe('done');
    }
    expect(logs.filter(m => m.startsWith('Fin de génération non enregistrée'))).toHaveLength(2);
    // Les places sont restées réservées dans le stockage (mais libérées sur l'instance).
    expect(store.activeCount('user_A')).toBe(2);
    expect(deps.activeGenerations.count()).toBe(0);
    const ttl = generationSlotTtlSeconds(deps.config);
    expect(ttl).toBe(280 + 90);

    now += ttl * 1_000;
    expect((await post(url, 'token-A')).status).toBe(429);
    now += 1_000;
    const res = await post(url, 'token-A');
    expect(res.status).toBe(200);
    await res.text();
  });

  it('compteur partagé indisponible : la demande est acceptée (journalisée) et la limite de l’instance s’applique', async () => {
    const provider = new GatedProvider();
    const logs: string[] = [];
    class FailingStore extends MemoryStore {
      async beginGeneration(): Promise<never> {
        throw new MagistraError('STORAGE_ERROR');
      }
    }
    const url = await serve(testDeps({ store: new FailingStore(), provider: () => provider, overrides: { log: message => logs.push(message) } }));
    await start(url, 'token-A');
    await waitFor(() => provider.pending === 1);
    await start(url, 'token-A');
    await waitFor(() => provider.pending === 2);
    expect(logs.filter(m => m === 'Anti-abus indisponible (requête acceptée)')).toHaveLength(2);
    const refused = await post(url, 'token-A');
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('GENERATION_BUSY');
  });
});

describe('plafond de générations par instance (MAX_CONCURRENT_GENERATIONS)', () => {
  it('au-delà : 503 AI_BUSY réessayable, sans détail technique ; accepté dès qu’une génération se termine', async () => {
    const provider = new GatedProvider();
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => provider, env: { MAX_CONCURRENT_GENERATIONS: '2' } });
    const url = await serve(deps);

    const a1 = await start(url, 'token-A');
    await waitFor(() => provider.pending === 1);
    await start(url, 'token-B');
    await waitFor(() => provider.pending === 2);

    for (const token of ['token-A', 'token-B']) {
      const res = await post(url, token);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('15');
      expect(await res.json()).toEqual({
        error: { code: 'AI_BUSY', message: "Le serveur d'IA est surchargé. Réessayez dans quelques instants.", retryable: true },
      });
    }
    expect(provider.calls).toHaveLength(2);
    // Refus avant toute écriture dans le stockage.
    expect(store.requestCount('user_A')).toBe(1);
    expect(store.activeCount('user_A')).toBe(1);

    provider.finishOne();
    await readNdjson(a1.res);
    expect((await start(url, 'token-A')).res.status).toBe(200);
  });
});

describe('débit de tout le déploiement (RATE_LIMIT_GLOBAL_PER_MINUTE)', () => {
  it('au-delà : 503 AI_BUSY réessayable pour tous les utilisateurs et toutes les instances ; refus non comptés', async () => {
    const store = new MemoryStore();
    const env = { RATE_LIMIT_GLOBAL_PER_MINUTE: '3' };
    const url1 = await serve(testDeps({ store, env }));
    const url2 = await serve(testDeps({ store, env }));
    for (const [url, token] of [[url1, 'token-A'], [url2, 'token-A'], [url2, 'token-B']]) {
      const res = await post(url, token);
      expect(res.status).toBe(200);
      await res.text();
    }
    for (const [url, token] of [[url1, 'token-B'], [url2, 'token-A']]) {
      const res = await post(url, token);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('15');
      expect(await res.json()).toEqual({
        error: { code: 'AI_BUSY', message: "Le serveur d'IA est surchargé. Réessayez dans quelques instants.", retryable: true },
      });
    }
    expect(store.requestCount('user_A') + store.requestCount('user_B')).toBe(3);
    expect(store.activeCount('user_A') + store.activeCount('user_B')).toBe(0);
  });

  it('valeur par défaut : 120 demandes par minute ; 0 = désactivé', () => {
    expect(loadConfig({}).rateLimitGlobalPerMinute).toBe(120);
    expect(loadConfig({ RATE_LIMIT_GLOBAL_PER_MINUTE: '0' }).rateLimitGlobalPerMinute).toBe(0);
    const bad = loadConfig({ RATE_LIMIT_GLOBAL_PER_MINUTE: '1e9' });
    expect(bad.rateLimitGlobalPerMinute).toBe(120);
    expect(bad.problems.join('\n')).toContain('RATE_LIMIT_GLOBAL_PER_MINUTE');
  });
});

describe('libération garantie', () => {
  function apiRequest(signal: AbortSignal): ApiRequest {
    return {
      method: 'POST',
      query: new URLSearchParams(),
      headers: { authorization: 'Bearer token-A' },
      readJson: async () => validRequest,
      readRaw: async () => ({ text: JSON.stringify(validRequest), exact: true }),
      signal,
    };
  }

  it('la place est libérée avant la fin du flux, et close() libère un flux jamais parcouru', async () => {
    const store = new MemoryStore();
    const deps = testDeps({ store });

    const read = await handleApi('generate', apiRequest(new AbortController().signal), deps);
    if (read.type !== 'stream') throw new Error('flux attendu');
    const events: GenerationEvent[] = [];
    for await (const event of read.events) {
      events.push(event);
      if (event.type !== 'done') expect(store.activeCount('user_A')).toBe(1);
    }
    expect(events[events.length - 1].type).toBe('done');
    expect(store.activeCount('user_A')).toBe(0);
    await read.close?.();

    const unread = await handleApi('generate', apiRequest(new AbortController().signal), deps);
    if (unread.type !== 'stream') throw new Error('flux attendu');
    expect(store.activeCount('user_A')).toBe(1);
    expect(deps.activeGenerations.count()).toBe(1);
    await unread.close?.();
    await unread.close?.();
    expect(store.activeCount('user_A')).toBe(0);
    expect(deps.activeGenerations.count()).toBe(0);
  });

  it('refus du débit (RATE_LIMITED) : la place de l’instance est rendue', async () => {
    const store = new MemoryStore();
    const deps = testDeps({ store, env: { RATE_LIMIT_PER_MINUTE: '1' } });
    const url = await serve(deps);
    const ok = await post(url, 'token-A');
    expect(ok.status).toBe(200);
    await ok.text();
    const limited = await post(url, 'token-A');
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');
    expect(deps.activeGenerations.count()).toBe(0);
    expect(store.activeCount('user_A')).toBe(0);
  });
});

describe('nouveaux essais automatiques du serveur d’IA', () => {
  it('AI_BUSY passager : nouvel essai annoncé, génération menée à bien, place tenue pendant les essais puis libérée', async () => {
    const provider = new GatedProvider({ failFirst: [new MagistraError('AI_BUSY'), new MagistraError('AI_SERVER_UNAVAILABLE')] });
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => provider });
    deps.config.ai.retryDelaysMs = [20, 20];
    const url = await serve(deps);

    const a1 = await start(url, 'token-A');
    // Troisième tentative en cours : la place est toujours réservée.
    await waitFor(() => provider.pending === 1);
    expect(provider.calls).toHaveLength(3);
    expect(store.activeCount('user_A')).toBe(1);
    expect(deps.activeGenerations.count('user_A')).toBe(1);

    provider.finishOne();
    const events = await readNdjson(a1.res);
    const retries = events.filter(e => e.type === 'status' && /nouvel essai automatique/.test(e.message));
    expect(retries).toHaveLength(2);
    expect(events.some(e => e.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', saved: true, content: expect.stringContaining('Fin du cours.') });
    expect(store.activeCount('user_A')).toBe(0);
    expect(deps.activeGenerations.count()).toBe(0);
  });

  it('abandon pendant l’attente d’un nouvel essai : arrêt immédiat et place libérée', async () => {
    const provider = new GatedProvider({ failFirst: [new MagistraError('AI_BUSY')] });
    const store = new MemoryStore();
    const deps = testDeps({ store, provider: () => provider });
    deps.config.ai.retryDelaysMs = [60_000];
    const url = await serve(deps);

    const a1 = await start(url, 'token-A');
    const reader = a1.res.body!.getReader();
    let received = '';
    while (!received.includes('nouvel essai automatique')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += new TextDecoder().decode(value);
    }
    expect(store.activeCount('user_A')).toBe(1);
    a1.controller.abort();
    await waitFor(() => store.activeCount('user_A') === 0 && deps.activeGenerations.count() === 0);
    expect(provider.calls).toHaveLength(1);
  });
});

describe('MemoryStore.beginGeneration (même sémantique que magistra_begin_generation)', () => {
  const limits: GenerationLimits = { windowSeconds: 60, maxRequests: 3, maxGlobalRequests: 0, maxActive: 2, activeTtlSeconds: 100 };

  it('busy avant rate_limited ; une demande refusée n’est pas comptée ; expiration exacte', async () => {
    let now = 1_000_000;
    const store = new MemoryStore({ now: () => new Date(now) });
    const slotOf = async (userId: string) => {
      const admission = await store.beginGeneration(userId, limits);
      if (admission.status !== 'ok' || !admission.slotId) throw new Error(`place attendue : ${JSON.stringify(admission)}`);
      return admission.slotId;
    };
    const s1 = await slotOf('user_A');
    await slotOf('user_A');
    expect(s1).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.beginGeneration('user_A', limits)).toEqual({ status: 'busy' });
    expect(store.requestCount('user_A')).toBe(2);
    await slotOf('user_B');

    // Seul le propriétaire libère sa place ; libérer deux fois est sans effet.
    await store.endGeneration('user_B', s1);
    expect(store.activeCount('user_A')).toBe(2);
    await store.endGeneration('user_A', s1);
    await store.endGeneration('user_A', s1);
    expect(store.activeCount('user_A')).toBe(1);
    await slotOf('user_A');
    expect(await store.beginGeneration('user_A', { ...limits, maxActive: 5 })).toEqual({ status: 'rate_limited' });

    // Les places ont démarré à `now` : elles comptent encore à now + ttl, plus à now + ttl + 1 ms.
    now += 100_000;
    expect(await store.beginGeneration('user_A', { ...limits, maxRequests: 0 })).toEqual({ status: 'busy' });
    now += 1;
    expect(await store.beginGeneration('user_A', { ...limits, maxRequests: 0 })).toMatchObject({ status: 'ok' });
  });

  it('débit global : tous utilisateurs confondus, sur une fenêtre glissante ; un refus n’est pas compté', async () => {
    let now = 5_000_000;
    const store = new MemoryStore({ now: () => new Date(now) });
    const global = { windowSeconds: 60, maxRequests: 0, maxGlobalRequests: 3, maxActive: 0, activeTtlSeconds: 100 };
    expect(await store.beginGeneration('user_A', global)).toEqual({ status: 'ok', slotId: null });
    now += 10_000;
    expect(await store.beginGeneration('user_B', global)).toMatchObject({ status: 'ok' });
    expect(await store.beginGeneration('user_C', global)).toMatchObject({ status: 'ok' });
    expect(await store.beginGeneration('user_D', global)).toEqual({ status: 'saturated' });
    expect(store.requestCount('user_D')).toBe(0);
    // Le débit propre à l'utilisateur est vérifié d'abord.
    expect(await store.beginGeneration('user_A', { ...global, maxRequests: 1 })).toEqual({ status: 'rate_limited' });
    // La demande de A sort de la fenêtre de 60 s : une place se libère.
    now += 50_000;
    expect(await store.beginGeneration('user_D', global)).toMatchObject({ status: 'ok' });
    expect(await store.beginGeneration('user_D', global)).toEqual({ status: 'saturated' });
  });

  it('suppression du compte : les places réservées disparaissent', async () => {
    const store = new MemoryStore();
    await store.beginGeneration('user_A', limits);
    await store.deleteAccount('user_A');
    expect(store.activeCount('user_A')).toBe(0);
  });
});

describe('InstanceGenerations (mémoire de l’instance)', () => {
  it('limite par utilisateur puis globale, libération idempotente, expiration', () => {
    let now = 0;
    const gens = new InstanceGenerations({ now: () => now });
    const limits = { max: 3, maxPerUser: 2, ttlMs: 1_000 };
    const a1 = gens.acquire('user_A', limits);
    const a2 = gens.acquire('user_A', limits);
    expect(a1.ok && a2.ok).toBe(true);
    expect(gens.acquire('user_A', limits)).toEqual({ ok: false, reason: 'busy' });
    expect(gens.acquire('user_B', limits).ok).toBe(true);
    expect(gens.acquire('user_C', limits)).toEqual({ ok: false, reason: 'saturated' });
    if (a1.ok) {
      a1.release();
      a1.release();
    }
    expect(gens.count()).toBe(2);
    expect(gens.acquire('user_C', limits).ok).toBe(true);
    now = 1_001;
    expect(gens.count(undefined, limits.ttlMs)).toBe(0);
    expect(gens.acquire('user_A', limits).ok).toBe(true);
    expect(gens.count()).toBe(1);
    expect(gens.acquire('user_A', { max: 0, maxPerUser: 0, ttlMs: 1_000 }).ok).toBe(true);
  });
});

describe('configuration', () => {
  it('valeurs par défaut, bornes et 0 = pas de limite', () => {
    const base = { AI_BASE_URL: 'http://ia.local/v1', AI_MODEL: 'm' };
    const d = loadConfig(base);
    expect([d.maxConcurrentGenerationsPerUser, d.maxConcurrentGenerations]).toEqual([2, 8]);
    const zero = loadConfig({ ...base, MAX_CONCURRENT_GENERATIONS_PER_USER: '0', MAX_CONCURRENT_GENERATIONS: '0' });
    expect([zero.maxConcurrentGenerationsPerUser, zero.maxConcurrentGenerations]).toEqual([0, 0]);
    const bad = loadConfig({ ...base, MAX_CONCURRENT_GENERATIONS_PER_USER: '101', MAX_CONCURRENT_GENERATIONS: '-1' });
    expect([bad.maxConcurrentGenerationsPerUser, bad.maxConcurrentGenerations]).toEqual([2, 8]);
    expect(bad.problems.join('\n')).toMatch(/MAX_CONCURRENT_GENERATIONS_PER_USER.*entre 0 et 100/);
    expect(bad.problems.join('\n')).toMatch(/MAX_CONCURRENT_GENERATIONS doit.*entre 0 et 1000/);
    expect(generationSlotTtlSeconds(loadConfig({ ...base, AI_TIMEOUT_SECONDS: '600' }))).toBe(690);
  });
});
