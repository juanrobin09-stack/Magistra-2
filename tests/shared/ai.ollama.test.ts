import { describe, expect, it } from 'vitest';
import { createProvider } from '../../shared/ai/factory';
import { getTier } from '../../shared/ai/models';
import {
  DEFAULT_OLLAMA_URL, estimatePromptTokens, isLoopbackUrl, localFirstChunkTimeoutMs, OLLAMA_FIRST_CHUNK_MS, OllamaClient, OllamaProvider,
  PRELOAD_TIMEOUT_MS, PULL_VERIFY_IDLE_MS, sameModel, type PullProgress,
} from '../../shared/ai/ollama';
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
    expect(endOf(events)).toMatchObject({ type: 'end', finishReason: 'stop', usage: { promptTokens: 321, completionTokens: 45 } });
    // Dernier objet sans aucune durée : pas de mesures du moteur inventées ; le premier mot est mesuré côté client.
    expect(endOf(events).usage?.timings).toBeUndefined();
    expect(endOf(events).usage?.timeToFirstDeltaMs).toBeGreaterThanOrEqual(0);

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

  it('Ollama distant injoignable → libellé du serveur, AI_SERVER_UNREACHABLE (pas de nouvel essai automatique, F5)', async () => {
    const p = new OllamaProvider({ baseUrl: 'http://ia.univ-exemple.fr:11434', model: 'mistral-small3.2:24b', label: 'Serveur universitaire', fetch: mockFetch(() => { throw networkError('EHOSTUNREACH'); }) });
    expect(p.local).toBe(false);
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNREACHABLE');
    expect(err.message).toBe("Le serveur universitaire est injoignable à l'adresse configurée (réseau inaccessible) : vérifiez l'adresse dans les réglages et que ce serveur est allumé.");
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
    expect(isLoopbackUrl('http://127.0.0.2:11434')).toBe(true);
    expect(isLoopbackUrl('http://127.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.20:11434')).toBe(false);
    // Un nom de domaine commençant par « 127. » n'est PAS la boucle locale.
    expect(isLoopbackUrl('http://127.evil.com:11434')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.com:11434')).toBe(false);
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

// ─── Corrections du diagnostic (WEB-AI-05, F9, WEB-AI-11, formats réels d'Ollama v0.34.4) ────────────────

const REMOTE_URL = 'https://ollama.lycee-exemple.fr';
const KEY = 'cle-proxy-ollama-123456';

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe('OllamaProvider — clé d’accès (proxy à clé devant Ollama, WEB-AI-05)', () => {
  it('« Authorization: Bearer » sur /api/version, /api/tags, /api/chat et /api/pull ; jamais sans clé', async () => {
    const fetchImpl = mockFetch(url => {
      if (url.endsWith('/api/version')) return jsonResponse({ version: '0.34.4' });
      if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'ministral-3:14b', size: 9e9 }] });
      if (url.endsWith('/api/pull')) return streamResponse(streamBody([`${JSON.stringify({ status: 'success' })}\n`]), 'application/x-ndjson');
      return streamResponse(streamBody([`${JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })}\n`]), 'application/x-ndjson');
    });
    const p = new OllamaProvider({ baseUrl: REMOTE_URL, model: 'ministral-3:14b', apiKey: KEY, recipient: 'administrateur', fetch: fetchImpl });
    expect(await p.health()).toEqual({ ok: true, version: '0.34.4' });
    await collect(p.stream({ messages: MESSAGES }));
    await p.client.pull('ministral-3:14b', () => {});
    expect(fetchImpl.calls.map(c => new URL(c.url).pathname)).toEqual(['/api/version', '/api/tags', '/api/chat', '/api/pull']);
    for (const call of fetchImpl.calls) expect(headerOf(call.init, 'authorization'), call.url).toBe(`Bearer ${KEY}`);

    const noKey = mockFetch(() => jsonResponse({ version: '0.34.4' }));
    await new OllamaClient(REMOTE_URL, noKey).version();
    expect(headerOf(noKey.calls[0].init, 'authorization')).toBeNull();
  });

  it('401 / 403 sur /api/version → AI_AUTH_FAILED (et non « indisponible »), sans la clé dans le message', async () => {
    for (const status of [401, 403]) {
      const p = new OllamaProvider({ baseUrl: REMOTE_URL, model: 'ministral-3:14b', apiKey: KEY, recipient: 'administrateur', fetch: mockFetch(() => textResponse('{"error":"unauthorized"}', status)) });
      const health = await p.health();
      expect(health.ok).toBe(false);
      expect(health.error?.code).toBe('AI_AUTH_FAILED');
      expect(health.error?.message).toBe("Le serveur d'IA a refusé l'accès (clé d'accès refusée). L'administrateur du site doit vérifier AI_API_KEY.");
      expect(health.error?.message).not.toContain(KEY);
    }
  });
});

