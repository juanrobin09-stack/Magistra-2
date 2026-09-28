import { describe, expect, it } from 'vitest';
import { createProvider } from '../../shared/ai/factory';
import { getTier } from '../../shared/ai/models';
import { DEFAULT_OLLAMA_URL, isLoopbackUrl, OllamaClient, OllamaProvider, sameModel, type PullProgress } from '../../shared/ai/ollama';
import type { StreamEvent } from '../../shared/ai/provider';
import {
  catchError, collect, jsonResponse, mockFetch, networkError, never, ollamaLine, sleep, splitBytes, streamBody, streamResponse,
  textResponse,
} from './helpers';

const MESSAGES = [{ role: 'system' as const, content: 'Tu es Magistra.' }, { role: 'user' as const, content: 'Un cours.' }];
const STANDARD = getTier('standard');

function localProvider(fetchImpl: ReturnType<typeof mockFetch>, extra: Partial<ConstructorParameters<typeof OllamaProvider>[0]> = {}) {
  return new OllamaProvider({ model: STANDARD.model, label: STANDARD.label, contextTokens: STANDARD.contextTokens, fetch: fetchImpl, ...extra });
}

function textOf(events: StreamEvent[]): string {
  return events.map(e => (e.type === 'delta' ? e.text : '')).join('');
}

function endOf(events: StreamEvent[]) {
  const end = events[events.length - 1];
  if (end?.type !== 'end') throw new Error('évènement de fin manquant');
  return end;
}

describe('OllamaProvider — /api/chat (NDJSON)', () => {
  it('lit un flux NDJSON coupé en morceaux, ignore « thinking », et envoie num_ctx / num_predict', async () => {
    const ndjson = [
      ollamaLine('', { message: { role: 'assistant', content: '', thinking: 'Je réfléchis à la structure…' } }),
      ollamaLine('# Les fractions\n\n'),
      ollamaLine('Une fraction représente un partage équitable.'),
      `${JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 321, eval_count: 45 })}\n`,
    ].join('');
    const fetchImpl = mockFetch(() => streamResponse(streamBody(splitBytes(ndjson, 11)), 'application/x-ndjson'));
    const events = await collect(localProvider(fetchImpl).stream({ messages: MESSAGES, maxTokens: 900, temperature: 0.2 }));
    expect(textOf(events)).toBe('# Les fractions\n\nUne fraction représente un partage équitable.');
    expect(textOf(events)).not.toContain('réfléchis');
    expect(endOf(events)).toEqual({ type: 'end', finishReason: 'stop', usage: { promptTokens: 321, completionTokens: 45 } });

    const call = fetchImpl.calls[0];
    expect(call.url).toBe(`${DEFAULT_OLLAMA_URL}/api/chat`);
    expect(call.body).toMatchObject({
      model: 'ministral-3:14b',
      messages: MESSAGES,
      stream: true,
      options: { num_ctx: STANDARD.contextTokens, num_predict: 900, temperature: 0.2 },
    });
    expect((call.body as { keep_alive?: string }).keep_alive).toBeTruthy();
  });

  it('done_reason « length » → réponse tronquée', async () => {
    const ndjson = `${ollamaLine('Texte long')}${JSON.stringify({ done: true, done_reason: 'length' })}\n`;
    const events = await collect(localProvider(mockFetch(() => streamResponse(streamBody([ndjson])))).stream({ messages: MESSAGES }));
    expect(endOf(events).finishReason).toBe('length');
  });

  it('flux terminé sans « done » → « unknown » (réponse possiblement incomplète)', async () => {
    const events = await collect(localProvider(mockFetch(() => streamResponse(streamBody([ollamaLine('Début')])))).stream({ messages: MESSAGES }));
    expect(textOf(events)).toBe('Début');
    expect(endOf(events).finishReason).toBe('unknown');
  });

  it('sans maxTokens, num_predict vaut -1 (pas de limite imposée)', async () => {
    const fetchImpl = mockFetch(() => streamResponse(streamBody([`${JSON.stringify({ done: true, done_reason: 'stop' })}\n`])));
    await collect(localProvider(fetchImpl).stream({ messages: MESSAGES }));
    expect((fetchImpl.calls[0].body as { options: { num_predict: number } }).options.num_predict).toBe(-1);
  });
});

