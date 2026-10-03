// Mesures de vitesse du moteur Ollama : durées du dernier objet du flux, délai avant le premier mot, placement du modèle
// (GET /api/ps, une fois, en tâche de fond). Aucune mesure ne retarde ni ne fait échouer la génération.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OLLAMA_URL, OllamaClient, OllamaProvider, RUNNING_TIMEOUT_MS } from '../../shared/ai/ollama';
import type { StreamEvent } from '../../shared/ai/provider';
import { catchError, collect, jsonResponse, mockFetch, never, ollamaLine, sleep, streamBody, streamResponse, textResponse } from './helpers';

const MESSAGES = [{ role: 'system' as const, content: 'Tu es Magistra.' }, { role: 'user' as const, content: 'Un cours.' }];
const GB = 1_000_000_000;

const FINAL = `${JSON.stringify({
  model: 'm', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop',
  total_duration: 6_500_000_000, load_duration: 40_000_000, prompt_eval_count: 321, prompt_eval_duration: 2_500_000_000,
  eval_count: 45, eval_duration: 4_500_000_000,
})}\n`;

const PS_CPU = { models: [{ name: 'ministral-3:3b', model: 'ministral-3:3b', size: 4 * GB, size_vram: 0, context_length: 12_288 }] };

/** NDJSON en plusieurs morceaux espacés : la lecture de /api/ps a le temps de revenir pendant la rédaction. */
function chatBody() {
  return streamBody([ollamaLine('# Cours\n\n'), ollamaLine('Premier '), ollamaLine('paragraphe.'), FINAL], { delayMs: 15 });
}

function provider(fetchImpl: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof OllamaProvider>[0]> = {}) {
  return new OllamaProvider({ model: 'ministral-3:3b', contextTokens: 12_288, fetch: fetchImpl, ...extra });
}

function psCalls(fetchImpl: ReturnType<typeof mockFetch>) {
  return fetchImpl.calls.filter(c => c.url.endsWith('/api/ps'));
}

function end(events: StreamEvent[]) {
  const last = events[events.length - 1];
  if (last?.type !== 'end') throw new Error('évènement de fin manquant');
  return last;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OllamaProvider — durées du moteur et premier mot', () => {
  it('le dernier objet alimente usage.timings (millisecondes), le premier mot est mesuré côté client', async () => {
    const times = [1_000, 2_240];
    const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? jsonResponse(PS_CPU) : streamResponse(chatBody(), 'application/x-ndjson')));
    const events = await collect(provider(fetchImpl, { now: () => times.shift() ?? 99_999 }).stream({ messages: MESSAGES }));
    expect(end(events).usage).toMatchObject({
      promptTokens: 321,
      completionTokens: 45,
      timeToFirstDeltaMs: 1_240,
      timings: {
        totalMs: 6_500, loadMs: 40, promptTokens: 321, promptMs: 2_500, promptTokensPerSecond: 128.4,
        outputTokens: 45, outputMs: 4_500, tokensPerSecond: 10,
      },
    });
  });

  it('aucune durée dans le dernier objet : pas de timings inventés', async () => {
    const final = `${JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 2 })}\n`;
    const fetchImpl = mockFetch(() => streamResponse(streamBody([ollamaLine('Texte'), final]), 'application/x-ndjson'));
    const events = await collect(provider(fetchImpl, { baseUrl: 'http://ia.univ-exemple.fr:11434' }).stream({ messages: MESSAGES }));
    expect(end(events).usage?.timings).toBeUndefined();
    expect(end(events).usage).toMatchObject({ promptTokens: 3, completionTokens: 2 });
  });
});