describe('OllamaProvider — libellés séparés et destinataire (F9)', () => {
  it('serveur web : le libellé du serveur n’est plus pris pour un nom de modèle', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/version') ? jsonResponse({ version: '0.34.4' }) : jsonResponse({ models: [{ name: 'ministral-3:8b', size: 6e9 }] })));
    const p = new OllamaProvider({ model: 'ministral-3:14b', label: "Serveur d'IA", recipient: 'administrateur', fetch: fetchImpl });
    expect([p.label, p.modelLabel, p.serverLabel]).toEqual(["Serveur d'IA", 'Magistra Standard', "Serveur d'IA"]);
    const health = await p.health();
    expect(health.error).toEqual({
      code: 'MODEL_NOT_INSTALLED',
      message: "Le modèle « ministral-3:14b » n'est pas installé sur le serveur d'IA. L'administrateur du site doit l'installer (ollama pull ministral-3:14b) ou corriger AI_MODEL.",
    });
  });

  it('serveur web avec Ollama sur sa boucle locale, arrêté → AI_SERVER_UNREACHABLE pour l’administrateur (pas « Moteur IA non démarré »)', async () => {
    const p = new OllamaProvider({ model: 'ministral-3:14b', label: "Serveur d'IA", recipient: 'administrateur', fetch: mockFetch(() => { throw networkError('ECONNREFUSED'); }) });
    const health = await p.health();
    expect(health.error?.code).toBe('AI_SERVER_UNREACHABLE');
    expect(health.error?.message).toMatch(/L'administrateur du site doit vérifier AI_BASE_URL/);
    const err = await catchError(() => collect(p.stream({ messages: MESSAGES })));
    expect(err.code).toBe('AI_SERVER_UNREACHABLE');
  });

  it('défauts : libellé du niveau (alias compris) sur ce poste, « Serveur d’IA » ailleurs', () => {
    const local = new OllamaProvider({ model: 'ministral-3:latest' });
    expect([local.label, local.modelLabel, local.serverLabel]).toEqual(['Magistra Léger', 'Magistra Léger', 'Le moteur IA local']);
    const custom = new OllamaProvider({ model: 'qwen3:8b', label: 'qwen3:8b' });
    expect([custom.label, custom.modelLabel]).toEqual(['qwen3:8b', 'qwen3:8b']);
    const remote = new OllamaProvider({ baseUrl: REMOTE_URL, model: 'ministral-3:14b' });
    expect([remote.label, remote.serverLabel, remote.modelLabel]).toEqual(["Serveur d'IA", "Serveur d'IA", 'Magistra Standard']);
    const explicit = new OllamaProvider({ baseUrl: REMOTE_URL, model: 'm', modelLabel: 'Mon modèle', serverLabel: 'Serveur du lycée' });
    expect([explicit.label, explicit.modelLabel, explicit.serverLabel]).toEqual(['Serveur du lycée', 'Mon modèle', 'Serveur du lycée']);
  });
});