describe('OllamaProvider — erreurs compréhensibles', () => {
  it('404 « model not found » → MODEL_NOT_INSTALLED avec le libellé « Magistra Standard »', async () => {
    const fetchImpl = mockFetch(() => textResponse(JSON.stringify({ error: 'model "ministral-3:14b" not found, try pulling it first' }), 404));
    const err = await catchError(() => collect(localProvider(fetchImpl).stream({ messages: MESSAGES })));
    expect(err.code).toBe('MODEL_NOT_INSTALLED');
    expect(err.message).toBe("Le modèle Magistra Standard n'est pas encore installé.");
  });

  it('« requires more system memory » → OUT_OF_MEMORY', async () => {
    const fetchImpl = mockFetch(() => textResponse(JSON.stringify({ error: 'model requires more system memory (12.3 GiB) than is available (7.1 GiB)' }), 500));
    const err = await catchError(() => collect(localProvider(fetchImpl).stream({ messages: MESSAGES })));
    expect(err.code).toBe('OUT_OF_MEMORY');
    expect(err.message).toMatch(/^Mémoire insuffisante pour ce modèle\./);
    expect(err.message).not.toMatch(/GiB/);
  });

  it('erreur envoyée au milieu du flux (mémoire épuisée pendant la génération)', async () => {
    const ndjson = `${ollamaLine('Début')}${JSON.stringify({ error: 'llama runner process has terminated: cudaMalloc failed: out of memory' })}\n`;
    const err = await catchError(() => collect(localProvider(mockFetch(() => streamResponse(streamBody([ndjson])))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('OUT_OF_MEMORY');
  });

  it('500 générique en local → message du moteur local, sans détail technique', async () => {
    const err = await catchError(() => collect(localProvider(mockFetch(() => textResponse('{"error":"panic: runtime error: index out of range [3]"}', 500))).stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNAVAILABLE');
    expect(err.message).toBe('Le moteur IA local a rencontré une erreur. Réessayez dans quelques instants.');
  });

  it('ECONNREFUSED en local → « Moteur IA non démarré. »', async () => {
    const err = await catchError(() => collect(localProvider(mockFetch(() => { throw networkError('ECONNREFUSED'); })).stream({ messages: MESSAGES })));
    expect(err.code).toBe('ENGINE_NOT_RUNNING');
    expect(err.message).toBe('Moteur IA non démarré.');
  });

  it('Ollama distant injoignable → libellé du serveur', async () => {
    const p = new OllamaProvider({ baseUrl: 'http://ia.univ-exemple.fr:11434', model: 'mistral-small3.2:24b', label: 'Serveur universitaire', fetch: mockFetch(() => { throw networkError('EHOSTUNREACH'); }) });
    expect(p.local).toBe(false);
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNAVAILABLE');
    expect(err.message).toBe('Serveur universitaire indisponible. Réessayez dans quelques instants.');
  });

  it('annulation → GENERATION_ABORTED et flux libéré', async () => {
    const body = streamBody([ollamaLine('Premier')], { hang: true });
    const fetchImpl = mockFetch(() => streamResponse(body));
    const controller = new AbortController();
    const err = await catchError(async () => {
      for await (const event of localProvider(fetchImpl).stream({ messages: MESSAGES, signal: controller.signal })) {
        if (event.type === 'delta') controller.abort();
      }
    });
    expect(err.code).toBe('GENERATION_ABORTED');
    await sleep(0);
    expect(body.cancelled()).toBe(true);
  });

  it('chargement du modèle trop long (aucune réponse) → AI_TIMEOUT, message propre au moteur local', async () => {
    const p = localProvider(mockFetch(() => never()), { timeouts: { firstChunkMs: 50, idleMs: 50 } });
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.message).toMatch(/^Le moteur IA local met trop de temps à répondre/);
    expect(err.message).not.toMatch(/serveur/i);
  });

  it('délai dépassé sur un Ollama distant → message « serveur » (pas « moteur local »)', async () => {
    const p = new OllamaProvider({
      baseUrl: 'http://ia.univ-exemple.fr:11434', model: 'mistral-small3.2:24b', label: 'Serveur universitaire',
      fetch: mockFetch(() => never()), timeouts: { firstChunkMs: 50, idleMs: 50 },
    });
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.message).not.toMatch(/moteur IA local/);
  });
});

describe('OllamaProvider — health', () => {
  it('moteur absent', async () => {
    const health = await localProvider(mockFetch(() => { throw networkError('ECONNREFUSED'); })).health();
    expect(health).toEqual({ ok: false, error: { code: 'ENGINE_NOT_RUNNING', message: 'Moteur IA non démarré.' } });
  });

  it('moteur démarré, modèle absent', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/version')
      ? jsonResponse({ version: '0.12.3' })
      : jsonResponse({ models: [{ name: 'ministral-3:8b', size: 6e9 }] })));
    const health = await localProvider(fetchImpl).health();
    expect(health).toEqual({
      ok: false,
      version: '0.12.3',
      error: { code: 'MODEL_NOT_INSTALLED', message: "Le modèle Magistra Standard n'est pas encore installé." },
    });
  });

  it('prêt', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/version')
      ? jsonResponse({ version: '0.12.3' })
      : jsonResponse({ models: [{ name: 'ministral-3:14b', size: 9e9, details: { parameter_size: '14B', family: 'mistral3' } }] })));
    const p = localProvider(fetchImpl);
    expect(await p.health()).toEqual({ ok: true, version: '0.12.3' });
    expect(await p.listModels()).toEqual([{ name: 'ministral-3:14b', sizeBytes: 9e9, parameterSize: '14B', family: 'mistral3' }]);
  });
});

