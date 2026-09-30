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
    // Messages grammaticaux (WEB-AI-12) : « Le serveur universitaire a refusé… » et non « Serveur universitaire a refusé… ».
    [401, '{"error":{"message":"Invalid API key sk-secret-cle-universite-123"}}', 'AI_AUTH_FAILED', /^Le serveur universitaire a refusé l'accès \(clé d'accès refusée\)/],
    [403, '{"error":"forbidden"}', 'AI_AUTH_FAILED', /clé d'accès refusée/],
    [404, '{"object":"error","message":"The model `mistral-small` does not exist.","type":"NotFoundError","code":404}', 'MODEL_NOT_INSTALLED', /Le modèle « mistral-small » n'est pas disponible sur le serveur universitaire/],
    [404, '<html>Not Found</html>', 'AI_BAD_RESPONSE', /ne répond pas à cette adresse \(service introuvable\).*\/v1/],
    [429, '{"error":{"message":"Rate limit exceeded"}}', 'AI_BUSY', /surchargé/],
    [500, 'Traceback (most recent call last): File "/srv/vllm/engine.py"', 'AI_SERVER_UNAVAILABLE', /^Le serveur universitaire est momentanément indisponible\./],
    [502, 'Bad Gateway', 'AI_SERVER_UNAVAILABLE', /^Le serveur universitaire est momentanément indisponible\./],
    [503, '{"detail":"Service Unavailable"}', 'AI_SERVER_UNAVAILABLE', /^Le serveur universitaire est momentanément indisponible\./],
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
  it('nom introuvable (TypeError fetch failed, ENOTFOUND) → AI_SERVER_UNREACHABLE « injoignable », jamais « réessayez » (F5)', async () => {
    const err = await catchError(() => collect(provider(mockFetch(() => { throw networkError('ENOTFOUND'); })).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNREACHABLE');
    expect(err.message).toBe("Le serveur universitaire est injoignable à l'adresse configurée (nom introuvable) : vérifiez l'adresse dans les réglages et que ce serveur est allumé.");
  });

  it('coupure passagère (ECONNRESET) → AI_SERVER_UNAVAILABLE (nouvel essai possible)', async () => {
    const err = await catchError(() => collect(provider(mockFetch(() => { throw networkError('ECONNRESET'); })).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNAVAILABLE');
    expect(err.message).toBe('Le serveur universitaire est momentanément indisponible. Réessayez dans quelques instants.');
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

  it('health : modèle absent de la liste → avertissement NON bloquant (alias ou modèle virtuel possibles, WEB-AI-01)', async () => {
    const health = await provider(mockFetch(() => jsonResponse({ data: [{ id: 'autre-modele' }] }))).health();
    expect(health.ok).toBe(true);
    expect(health.error).toBeUndefined();
    expect(health.warning?.code).toBe('MODEL_NOT_INSTALLED');
    expect(health.warning?.message).toMatch(/^Le modèle « mistral-small » n'apparaît pas dans la liste des modèles : il peut s'agir d'un alias, la génération reste possible\./);
  });

  it('health : clé refusée, serveur injoignable', async () => {
    const auth = await provider(mockFetch(() => textResponse('{"error":"bad key"}', 401))).health();
    expect(auth.error?.code).toBe('AI_AUTH_FAILED');
    const down = await provider(mockFetch(() => { throw networkError('ECONNREFUSED'); })).health();
    expect(down.ok).toBe(false);
    expect(down.error?.code).toBe('AI_SERVER_UNREACHABLE');
    expect(down.error?.message).toMatch(/^Le serveur universitaire est injoignable à l'adresse configurée \(connexion refusée\)/);
  });

  it('refuse une configuration incomplète', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', model: 'x' })).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }));
  });
});

// ─── Compatibilité avec les fournisseurs réels (diagnostic providers-compat, cas T1 à T10) ─────────────

const OVH_BASE = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';

function webProvider(fetchImpl: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) {
  return new OpenAICompatibleProvider({
    baseUrl: OVH_BASE, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVHcloud AI Endpoints', recipient: 'administrateur',
    fetch: fetchImpl, now: () => Date.UTC(2026, 8, 28, 12, 0, 0), ...extra,
  });
}

describe('OpenAICompatibleProvider — test de santé fiable (WEB-AI-01, F4, WEB-AI-11)', () => {
  it('T1 Cloudflare : pas de /models (404 sur une adresse /…/v1) → « non vérifié », la génération reste possible', async () => {
    const fetchImpl = mockFetch(() => textResponse('{"success":false,"errors":[{"code":7003,"message":"No route for that URI"}]}', 404));
    const health = await webProvider(fetchImpl, { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT/ai/v1' }).health();
    expect(health.ok).toBe(true);
    expect(health.warning?.code).toBe('AI_STATUS_UNKNOWN');
    expect(health.warning?.message).toBe("Le serveur d'IA (OVHcloud AI Endpoints) ne fournit pas la liste de ses modèles : son état n'a pas pu être vérifié. La génération reste possible.");
  });

  it('405 sur /models → « non vérifié » ; 404 sur une adresse SANS /v… → erreur « ajoutez /v1 »', async () => {
    expect((await webProvider(mockFetch(() => textResponse('Method Not Allowed', 405))).health()).warning?.code).toBe('AI_STATUS_UNKNOWN');
    const noV1 = await webProvider(mockFetch(() => textResponse('<html>Not Found</html>', 404)), { baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net' }).health();
    expect(noV1.ok).toBe(false);
    expect(noV1.error?.code).toBe('AI_BAD_RESPONSE');
    expect(noV1.error?.message).toMatch(/L'administrateur du site doit vérifier AI_BASE_URL : elle se termine généralement par \/v1\./);
  });

  it('T2 Hugging Face : « org/modele:fastest » correspond à « org/modele » de /models', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ data: [{ id: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', providers: [] }] }));
    const health = await webProvider(fetchImpl, { baseUrl: 'https://router.huggingface.co/v1', model: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506:fastest' }).health();
    expect(health).toEqual({ ok: true });
  });

  it('T3 alias (Albert / OpenGateLLM, Mistral) : le nom du champ « aliases » est reconnu et listé', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ object: 'list', data: [
      { id: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', aliases: ['openweight-medium', 42] },
      { id: 'Mistral-Nemo-Instruct-2407' },
    ] }));
    const p = webProvider(fetchImpl, { baseUrl: 'https://albert.api.etalab.gouv.fr/v1', model: 'openweight-medium' });
    expect(await p.health()).toEqual({ ok: true });
    expect(await p.listModels()).toEqual([
      { name: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', aliases: ['openweight-medium'] },
      { name: 'Mistral-Nemo-Instruct-2407' },
    ]);
  });

  it('modèle virtuel OVH (« mistral@latest ») absent de la liste → avertissement non bloquant pour l’administrateur', async () => {
    const health = await webProvider(mockFetch(() => jsonResponse({ data: [{ id: 'Mistral-Nemo-Instruct-2407' }] })), { model: 'mistral@latest' }).health();
    expect(health.ok).toBe(true);
    expect(health.warning?.code).toBe('MODEL_NOT_INSTALLED');
    expect(health.warning?.message).toMatch(/l'administrateur du site doit vérifier AI_MODEL\.$/);
    expect(health.warning?.message).not.toMatch(/réglages/);
  });

  it('liste vide → « non vérifié »', async () => {
    expect((await webProvider(mockFetch(() => jsonResponse({ data: [] }))).health()).warning?.code).toBe('AI_STATUS_UNKNOWN');
  });

  it('T4 /models lent : le délai du test de santé (AbortSignal.timeout) donne « non vérifié », JAMAIS GENERATION_ABORTED', async () => {
    const slow = mockFetch((_url, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse({ data: [] })), 5_000);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));
    const started = Date.now();
    const health = await webProvider(slow).health(AbortSignal.timeout(50));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(health.ok).toBe(true);
    expect(health.error).toBeUndefined();
    expect(health.warning?.code).toBe('AI_STATUS_UNKNOWN');
    expect(health.warning?.message).toMatch(/a mis trop de temps à répondre à la vérification/);
    // listModels, lui, lève AI_TIMEOUT (et non « Génération interrompue. ») sur un simple délai.
    const err = await catchError(() => webProvider(slow).listModels(AbortSignal.timeout(50)));
    expect(err.code).toBe('AI_TIMEOUT');
    // Délai interne de la liste (sans signal de l'appelant) : AI_TIMEOUT également, donc « non vérifié ».
    expect((await webProvider(slow, { listTimeoutMs: 50 }).health()).warning?.code).toBe('AI_STATUS_UNKNOWN');
  });

  it('annulation par l’appelant : pas de GENERATION_ABORTED dans l’état', async () => {
    const controller = new AbortController();
    controller.abort();
    const health = await webProvider(mockFetch(() => never())).health(controller.signal);
    expect(health.ok).toBe(true);
    expect(health.warning?.code).toBe('AI_STATUS_UNKNOWN');
  });

  it('quota épuisé sur /models → bloquant avec l’heure de reprise ; surcharge passagère → avertissement', async () => {
    const quota = await webProvider(mockFetch(() => new Response('{"error":{"message":"free-models-per-day"}}', { status: 429, headers: { 'retry-after': '3600' } }))).health();
    expect(quota.ok).toBe(false);
    expect(quota.error?.code).toBe('AI_QUOTA_EXCEEDED');
    const busy = await webProvider(mockFetch(() => textResponse('Too Many Requests', 429))).health();
    expect(busy).toMatchObject({ ok: true, warning: { code: 'AI_BUSY' } });
  });

  it('serveur injoignable depuis l’hébergeur (Ollama du PC de l’enseignant sur Vercel) → AI_SERVER_UNREACHABLE avec le conseil « Vercel »', async () => {
    const health = await webProvider(mockFetch(() => { throw networkError('ECONNREFUSED'); }), { baseUrl: 'http://192.168.1.20:11434/v1' }).health();
    expect(health.ok).toBe(false);
    expect(health.error?.code).toBe('AI_SERVER_UNREACHABLE');
    expect(health.error?.message).toMatch(/Vercel/);
  });
});

describe('OpenAICompatibleProvider — offres gratuites et quotas (WEB-AI-03/04/08/09/10)', () => {
  it('T6 OpenRouter : 429 « free-models-per-day » → AI_QUOTA_EXCEEDED avec l’heure de reprise, en UNE seule requête', async () => {
    const reset = String(Date.UTC(2026, 8, 29));
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
    }));
    const err = await catchError(() => collect(webProvider(fetchImpl, { baseUrl: 'https://openrouter.ai/api/v1', label: 'OpenRouter' }).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_QUOTA_EXCEEDED');
    expect(err.message).toBe("Le quota d'utilisation du serveur d'IA (OpenRouter) est atteint : réessayez demain vers 2 h 00 (heure de Paris).");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('T8 OVHcloud anonyme : 429 + Retry-After court → AI_BUSY portant l’attente ; long → quota', async () => {
    const short = await catchError(() => collect(webProvider(mockFetch(() => new Response('{"message":"Rate limit exceeded"}', { status: 429, headers: { 'retry-after': '8' } }))).stream({ messages: MESSAGES })));
    expect(short).toMatchObject({ code: 'AI_BUSY', retryAfterMs: 8_000 });
    const long = await catchError(() => collect(webProvider(mockFetch(() => new Response('{"message":"Rate limit exceeded"}', { status: 429, headers: { 'retry-after': '55' } }))).stream({ messages: MESSAGES })));
    expect(long).toMatchObject({ code: 'AI_QUOTA_EXCEEDED', retryAfterMs: 55_000 });
    expect(long.message).toMatch(/réessayez dans 55 s\.$/);
  });

  it('T7 Groq : 413 « tokens per minute (TPM) » → quota (réduire AI_MAX_OUTPUT_TOKENS), pas « retirez des documents »', async () => {
    const body = JSON.stringify({ error: { message: 'Request too large for model `llama-3.1-8b-instant` on tokens per minute (TPM): Limit 6000, Requested 7400', type: 'tokens', code: 'rate_limit_exceeded' } });
    const err = await catchError(() => collect(webProvider(mockFetch(() => textResponse(body, 413))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_QUOTA_EXCEEDED');
    expect(err.message).toMatch(/AI_MAX_OUTPUT_TOKENS/);
  });

  it('T2b Hugging Face : 402 crédits épuisés → AI_QUOTA_EXCEEDED', async () => {
    const err = await catchError(() => collect(webProvider(mockFetch(() => textResponse('{"error":"You have exceeded your monthly included credits for Inference Providers."}', 402))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_QUOTA_EXCEEDED');
    expect(err.message).toMatch(/crédits/);
  });

  it('T5b / T6b : modèle inconnu (Mistral « Invalid model », OpenRouter « not a valid model ID ») → MODEL_NOT_INSTALLED', async () => {
    const mistral = await catchError(() => collect(webProvider(mockFetch(() => textResponse('{"object":"error","message":"Invalid model: ministral-99b","type":"invalid_model","param":null,"code":"1500"}', 400)), { model: 'ministral-99b' }).stream({ messages: MESSAGES })));
    expect(mistral.code).toBe('MODEL_NOT_INSTALLED');
    expect(mistral.message).toBe("Le modèle « ministral-99b » n'est pas disponible sur le serveur d'IA (OVHcloud AI Endpoints). L'administrateur du site doit vérifier AI_MODEL.");
    const openrouter = await catchError(() => collect(webProvider(mockFetch(() => textResponse('{"error":{"message":"mistralai/x is not a valid model ID","code":400}}', 400))).stream({ messages: MESSAGES })));
    expect(openrouter.code).toBe('MODEL_NOT_INSTALLED');
  });

  it('T5 finish_reason « model_length » (Mistral) → réponse tronquée ; « content_filter » → « unknown » même avec [DONE]', async () => {
    const mistral = await collect(webProvider(mockFetch(() => streamResponse(streamBody([`${sseChunk('Début… ')}${sseChunk('et fin', 'model_length')}data: [DONE]\n\n`])))).stream({ messages: MESSAGES }));
    expect(endOf(mistral).finishReason).toBe('length');
    const filtered = await collect(webProvider(mockFetch(() => streamResponse(streamBody([`${sseChunk('Texte')}${sseChunk(null, 'content_filter')}data: [DONE]\n\n`])))).stream({ messages: MESSAGES }));
    expect(endOf(filtered).finishReason).toBe('unknown');
    const eos = await collect(webProvider(mockFetch(() => streamResponse(streamBody([`${sseChunk('ok', 'eos')}data: [DONE]\n\n`])))).stream({ messages: MESSAGES }));
    expect(endOf(eos).finishReason).toBe('stop');
    const json = await collect(webProvider(mockFetch(() => jsonResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'error' }] }))).stream({ messages: MESSAGES }));
    expect(endOf(json).finishReason).toBe('unknown');
  });

  it('erreur au milieu du flux avec type « invalid_model » → MODEL_NOT_INSTALLED', async () => {
    const sse = `data: ${JSON.stringify({ error: { message: 'bad', type: 'invalid_model', code: 400 } })}\n\n`;
    const err = await catchError(() => collect(webProvider(mockFetch(() => streamResponse(streamBody([sse])))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('MODEL_NOT_INSTALLED');
  });

  it('T0 : aucun paramètre non standard n’est envoyé ; clé facultative (aucun en-tête Authorization sans clé)', async () => {
    const fetchImpl = mockFetch(() => streamResponse(streamBody([`${sseChunk('ok', 'stop')}data: [DONE]\n\n`])));
    await collect(webProvider(fetchImpl).stream({ messages: MESSAGES, maxTokens: 4_000 }));
    expect(Object.keys(fetchImpl.calls[0].body as object).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'temperature']);
    expect((fetchImpl.calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('connexion refusée par un VRAI port fermé (fetch de Node) → AI_SERVER_UNREACHABLE pour l’administrateur', async () => {
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    const p = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', recipient: 'administrateur' });
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNREACHABLE');
    expect(err.message).toMatch(/^Le serveur d'IA est injoignable à l'adresse configurée \(connexion refusée\)\. L'administrateur du site doit vérifier AI_BASE_URL/);
    expect(err.message).toMatch(/Vercel/);
    expect((await p.health()).error?.code).toBe('AI_SERVER_UNREACHABLE');
  });
});