describe('OllamaProvider — health respecte le signal (WEB-AI-11)', () => {
  it('délai du test de santé dépassé → « non vérifié », jamais GENERATION_ABORTED', async () => {
    const hang = mockFetch(() => never());
    const p = new OllamaProvider({ baseUrl: REMOTE_URL, model: 'ministral-3:14b', recipient: 'administrateur', fetch: hang });
    const started = Date.now();
    const health = await p.health(AbortSignal.timeout(50));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(health.ok).toBe(true);
    expect(health.warning?.code).toBe('AI_STATUS_UNKNOWN');
    expect((hang.calls[0].init?.signal as AbortSignal).aborted).toBe(true);
  });

  it('délai dépassé pendant /api/tags → « non vérifié » avec la version', async () => {
    const fetchImpl = mockFetch(url => (url.endsWith('/api/version') ? jsonResponse({ version: '0.34.4' }) : never()));
    const health = await new OllamaProvider({ baseUrl: REMOTE_URL, model: 'm', fetch: fetchImpl }).health(AbortSignal.timeout(80));
    expect(health).toMatchObject({ ok: true, version: '0.34.4', warning: { code: 'AI_STATUS_UNKNOWN' } });
  });

  it('adresse qui ne répond pas comme Ollama (404 sur /api/version) → conseil « sans /v1 »', async () => {
    const health = await new OllamaProvider({ baseUrl: `${REMOTE_URL}/v1`, model: 'm', recipient: 'administrateur', fetch: mockFetch(() => textResponse('404 page not found', 404)) }).health();
    expect(health.error?.code).toBe('AI_BAD_RESPONSE');
    expect(health.error?.message).toMatch(/l'adresse ne se termine pas par \/v1/);
  });
});

describe('OllamaProvider — moteur local de Windows (formats réels d’Ollama v0.34.4)', () => {
  it('think:false est envoyé à /api/chat (pas de « réflexion » invisible)', async () => {
    const fetchImpl = mockFetch(() => streamResponse(streamBody([`${JSON.stringify({ done: true, done_reason: 'stop' })}\n`])));
    await collect(localProvider(fetchImpl).stream({ messages: MESSAGES }));
    expect((fetchImpl.calls[0].body as { think?: unknown }).think).toBe(false);
  });

  it('erreurs mémoire de llama-server → OUT_OF_MEMORY (au démarrage et en cours de flux)', async () => {
    for (const e of ['llama-server reported out-of-memory during startup: exit status 1', 'unable to load full model on GPU']) {
      const err = await catchError(() => collect(localProvider(mockFetch(() => textResponse(JSON.stringify({ error: e }), 500))).stream({ messages: MESSAGES })));
      expect(err.code, e).toBe('OUT_OF_MEMORY');
    }
    const ndjson = `${ollamaLine('Début')}${JSON.stringify({ error: 'ggml_backend_sched_alloc_splits: failed to reserve graph buffers' })}\n`;
    expect((await catchError(() => collect(localProvider(mockFetch(() => streamResponse(streamBody([ndjson])))).stream({ messages: MESSAGES })))).code).toBe('OUT_OF_MEMORY');
  });

  it('délai du premier mot adapté à la taille du prompt (moteur local seulement)', () => {
    expect(localFirstChunkTimeoutMs(0)).toBe(OLLAMA_FIRST_CHUNK_MS);
    expect(localFirstChunkTimeoutMs(1_000)).toBe(300_000);
    expect(localFirstChunkTimeoutMs(7_000)).toBe(820_000);
    expect(localFirstChunkTimeoutMs(1_000_000)).toBe(30 * 60_000);
    const longPrompt = [{ role: 'user' as const, content: 'x'.repeat(21_000) }];
    expect(estimatePromptTokens(longPrompt)).toBe(7_008);
    expect(localProvider(mockFetch(() => never())).firstChunkTimeoutMs(longPrompt)).toBe(localFirstChunkTimeoutMs(7_008));
    expect(localProvider(mockFetch(() => never()), { timeouts: { firstChunkMs: 50 } }).firstChunkTimeoutMs(longPrompt)).toBe(50);
    expect(new OllamaProvider({ baseUrl: REMOTE_URL, model: 'm' }).firstChunkTimeoutMs(longPrompt)).toBe(OLLAMA_FIRST_CHUNK_MS);
  });
});

describe('OllamaProvider.preload — chargement du modèle sans génération', () => {
  const loaded = () => jsonResponse({ model: 'ministral-3:14b', created_at: '2026-09-28T10:00:00Z', message: { role: 'assistant', content: '' }, done: true, done_reason: 'load' });

  it('POST /api/chat avec messages [] , keep_alive et le même num_ctx que la génération ; réponse « load »', async () => {
    const fetchImpl = mockFetch(() => loaded());
    await localProvider(fetchImpl).preload();
    expect(fetchImpl.calls[0].url).toBe(`${DEFAULT_OLLAMA_URL}/api/chat`);
    expect(fetchImpl.calls[0].body).toEqual({ model: 'ministral-3:14b', messages: [], stream: false, keep_alive: '15m', options: { num_ctx: STANDARD.contextTokens } });
    expect(PRELOAD_TIMEOUT_MS).toBe(600_000);
  });

  it('durée de chargement annoncée par le moteur (load_duration, en nanosecondes) rendue en millisecondes', async () => {
    const withDuration = () => jsonResponse({ model: 'ministral-3:14b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'load', total_duration: 4_300_000_000, load_duration: 4_200_000_000 });
    expect(await localProvider(mockFetch(() => withDuration())).preload()).toEqual({ loadMs: 4_200 });
  });

  it('sans durée, ou durée inexploitable : aucun résultat (jamais une valeur inventée)', async () => {
    expect(await localProvider(mockFetch(() => loaded())).preload()).toBeUndefined();
    for (const load_duration of [-1, 'long', null, Number.NaN]) {
      const odd = () => jsonResponse({ done: true, done_reason: 'load', load_duration });
      expect(await localProvider(mockFetch(() => odd())).preload(), String(load_duration)).toBeUndefined();
    }
  });

  it('serveur qui répond par un flux (faux Ollama) : la première ligne suffit, la connexion est libérée', async () => {
    const body = streamBody([ollamaLine('Un')], { hang: true });
    const fetchImpl = mockFetch(() => streamResponse(body, 'application/x-ndjson'));
    await localProvider(fetchImpl).preload();
    await sleep(0);
    expect(body.cancelled()).toBe(true);
  });

  it('modèle absent, mémoire insuffisante, moteur arrêté, délai dépassé, annulation', async () => {
    const missing = await catchError(() => localProvider(mockFetch(() => textResponse('{"error":"model \\"ministral-3:14b\\" not found, try pulling it first"}', 404))).preload());
    expect([missing.code, missing.message]).toEqual(['MODEL_NOT_INSTALLED', "Le modèle Magistra Standard n'est pas encore installé."]);
    expect((await catchError(() => localProvider(mockFetch(() => textResponse('{"error":"model requires more system memory (12.3 GiB) than is available (7.1 GiB)"}', 500))).preload())).code).toBe('OUT_OF_MEMORY');
    expect((await catchError(() => localProvider(mockFetch(() => { throw networkError('ECONNREFUSED'); })).preload())).code).toBe('ENGINE_NOT_RUNNING');
    const slow = await catchError(() => localProvider(mockFetch(() => never())).preload({ timeoutMs: 50 }));
    expect(slow.code).toBe('AI_TIMEOUT');
    expect(slow.message).toMatch(/^Le moteur IA local met trop de temps à répondre/);
    const controller = new AbortController();
    const pending = localProvider(mockFetch(() => never())).preload({ signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect((await catchError(() => pending)).code).toBe('GENERATION_ABORTED');
  });
});

describe('OllamaClient.pull — moteur trop ancien, proxy, vérification SHA-256', () => {
  it('412 du registre en ligne NDJSON (format réel) → ENGINE_OUTDATED, non réessayable', async () => {
    const lines = `${JSON.stringify({ status: 'pulling manifest' })}\n${JSON.stringify({ error: 'pull model manifest: 412: The model you are attempting to pull requires a newer version of Ollama. Please download the latest version at: https://ollama.com/download' })}\n`;
    const err = await catchError(() => new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => streamResponse(streamBody([lines])))).pull('ministral-3:8b', () => {}));
    expect(err).toMatchObject({ code: 'ENGINE_OUTDATED', retryable: false });
    expect(err.message).toMatch(/version plus récente du moteur IA \(Ollama\) : mettez-le à jour/);
    const http = await catchError(() => new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => textResponse('{"error":"precondition failed"}', 412))).pull('x', () => {}));
    expect(http.code).toBe('ENGINE_OUTDATED');
  });

  it('registre bloqué par le proxy (« Forbidden ») → NETWORK_ERROR qui parle du réseau de l’établissement', async () => {
    const lines = `${JSON.stringify({ status: 'pulling manifest' })}\n${JSON.stringify({ error: 'pull model manifest: Get "https://registry.ollama.ai/v2/library/ministral-3/manifests/8b": Forbidden' })}\n`;
    const err = await catchError(() => new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => streamResponse(streamBody([lines])))).pull('ministral-3:8b', () => {}));
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toMatch(/proxy ou filtrage/);
    expect(err.message).not.toMatch(/registry|Forbidden/);
  });

  it('silence toléré porté à 15 min pendant « verifying sha256 digest » (et seulement là)', async () => {
    expect(PULL_VERIFY_IDLE_MS).toBe(15 * 60_000);
    const pullTimeouts = { firstChunkMs: 1_000, idleMs: 60, verifyIdleMs: 1_000 };
    const verifying = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`${JSON.stringify({ status: 'pulling 6a07', total: 10, completed: 10 })}\n`));
        controller.enqueue(enc.encode(`${JSON.stringify({ status: 'verifying sha256 digest' })}\n`));
        await sleep(250); // plus long que idleMs (60 ms), plus court que verifyIdleMs (1 s)
        controller.enqueue(enc.encode(`${JSON.stringify({ status: 'writing manifest' })}\n${JSON.stringify({ status: 'success' })}\n`));
        controller.close();
      },
    });
    const statuses: string[] = [];
    await new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => streamResponse(verifying)), { pullTimeouts }).pull('x', p => statuses.push(p.status));
    expect(statuses).toEqual(['pulling 6a07', 'verifying sha256 digest', 'writing manifest', 'success']);

    // Même silence pendant le téléchargement proprement dit : délai dépassé.
    const stalled = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ status: 'pulling 6a07', total: 10, completed: 1 })}\n`));
        await sleep(250);
        controller.close();
      },
    });
    const err = await catchError(() => new OllamaClient(DEFAULT_OLLAMA_URL, mockFetch(() => streamResponse(stalled)), { pullTimeouts }).pull('x', () => {}));
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.message).toBe('Le téléchargement du modèle ne progresse plus. Relancez-le : il reprendra où il s’est arrêté.');
  });
});