describe('OllamaClient.pull', () => {
  const client = (fetchImpl: ReturnType<typeof mockFetch>) => new OllamaClient(DEFAULT_OLLAMA_URL, fetchImpl);

  it('rapporte la progression et se termine sur « success »', async () => {
    const lines = [
      { status: 'pulling manifest' },
      { status: 'pulling 6a0746a1ec1a', digest: 'sha256:6a07', total: 9_000_000_000, completed: 1_000_000_000 },
      { status: 'pulling 6a0746a1ec1a', digest: 'sha256:6a07', total: 9_000_000_000, completed: 9_000_000_000 },
      { status: 'verifying sha256 digest' },
      { status: 'writing manifest' },
      { status: 'success' },
    ].map(l => `${JSON.stringify(l)}\n`).join('');
    const fetchImpl = mockFetch(() => streamResponse(streamBody(splitBytes(lines, 23)), 'application/x-ndjson'));
    const progress: PullProgress[] = [];
    await client(fetchImpl).pull('ministral-3:14b', p => progress.push(p));
    expect(fetchImpl.calls[0].url).toBe(`${DEFAULT_OLLAMA_URL}/api/pull`);
    expect(fetchImpl.calls[0].body).toEqual({ model: 'ministral-3:14b', stream: true });
    expect(progress.map(p => p.status)).toEqual(['pulling manifest', 'pulling 6a0746a1ec1a', 'pulling 6a0746a1ec1a', 'verifying sha256 digest', 'writing manifest', 'success']);
    expect(progress[1]).toMatchObject({ completed: 1_000_000_000, total: 9_000_000_000 });
  });

  it('erreur réseau pendant le téléchargement → NETWORK_ERROR (reprise possible)', async () => {
    const lines = `${JSON.stringify({ status: 'pulling manifest' })}\n${JSON.stringify({ error: 'pull model manifest: Get "https://registry.ollama.ai/v2/library/ministral-3/manifests/14b": dial tcp: lookup registry.ollama.ai: no such host' })}\n`;
    const err = await catchError(() => client(mockFetch(() => streamResponse(streamBody([lines])))).pull('ministral-3:14b', () => {}));
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toMatch(/vérifiez votre connexion Internet/);
    expect(err.message).not.toMatch(/registry|dial tcp/);
  });

  it('flux interrompu sans « success » → échec explicite', async () => {
    const lines = `${JSON.stringify({ status: 'pulling 6a07', total: 100, completed: 40 })}\n`;
    const err = await catchError(() => client(mockFetch(() => streamResponse(streamBody([lines])))).pull('ministral-3:14b', () => {}));
    expect(err.code).toBe('AI_BAD_RESPONSE');
    expect(err.message).toMatch(/ne s’est pas terminé.*reprendra/);
  });

  it('connexion coupée pendant le téléchargement → échec explicite', async () => {
    const body = streamBody([`${JSON.stringify({ status: 'pulling 6a07', total: 100, completed: 40 })}\n`], { error: new TypeError('terminated') });
    const err = await catchError(() => client(mockFetch(() => streamResponse(body))).pull('ministral-3:14b', () => {}));
    expect(err.code).toBe('AI_BAD_RESPONSE');
    expect(err.message).toMatch(/reprendra/);
  });

  it('moteur arrêté, disque plein, modèle inconnu, version trop ancienne', async () => {
    expect((await catchError(() => client(mockFetch(() => { throw networkError(); })).pull('x', () => {}))).code).toBe('ENGINE_NOT_RUNNING');
    const disk = await catchError(() => client(mockFetch(() => textResponse('{"error":"write /models/blobs: no space left on device"}', 500))).pull('x', () => {}));
    expect(disk.message).toBe('Espace disque insuffisant pour installer ce modèle.');
    const unknown = await catchError(() => client(mockFetch(() => streamResponse(streamBody([`${JSON.stringify({ error: 'pull model manifest: file does not exist' })}\n`])))).pull('x', () => {}));
    expect(unknown.message).toMatch(/introuvable dans la bibliothèque Ollama/);
    const old = await catchError(() => client(mockFetch(() => textResponse('{"error":"pull model manifest: 412: The model you are attempting to pull requires a newer version of Ollama."}', 412))).pull('x', () => {}));
    expect(old.message).toMatch(/version plus récente/);
  });

  it('annulation → « Téléchargement interrompu. »', async () => {
    const controller = new AbortController();
    const body = streamBody([`${JSON.stringify({ status: 'pulling 6a07', total: 100, completed: 1 })}\n`], { hang: true });
    const pending = client(mockFetch(() => streamResponse(body))).pull('x', () => controller.abort(), controller.signal);
    const err = await catchError(() => pending);
    expect(err.code).toBe('GENERATION_ABORTED');
    expect(err.message).toBe('Téléchargement interrompu.');
  });
});

