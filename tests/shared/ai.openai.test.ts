import { describe, expect, it } from 'vitest';
import { mapHttpError, OpenAICompatibleProvider } from '../../shared/ai/openaiCompatible';
import type { StreamEvent } from '../../shared/ai/provider';
import {
  catchError, collect, jsonResponse, mockFetch, networkError, never, sleep, splitBytes, sseChunk, streamBody, streamResponse,
  textResponse,
} from './helpers';

const MESSAGES = [{ role: 'user' as const, content: 'Bonjour' }];
const SECRET = 'sk-secret-cle-universite-123';

function provider(fetchImpl: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://ia.univ-exemple.fr/v1/',
    model: 'mistral-small',
    apiKey: SECRET,
    label: 'Serveur universitaire',
    fetch: fetchImpl,
    ...extra,
  });
}

function textOf(events: StreamEvent[]): string {
  return events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta').map(e => e.text).join('');
}

function endOf(events: StreamEvent[]) {
  const end = events[events.length - 1];
  if (end?.type !== 'end') throw new Error('évènement de fin manquant');
  return end;
}

describe('OpenAICompatibleProvider — flux SSE', () => {
  it('reconstitue un flux coupé au milieu des lignes et des caractères accentués, ignore les commentaires et s’arrête à [DONE]', async () => {
    const sse = [
      ': ping\n\n',
      sseChunk('Le théorème'),
      sseChunk(' de Pythagore : a² + b² = c².'),
      'event: message\n',
      sseChunk(null, 'stop'),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 9 } })}\n\n`,
      'data: [DONE]\n\n',
      sseChunk('NE DOIT PAS APPARAÎTRE'),
    ].join('');
    const fetchImpl = mockFetch(() => streamResponse(streamBody(splitBytes(sse, 7))));
    const events = await collect(provider(fetchImpl).stream({ messages: MESSAGES, maxTokens: 500 }));
    expect(textOf(events)).toBe('Le théorème de Pythagore : a² + b² = c².');
    expect(endOf(events)).toEqual({ type: 'end', finishReason: 'stop', usage: { promptTokens: 12, completionTokens: 9 } });

    const call = fetchImpl.calls[0];
    expect(call.url).toBe('https://ia.univ-exemple.fr/v1/chat/completions');
    expect(call.body).toMatchObject({ model: 'mistral-small', stream: true, max_tokens: 500, messages: MESSAGES });
    expect((call.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it('gère les fins de ligne CRLF', async () => {
    const sse = `${sseChunk('A')}${sseChunk('B', 'stop')}data: [DONE]\n\n`.replace(/\n/g, '\r\n');
    const events = await collect(provider(mockFetch(() => streamResponse(streamBody(splitBytes(sse, 5))))).stream({ messages: MESSAGES }));
    expect(textOf(events)).toBe('AB');
    expect(endOf(events).finishReason).toBe('stop');
  });

  it('signale une réponse tronquée (finish_reason « length »)', async () => {
    const sse = `${sseChunk('Début du cours')}${sseChunk(' qui s’arrête', 'length')}data: [DONE]\n\n`;
    const events = await collect(provider(mockFetch(() => streamResponse(streamBody([sse])))).stream({ messages: MESSAGES }));
    expect(textOf(events)).toBe('Début du cours qui s’arrête');
    expect(endOf(events).finishReason).toBe('length');
  });

  it('[DONE] sans finish_reason = réponse complète ; ni l’un ni l’autre = flux coupé (« unknown »)', async () => {
    const done = await collect(provider(mockFetch(() => streamResponse(streamBody([`${sseChunk('ok')}data: [DONE]\n\n`])))).stream({ messages: MESSAGES }));
    expect(endOf(done).finishReason).toBe('stop');
    const cut = await collect(provider(mockFetch(() => streamResponse(streamBody([sseChunk('début')])))).stream({ messages: MESSAGES }));
    expect(textOf(cut)).toBe('début');
    expect(endOf(cut).finishReason).toBe('unknown');
  });

  it('tolère un serveur non conforme (plusieurs « data: » sans ligne vide) et une réponse JSON non streamée', async () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Un' } }] })}\ndata: ${JSON.stringify({ choices: [{ delta: { content: ' deux' }, finish_reason: 'stop' }] })}\n\n`;
    const events = await collect(provider(mockFetch(() => streamResponse(streamBody([raw])))).stream({ messages: MESSAGES }));
    expect(textOf(events)).toBe('Un deux');

    const json = await collect(provider(mockFetch(() => jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Réponse complète' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }))).stream({ messages: MESSAGES }));
    expect(textOf(json)).toBe('Réponse complète');
    expect(endOf(json).finishReason).toBe('length');

    // En-tête « application/json » erroné sur un flux SSE.
    const mislabeled = await collect(provider(mockFetch(() => streamResponse(streamBody([`${sseChunk('SSE')}${sseChunk(' mal étiqueté', 'stop')}data: [DONE]\n\n`]), 'application/json'))).stream({ messages: MESSAGES }));
    expect(textOf(mislabeled)).toBe('SSE mal étiqueté');
    expect(endOf(mislabeled).finishReason).toBe('stop');

    const garbage = await catchError(() => collect(provider(mockFetch(() => streamResponse(streamBody(['<html>proxy</html>']), 'application/json'))).stream({ messages: MESSAGES })));
    expect(garbage.code).toBe('AI_BAD_RESPONSE');
  });

  it('traduit une erreur envoyée au milieu du flux', async () => {
    const sse = `${sseChunk('a')}data: ${JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens", code: 400 } })}\n\n`;
    const err = await catchError(() => collect(provider(mockFetch(() => streamResponse(streamBody([sse])))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('CONTEXT_TOO_LARGE');
  });

  it('generate() assemble le flux', async () => {
    const sse = `${sseChunk('Bon')}${sseChunk('jour', 'stop')}data: [DONE]\n\n`;
    const result = await provider(mockFetch(() => streamResponse(streamBody([sse])))).generate({ messages: MESSAGES });
    expect(result).toMatchObject({ text: 'Bonjour', finishReason: 'stop', model: 'mistral-small' });
  });
});

describe('OpenAICompatibleProvider — erreurs HTTP compréhensibles', () => {
  const cases: [number, string, string, RegExp][] = [
    [401, '{"error":{"message":"Invalid API key sk-secret-cle-universite-123"}}', 'AI_AUTH_FAILED', /Serveur universitaire a refusé l'accès \(clé d'accès refusée\)/],
    [403, '{"error":"forbidden"}', 'AI_AUTH_FAILED', /clé d'accès refusée/],
    [404, '{"object":"error","message":"The model `mistral-small` does not exist.","type":"NotFoundError","code":404}', 'MODEL_NOT_INSTALLED', /Le modèle « mistral-small » n'est pas disponible sur serveur universitaire\./],
    [404, '<html>Not Found</html>', 'AI_BAD_RESPONSE', /service introuvable à cette adresse/],
    [429, '{"error":{"message":"Rate limit exceeded"}}', 'AI_BUSY', /surchargé/],
    [500, 'Traceback (most recent call last): File "/srv/vllm/engine.py"', 'AI_SERVER_UNAVAILABLE', /^Serveur universitaire indisponible\./],
    [502, 'Bad Gateway', 'AI_SERVER_UNAVAILABLE', /^Serveur universitaire indisponible\./],
    [503, '{"detail":"Service Unavailable"}', 'AI_SERVER_UNAVAILABLE', /^Serveur universitaire indisponible\./],
    [504, 'Gateway Timeout', 'AI_TIMEOUT', /n'a pas répondu à temps/],
    [400, '{"object":"error","message":"This model\'s maximum context length is 8192 tokens. However, you requested 9000 tokens"}', 'CONTEXT_TOO_LARGE', /Trop de contenu pour ce modèle/],
    [413, 'Payload Too Large', 'CONTEXT_TOO_LARGE', /Trop de contenu/],
    [500, '{"error":"CUDA out of memory. Tried to allocate 2.00 GiB"}', 'OUT_OF_MEMORY', /^Mémoire insuffisante pour ce modèle\./],
  ];

  for (const [status, body, code, message] of cases) {
    it(`${status} ${body.slice(0, 40)}… → ${code}`, async () => {
      const err = await catchError(() => collect(provider(mockFetch(() => textResponse(body, status))).stream({ messages: MESSAGES })));
      expect(err.code).toBe(code);
      expect(err.message).toMatch(message);
      // Jamais de trace technique ni de secret dans le message montré à l'enseignant.
      expect(err.message).not.toContain(SECRET);
      expect(err.message).not.toMatch(/Traceback|engine\.py|NotFoundError|GiB|<html>/);
    });
  }

  it('« bloom » (nom de modèle) n’est pas confondu avec « OOM »', () => {
    const e = mapHttpError(404, 'model "bloom" not found', { label: 'Serveur', model: 'bloom', local: true, modelLabel: 'Bloom' });
    expect(e.code).toBe('MODEL_NOT_INSTALLED');
    expect(mapHttpError(500, 'bloom filter failed', { label: 'Serveur', model: 'x', local: false }).code).toBe('AI_SERVER_UNAVAILABLE');
  });
});

describe('OpenAICompatibleProvider — réseau, annulation, délais', () => {
  it('erreur réseau (TypeError fetch failed) → libellé du serveur distant', async () => {
    const err = await catchError(() => collect(provider(mockFetch(() => { throw networkError('ENOTFOUND'); })).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNAVAILABLE');
    expect(err.message).toBe('Serveur universitaire indisponible. Réessayez dans quelques instants.');
  });

  it('erreur réseau sur un serveur local → « Moteur IA non démarré. »', async () => {
    const p = provider(mockFetch(() => { throw networkError('ECONNREFUSED'); }), { local: true, baseUrl: 'http://127.0.0.1:1234/v1' });
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('ENGINE_NOT_RUNNING');
    expect(err.message).toBe('Moteur IA non démarré.');
  });

  it('connexion coupée au milieu du flux → serveur indisponible', async () => {
    const body = streamBody([sseChunk('début')], { error: new TypeError('terminated') });
    const err = await catchError(() => collect(provider(mockFetch(() => streamResponse(body))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNAVAILABLE');
  });

  it('annulation pendant la génération → GENERATION_ABORTED et connexion libérée', async () => {
    const body = streamBody([sseChunk('Premier morceau')], { hang: true });
    const fetchImpl = mockFetch(() => streamResponse(body));
    const controller = new AbortController();
    const received: string[] = [];
    const err = await catchError(async () => {
      for await (const event of provider(fetchImpl).stream({ messages: MESSAGES, signal: controller.signal })) {
        if (event.type === 'delta') {
          received.push(event.text);
          controller.abort();
        }
      }
    });
    expect(received).toEqual(['Premier morceau']);
    expect(err.code).toBe('GENERATION_ABORTED');
    expect(err.message).toBe('Génération interrompue.');
    expect((fetchImpl.calls[0].init?.signal as AbortSignal).aborted).toBe(true);
    await sleep(0);
    expect(body.cancelled()).toBe(true);
  });

  it('annulation avant la réponse du serveur, même si fetch ignore le signal', async () => {
    const controller = new AbortController();
    const pending = collect(provider(mockFetch(() => never())).stream({ messages: MESSAGES, signal: controller.signal }));
    setTimeout(() => controller.abort(), 20);
    const err = await catchError(() => pending);
    expect(err.code).toBe('GENERATION_ABORTED');
  });

  it('signal déjà annulé → GENERATION_ABORTED sans appel utile', async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await catchError(() => collect(provider(mockFetch(() => never())).stream({ messages: MESSAGES, signal: controller.signal })));
    expect(err.code).toBe('GENERATION_ABORTED');
  });

  it('délai d’inactivité dépassé entre deux morceaux → AI_TIMEOUT', async () => {
    const body = streamBody([sseChunk('Un morceau puis plus rien')], { hang: true });
    const p = provider(mockFetch(() => streamResponse(body)), { timeouts: { firstChunkMs: 1_000, idleMs: 60 } });
    const started = Date.now();
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.message).toMatch(/pas répondu à temps/);
    expect(Date.now() - started).toBeLessThan(2_000);
    await sleep(0);
    expect(body.cancelled()).toBe(true);
  });

  it('aucun premier morceau dans le délai → AI_TIMEOUT', async () => {
    const p = provider(mockFetch(() => streamResponse(streamBody([], { hang: true }))), { timeouts: { firstChunkMs: 60, idleMs: 1_000 } });
    expect((await catchError(() => collect(p.stream({ messages: MESSAGES })))).code).toBe('AI_TIMEOUT');
  });

  it('serveur qui ne renvoie jamais d’en-têtes → AI_TIMEOUT (et non une attente infinie)', async () => {
    const p = provider(mockFetch(() => never()), { timeouts: { firstChunkMs: 60, idleMs: 60 } });
    expect((await catchError(() => collect(p.stream({ messages: MESSAGES })))).code).toBe('AI_TIMEOUT');
  });

  it('arrêt anticipé par l’appelant → la requête est annulée (le serveur cesse de générer)', async () => {
    const fetchImpl = mockFetch(() => streamResponse(streamBody([sseChunk('a'), sseChunk('b')], { hang: true })));
    for await (const event of provider(fetchImpl).stream({ messages: MESSAGES })) {
      if (event.type === 'delta') break;
    }
    expect((fetchImpl.calls[0].init?.signal as AbortSignal).aborted).toBe(true);
  });
});

describe('OpenAICompatibleProvider — listModels / health', () => {
  it('liste les modèles (/v1/models) et ignore les entrées invalides', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ object: 'list', data: [{ id: 'mistral-small' }, { id: 'llama-3' }, { foo: 1 }, { id: 42 }] }));
    const models = await provider(fetchImpl).listModels();
    expect(models).toEqual([{ name: 'mistral-small' }, { name: 'llama-3' }]);
    expect(fetchImpl.calls[0].url).toBe('https://ia.univ-exemple.fr/v1/models');
  });

  it('health : prêt quand le modèle est servi', async () => {
    const health = await provider(mockFetch(() => jsonResponse({ data: [{ id: 'mistral-small:latest' }] }))).health();
    expect(health).toEqual({ ok: true });
  });

  it('health : modèle absent du serveur', async () => {
    const health = await provider(mockFetch(() => jsonResponse({ data: [{ id: 'autre-modele' }] }))).health();
    expect(health.ok).toBe(false);
    expect(health.error).toEqual({ code: 'MODEL_NOT_INSTALLED', message: "Le modèle « mistral-small » n'est pas disponible sur serveur universitaire." });
  });

  it('health : clé refusée, serveur injoignable', async () => {
    const auth = await provider(mockFetch(() => textResponse('{"error":"bad key"}', 401))).health();
    expect(auth.error?.code).toBe('AI_AUTH_FAILED');
    const down = await provider(mockFetch(() => { throw networkError('ECONNREFUSED'); })).health();
    expect(down.error).toEqual({ code: 'AI_SERVER_UNAVAILABLE', message: 'Serveur universitaire indisponible. Réessayez dans quelques instants.' });
  });

  it('refuse une configuration incomplète', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', model: 'x' })).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }));
  });
});