describe('OllamaProvider — placement (GET /api/ps)', () => {
  it('relevé UNE fois après le premier mot, joint à l’évènement de fin ; les requêtes de génération sont inchangées', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? jsonResponse(PS_CPU) : streamResponse(chatBody(), 'application/x-ndjson')));
    const events = await collect(provider(fetchImpl).stream({ messages: MESSAGES, maxTokens: 900, temperature: 0.2 }));
    expect(end(events).usage?.placement).toEqual({ processor: 'cpu', gpuPercent: 0, sizeBytes: 4 * GB, sizeVramBytes: 0, contextTokens: 12_288 });
    expect(psCalls(fetchImpl)).toHaveLength(1);
    const ps = psCalls(fetchImpl)[0];
    expect(ps.url).toBe(`${DEFAULT_OLLAMA_URL}/api/ps`);
    expect(ps.init?.method ?? 'GET').toBe('GET');
    expect(ps.body).toBeUndefined();
    // /api/chat : une seule requête, mêmes réglages que sans mesure, avant /api/ps.
    const chats = fetchImpl.calls.filter(c => c.url.endsWith('/api/chat'));
    expect(chats).toHaveLength(1);
    expect(fetchImpl.calls[0].url.endsWith('/api/chat')).toBe(true);
    expect(chats[0].body).toMatchObject({
      model: 'ministral-3:3b', stream: true, think: false, keep_alive: '15m', options: { num_ctx: 12_288, num_predict: 900, temperature: 0.2 },
    });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('carte graphique et partage : le placement suit size_vram', async () => {
    const run = async (vram: number) => {
      const body = { models: [{ ...PS_CPU.models[0], size_vram: vram }] };
      const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? jsonResponse(body) : streamResponse(chatBody(), 'application/x-ndjson')));
      return end(await collect(provider(fetchImpl).stream({ messages: MESSAGES }))).usage?.placement;
    };
    expect(await run(4 * GB)).toMatchObject({ processor: 'gpu', gpuPercent: 100 });
    expect(await run(1_600_000_000)).toMatchObject({ processor: 'mixed', gpuPercent: 40 });
  });

  it('jamais pour un serveur distant, ni pour le moteur d’un site (destinataire « administrateur »)', async () => {
    const respond = (url: string) => (url.endsWith('/api/ps') ? jsonResponse(PS_CPU) : streamResponse(chatBody(), 'application/x-ndjson'));
    const remote = mockFetch(respond);
    const remoteEnd = end(await collect(provider(remote, { baseUrl: 'http://ia.univ-exemple.fr:11434' }).stream({ messages: MESSAGES })));
    expect(psCalls(remote)).toHaveLength(0);
    expect(remoteEnd.usage?.placement).toBeUndefined();
    // Les durées du dernier objet restent lues : aucune requête de plus.
    expect(remoteEnd.usage?.timings?.totalMs).toBe(6_500);

    const site = mockFetch(respond);
    const siteEnd = end(await collect(provider(site, { recipient: 'administrateur' }).stream({ messages: MESSAGES })));
    expect(psCalls(site)).toHaveLength(0);
    expect(siteEnd.usage?.placement).toBeUndefined();
  });

  it('ne contacte que le moteur configuré (même adresse), avec sa clé d’accès seulement', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? jsonResponse(PS_CPU) : streamResponse(chatBody(), 'application/x-ndjson')));
    const p = provider(fetchImpl, { baseUrl: 'http://127.0.0.1:11999', apiKey: 'cle-proxy' });
    await collect(p.stream({ messages: MESSAGES }));
    expect(fetchImpl.calls.length).toBeGreaterThan(1);
    for (const call of fetchImpl.calls) {
      expect(call.url.startsWith('http://127.0.0.1:11999/')).toBe(true);
      expect((call.init?.headers as Record<string, string>).authorization).toBe('Bearer cle-proxy');
    }
  });

  it.each([
    ['moteur injoignable', () => { throw new TypeError('fetch failed'); }],
    ['HTTP 500', () => textResponse('{"error":"panne"}', 500)],
    ['HTTP 404 (moteur sans /api/ps)', () => textResponse('not found', 404)],
    ['réponse qui n’est pas du JSON', () => textResponse('<html>proxy</html>', 200)],
    ['JSON inattendu', () => jsonResponse({ models: 'aucun' })],
  ])('%s : silencieux, la génération aboutit sans placement', async (_name, psResponse) => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? psResponse() : streamResponse(chatBody(), 'application/x-ndjson')));
      const events = await collect(provider(fetchImpl).stream({ messages: MESSAGES }));
      expect(events.filter(e => e.type === 'delta').map(e => (e.type === 'delta' ? e.text : '')).join('')).toBe('# Cours\n\nPremier paragraphe.');
      expect(end(events)).toMatchObject({ finishReason: 'stop', usage: { completionTokens: 45 } });
      expect(end(events).usage?.placement).toBeUndefined();
      await sleep(20);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('un /api/ps qui ne répond jamais ne retarde pas la fin de la génération', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? never<Response>() : streamResponse(chatBody(), 'application/x-ndjson')));
    const startedAt = Date.now();
    const events = await collect(provider(fetchImpl).stream({ messages: MESSAGES }));
    expect(Date.now() - startedAt).toBeLessThan(RUNNING_TIMEOUT_MS - 1_000);
    expect(end(events).usage?.placement).toBeUndefined();
    expect(end(events).usage?.timings?.totalMs).toBe(6_500);
  });

  it('« Arrêter » : GENERATION_ABORTED comme sans mesure', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch(url => (url.endsWith('/api/ps') ? never<Response>() : streamResponse(chatBody(), 'application/x-ndjson')));
    const err = await catchError(async () => {
      for await (const event of provider(fetchImpl).stream({ messages: MESSAGES, signal: controller.signal })) {
        if (event.type === 'delta') controller.abort();
      }
    });
    expect(err.code).toBe('GENERATION_ABORTED');
  });
});

describe('OllamaClient.running — GET /api/ps', () => {
  it('renvoie la réponse du moteur ; ne lève jamais', async () => {
    const ok = new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => jsonResponse(PS_CPU)));
    expect(await ok.running()).toEqual(PS_CPU);
    for (const bad of [
      mockFetch(() => { throw new TypeError('fetch failed'); }),
      mockFetch(() => textResponse('erreur', 500)),
      mockFetch(() => textResponse('pas du json', 200)),
    ]) {
      await expect(new OllamaClient(DEFAULT_OLLAMA_URL, bad).running()).resolves.toBeUndefined();
    }
  });

  it('délai court (3 s par défaut) : sans réponse, undefined', async () => {
    expect(RUNNING_TIMEOUT_MS).toBe(3_000);
    const client = new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => never<Response>()));
    const startedAt = Date.now();
    await expect(client.running(undefined, 40)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('signal déjà interrompu : undefined, aucune erreur', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => jsonResponse(PS_CPU))).running(controller.signal)).resolves.toBeUndefined();
  });
});