describe('utilitaires Ollama', () => {
  it('sameModel', () => {
    expect(sameModel('ministral-3:14b', 'ministral-3:14b')).toBe(true);
    expect(sameModel('mistral', 'mistral:latest')).toBe(true);
    expect(sameModel('Ministral-3:14B', 'ministral-3:14b')).toBe(true);
    expect(sameModel('registry.ollama.ai/library/ministral-3:14b', 'ministral-3:14b')).toBe(true);
    expect(sameModel('ministral-3:8b', 'ministral-3:14b')).toBe(false);
    expect(sameModel('ministral-3', 'ministral-3:14b')).toBe(false);
    expect(sameModel('hf.co/org/modele-gguf', 'hf.co/org/modele-gguf:latest')).toBe(true);
  });

  it('isLoopbackUrl', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.20:11434')).toBe(false);
    expect(isLoopbackUrl('pas une url')).toBe(false);
  });

  it('createProvider : Ollama local par défaut, serveur compatible OpenAI, configuration manquante', () => {
    const ollama = createProvider({ kind: 'ollama', model: 'ministral-3:14b', label: 'Magistra Standard' });
    expect(ollama.kind).toBe('ollama');
    expect(ollama.local).toBe(true);
    const remote = createProvider({ kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'm', label: 'Serveur universitaire' });
    expect(remote.kind).toBe('openai-compatible');
    expect(remote.local).toBe(false);
    expect(() => createProvider({ kind: 'openai-compatible', baseUrl: '', model: 'm' })).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }));
    expect(() => createProvider({ kind: 'ollama', model: '' })).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }));
  });
});
