// Traduction des erreurs des serveurs d'IA : destinataire (poste / administrateur), quotas, Retry-After,
// alias de modèles, pannes réseau. Formats repris des vrais fournisseurs (OpenRouter, OVHcloud, Groq,
// Cloudflare, Mistral, Hugging Face) et d'Ollama v0.34.4.

import { describe, expect, it } from 'vitest';
import {
  aiSubject, formatRetryWhen, mapHttpError, mapNetworkError, type HttpErrorContext,
} from '../../shared/ai/errorMapping';
import {
  errorDetailFromBody, isNetworkError, networkFailureKind, parseRetryDelay, readErrorDetail, retryDelayFromHeaders,
} from '../../shared/ai/streams';
import { networkError } from './helpers';

// 28/09/2026 12:00 UTC = 14 h 00 à Paris.
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

const WEB: HttpErrorContext = { label: 'OVHcloud AI Endpoints', model: 'Mistral-Small-3.2-24B-Instruct-2506', local: false, recipient: 'administrateur', now: () => NOW };
const POSTE: HttpErrorContext = { label: 'Serveur universitaire', model: 'mistral-small', local: false, recipient: 'poste', now: () => NOW };
const LOCAL: HttpErrorContext = { label: 'Le moteur IA local', model: 'ministral-3:14b', modelLabel: 'Magistra Standard', local: true, recipient: 'poste', api: 'ollama' };

describe('sujet grammatical des messages (WEB-AI-12)', () => {
  it('ajoute l’article ou nomme le prestataire entre parenthèses', () => {
    expect(aiSubject("Serveur d'IA")).toBe("Le serveur d'IA");
    expect(aiSubject(undefined)).toBe("Le serveur d'IA");
    expect(aiSubject('Serveur universitaire')).toBe('Le serveur universitaire');
    expect(aiSubject('Le moteur IA local')).toBe('Le moteur IA local');
    expect(aiSubject("l'IA de l'académie")).toBe("L'IA de l'académie");
    expect(aiSubject('OVHcloud AI Endpoints')).toBe("Le serveur d'IA (OVHcloud AI Endpoints)");
    expect(aiSubject('Mistral AI (La Plateforme)')).toBe("Le serveur d'IA « Mistral AI (La Plateforme) »");
  });

  it('plus jamais « sur serveur d’IA » ni « Serveur d’IA est… »', () => {
    const ctx: HttpErrorContext = { label: "Serveur d'IA", model: 'm', local: false, recipient: 'administrateur' };
    expect(mapHttpError(404, 'model not found', ctx).message).toMatch(/n'est pas disponible sur le serveur d'IA\./);
    expect(mapHttpError(503, '', ctx).message).toBe("Le serveur d'IA est momentanément indisponible. Réessayez dans quelques instants.");
    expect(mapHttpError(401, '', ctx).message).toMatch(/^Le serveur d'IA a refusé l'accès/);
  });
});

describe('destinataire : administrateur du site (web) ou poste (Windows) — F9', () => {
  it('web : on dit quelle variable l’ADMINISTRATEUR doit vérifier, jamais « les réglages »', () => {
    const cases: [number, string, RegExp][] = [
      [401, '{"error":"bad key"}', /L'administrateur du site doit vérifier AI_API_KEY\./],
      [404, 'The model `x` does not exist', /L'administrateur du site doit vérifier AI_MODEL\./],
      [404, '<html>Not Found</html>', /L'administrateur du site doit vérifier AI_BASE_URL : elle se termine généralement par \/v1\./],
    ];
    for (const [status, body, expected] of cases) {
      const e = mapHttpError(status, body, WEB);
      expect(e.message, `${status}`).toMatch(expected);
      expect(e.message).not.toMatch(/réglages/);
    }
  });

  it('Windows (serveur distant) : renvoi vers les réglages', () => {
    expect(mapHttpError(401, '', POSTE).message).toBe("Le serveur universitaire a refusé l'accès (clé d'accès refusée). Vérifiez la clé dans les réglages ou contactez l'administrateur de ce serveur.");
    expect(mapHttpError(404, 'model not found', POSTE).message).toBe("Le modèle « mistral-small » n'est pas disponible sur le serveur universitaire : vérifiez son nom dans les réglages.");
  });

  it('moteur local (Windows) : libellé du niveau Magistra', () => {
    expect(mapHttpError(404, "model 'ministral-3:14b' not found", LOCAL).message).toBe("Le modèle Magistra Standard n'est pas encore installé.");
    expect(mapHttpError(500, 'panic', LOCAL).message).toBe('Le moteur IA local a rencontré une erreur. Réessayez dans quelques instants.');
  });

  it('Ollama sur la boucle locale du SERVEUR web : messages pour l’administrateur (pas « Moteur IA non démarré »)', () => {
    const ctx: HttpErrorContext = { label: "Serveur d'IA", model: 'ministral-3:14b', local: true, recipient: 'administrateur', api: 'ollama' };
    expect(mapHttpError(404, "model 'ministral-3:14b' not found", ctx).message)
      .toBe("Le modèle « ministral-3:14b » n'est pas disponible sur le serveur d'IA. L'administrateur du site doit vérifier AI_MODEL (ou installer le modèle : ollama pull ministral-3:14b).");
    const refused = mapNetworkError(networkError('ECONNREFUSED'), { ...ctx, addressKind: 'loopback' });
    expect(refused.code).toBe('AI_SERVER_UNREACHABLE');
    expect(refused.message).toMatch(/injoignable à l'adresse configurée \(connexion refusée\)\. L'administrateur du site doit vérifier AI_BASE_URL/);
    expect(refused.message).toMatch(/n'est pas joignable depuis un hébergement en ligne comme Vercel/);
    expect(mapHttpError(404, '404 page not found', ctx).message).toMatch(/pour Ollama \(API native\), l'adresse ne se termine pas par \/v1/);
  });
});

describe('quotas et limites des offres gratuites (WEB-AI-03/04/08)', () => {
  it('429 quota journalier (OpenRouter, reprise à minuit UTC via error.metadata.headers) → AI_QUOTA_EXCEEDED avec l’heure de reprise', async () => {
    const reset = String(Date.UTC(2026, 8, 29));
    const body = JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day', code: 429, metadata: { headers: { 'X-RateLimit-Limit': '50', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': reset } } } });
    const detail = await readErrorDetail(new Response(body, { status: 429 }), NOW);
    expect(detail.retryAfterMs).toBe(12 * 3_600_000);
    const e = mapHttpError(429, detail, WEB);
    expect(e.code).toBe('AI_QUOTA_EXCEEDED');
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(12 * 3_600_000);
    expect(e.message).toBe("Le quota d'utilisation du serveur d'IA (OVHcloud AI Endpoints) est atteint : réessayez demain vers 2 h 00 (heure de Paris).");
  });

  it('429 Cloudflare 4006 (neurones du jour épuisés), sans en-tête → « plus tard »', () => {
    const detail = errorDetailFromBody({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] });
    expect(detail.codes).toContain('4006');
    const e = mapHttpError(429, detail, WEB);
    expect(e.code).toBe('AI_QUOTA_EXCEEDED');
    expect(e.message).toMatch(/réessayez plus tard\.$/);
  });

  it('429 OVHcloud anonyme (Retry-After 55 s, au-delà de 15 s) → AI_QUOTA_EXCEEDED sans nouvel essai automatique', async () => {
    const detail = await readErrorDetail(new Response('{"message":"Rate limit exceeded"}', { status: 429, headers: { 'retry-after': '55' } }), NOW);
    const e = mapHttpError(429, detail, WEB);
    expect(e.code).toBe('AI_QUOTA_EXCEEDED');
    expect(e.retryAfterMs).toBe(55_000);
    expect(e.message).toBe("Le serveur d'IA (OVHcloud AI Endpoints) limite le nombre de demandes (offre gratuite ou quota) : réessayez dans 55 s.");
  });

  it('429 « quota » générique : reprise rapide annoncée → surcharge passagère ; sinon quota bloquant', () => {
    expect(mapHttpError(429, { message: 'Quota exceeded for requests per minute', codes: [], retryAfterMs: 4_000 }, WEB).code).toBe('AI_BUSY');
    expect(mapHttpError(429, { message: 'RESOURCE_EXHAUSTED', codes: ['resource_exhausted'] }, WEB).code).toBe('AI_QUOTA_EXCEEDED');
    expect(mapHttpError(429, { message: 'Rate limit exceeded: free-models-per-day', codes: [], retryAfterMs: 4_000 }, WEB).code).toBe('AI_QUOTA_EXCEEDED');
  });

  it('429 court (Retry-After 3 s) → AI_BUSY portant l’attente conseillée ; 429 sans indication → AI_BUSY', async () => {
    const short = mapHttpError(429, await readErrorDetail(new Response('{}', { status: 429, headers: { 'Retry-After': '3' } }), NOW), POSTE);
    expect([short.code, short.retryAfterMs]).toEqual(['AI_BUSY', 3_000]);
    expect(short.message).toBe('Le serveur universitaire est surchargé (trop de demandes en même temps). Réessayez dans quelques instants.');
    const plain = mapHttpError(429, 'Too Many Requests', POSTE);
    expect([plain.code, plain.retryAfterMs]).toEqual(['AI_BUSY', undefined]);
  });

  it('413 Groq « tokens per minute (TPM) » → quota, pas « retirez des documents »', () => {
    const detail = errorDetailFromBody({ error: { message: 'Request too large for model `llama-3.1-8b-instant` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 7400, please reduce your message size and try again.', type: 'tokens', code: 'rate_limit_exceeded' } });
    const web = mapHttpError(413, detail, WEB);
    expect(web.code).toBe('AI_QUOTA_EXCEEDED');
    expect(web.message).toMatch(/limite de tokens par minute du serveur d'IA \(OVHcloud AI Endpoints\).*AI_MAX_OUTPUT_TOKENS et AI_CONTEXT_TOKENS/);
    expect(mapHttpError(413, detail, POSTE).message).toMatch(/Raccourcissez la demande ou retirez des documents\.$/);
    expect(mapHttpError(413, 'Payload Too Large', WEB).code).toBe('CONTEXT_TOO_LARGE');
  });

  it('402 crédits épuisés (Hugging Face) → AI_QUOTA_EXCEEDED, et non « réponse inattendue »', () => {
    const e = mapHttpError(402, 'You have exceeded your monthly included credits for Inference Providers.', WEB);
    expect(e.code).toBe('AI_QUOTA_EXCEEDED');
    expect(e.message).toBe("Les crédits du serveur d'IA (OVHcloud AI Endpoints) sont épuisés. L'administrateur du site doit les recharger ou choisir un autre service d'IA.");
  });

  it('formatRetryWhen', () => {
    expect(formatRetryWhen(undefined, NOW)).toBeUndefined();
    expect(formatRetryWhen(4_200, NOW)).toBe('dans 5 s');
    expect(formatRetryWhen(80_000, NOW)).toBe('dans environ une minute');
    expect(formatRetryWhen(12 * 60_000, NOW)).toBe('dans environ 12 minutes');
    expect(formatRetryWhen(2 * 3_600_000 + 5 * 60_000, NOW)).toBe('vers 16 h 05 (heure de Paris)');
    expect(formatRetryWhen(3 * 86_400_000, NOW)).toBe('le 01/10 vers 14 h 00 (heure de Paris)');
    expect(formatRetryWhen(2 * 3_600_000, NOW, 'UTC')).toBe('vers 14 h 00 (heure UTC)');
    expect(formatRetryWhen(2 * 3_600_000, NOW, 'Fuseau/Inexistant')).toBe('vers 14 h 00 (heure UTC)');
  });
});

describe('en-têtes de limitation de débit', () => {
  it('parseRetryDelay : secondes, horodatages, durées, dates', () => {
    expect(parseRetryDelay('30', NOW)).toBe(30_000);
    expect(parseRetryDelay('1.5', NOW)).toBe(1_500);
    expect(parseRetryDelay(String(NOW + 90_000), NOW)).toBe(90_000);
    expect(parseRetryDelay(String(Math.floor(NOW / 1000) + 60), NOW)).toBe(60_000);
    expect(parseRetryDelay('2m59.56s', NOW)).toBeCloseTo(179_560);
    expect(parseRetryDelay('500ms', NOW)).toBe(500);
    expect(parseRetryDelay('6m0s', NOW)).toBe(360_000);
    expect(parseRetryDelay(new Date(NOW + 120_000).toUTCString(), NOW)).toBe(120_000);
    expect(parseRetryDelay('demain', NOW)).toBeUndefined();
    expect(parseRetryDelay(null, NOW)).toBeUndefined();
  });

  it('retryDelayFromHeaders : Retry-After prioritaire, sinon le compteur épuisé (Groq)', () => {
    expect(retryDelayFromHeaders(new Headers({ 'retry-after': '4', 'x-ratelimit-reset': '999' }), NOW)).toBe(4_000);
    const groq = new Headers({
      'x-ratelimit-remaining-requests': '14', 'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '7.66s',
    });
    expect(retryDelayFromHeaders(groq, NOW)).toBeCloseTo(7_660);
    expect(retryDelayFromHeaders({ 'X-RateLimit-Reset': String(NOW + 5_000) }, NOW)).toBe(5_000);
    expect(retryDelayFromHeaders(new Headers(), NOW)).toBeUndefined();
    expect(retryDelayFromHeaders(undefined, NOW)).toBeUndefined();
  });

  it('errorDetailFromBody : formats Mistral, OpenAI, FastAPI, Ollama', () => {
    expect(errorDetailFromBody({ object: 'error', message: 'Invalid model: x', type: 'invalid_model', code: '1500' })).toEqual({ message: 'Invalid model: x', codes: ['invalid_model', '1500'] });
    expect(errorDetailFromBody({ error: { message: 'm', type: 'invalid_request_error', code: 'model_not_found' } }).codes).toEqual(['invalid_request_error', 'model_not_found']);
    expect(errorDetailFromBody({ detail: [{ msg: 'field required' }] }).message).toBe('field required');
    expect(errorDetailFromBody({ error: "model 'x' not found" }).message).toBe("model 'x' not found");
    expect(errorDetailFromBody(undefined, 'Bad Gateway').message).toBe('Bad Gateway');
  });
});

describe('modèles inconnus, moteur trop ancien, mémoire (WEB-AI-09, Ollama v0.34)', () => {
  it('« Invalid model » (Mistral), « not a valid model ID » (OpenRouter), code model_not_found → MODEL_NOT_INSTALLED', () => {
    expect(mapHttpError(400, errorDetailFromBody({ object: 'error', message: 'Invalid model: ministral-99b', type: 'invalid_model', code: '1500' }), WEB).code).toBe('MODEL_NOT_INSTALLED');
    expect(mapHttpError(400, 'mistralai/foo is not a valid model ID', WEB).code).toBe('MODEL_NOT_INSTALLED');
    expect(mapHttpError(400, { message: 'The requested resource is unavailable', codes: ['model_not_found'] }, WEB).code).toBe('MODEL_NOT_INSTALLED');
  });

  it('moteur trop ancien → ENGINE_OUTDATED (message adapté au destinataire)', () => {
    expect(mapHttpError(500, 'error loading model: unknown model architecture: \'mistral3\'', LOCAL).toJSON())
      .toEqual({ code: 'ENGINE_OUTDATED', message: 'Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour.', retryable: false });
    expect(mapHttpError(412, 'requires a newer version of Ollama', { ...WEB, api: 'ollama' }).message).toMatch(/L'administrateur du site doit mettre à jour Ollama\./);
  });

  it('erreurs mémoire de llama-server → OUT_OF_MEMORY', () => {
    for (const msg of [
      'llama-server reported out-of-memory during startup: exit status 1',
      'unable to load full model on GPU',
      'ggml_backend_sched_alloc_splits: failed to reserve graph buffers',
      'compute buffer allocation failed',
      'hipMalloc failed: out of memory',
      'vk::Device::allocateMemory: ErrorOutOfDeviceMemory',
      'out of device memory',
      'ErrorOutOfMemory',
    ]) expect(mapHttpError(500, msg, LOCAL).code, msg).toBe('OUT_OF_MEMORY');
  });

  it('jamais de détail technique ni de secret dans le message', () => {
    const secret = 'sk-live-ABCDEF123456';
    for (const status of [400, 401, 402, 404, 413, 429, 500, 503]) {
      const e = mapHttpError(status, `{"error":{"message":"key ${secret} rejected at /srv/app.py line 12"}}`, WEB);
      expect(e.message, `${status}`).not.toMatch(/sk-live|app\.py|line 12/);
    }
  });
});

describe('pannes réseau', () => {
  it('networkFailureKind : Node (undici), agrégats, Chromium (net.fetch d’Electron)', () => {
    expect(networkFailureKind(networkError('ECONNREFUSED'))).toBe('refused');
    expect(networkFailureKind(networkError('ENOTFOUND'))).toBe('dns');
    expect(networkFailureKind(networkError('EAI_AGAIN'))).toBe('dns');
    expect(networkFailureKind(networkError('EHOSTUNREACH'))).toBe('unreachable');
    expect(networkFailureKind(networkError('CERT_HAS_EXPIRED'))).toBe('tls');
    expect(networkFailureKind(networkError('ECONNRESET'))).toBe('other');
    // Port interdit par fetch (1, 9, 6000…) : undici lève « fetch failed » avec la cause « bad port » (sans code).
    const badPort = new TypeError('fetch failed', { cause: new Error('bad port') });
    expect(networkFailureKind(badPort)).toBe('bad_port');
    expect(mapNetworkError(badPort, WEB).message).toMatch(/\(port réservé, interdit par sécurité : choisissez un autre port\)/);
    expect(mapNetworkError(badPort, WEB).code).toBe('AI_SERVER_UNREACHABLE');
    const aggregate = new TypeError('fetch failed', { cause: Object.assign(new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]), { code: 'ECONNREFUSED' }) });
    expect(networkFailureKind(aggregate)).toBe('refused');
    const chromium = new Error('net::ERR_CONNECTION_REFUSED');
    expect(isNetworkError(chromium)).toBe(true);
    expect(networkFailureKind(chromium)).toBe('refused');
    expect(networkFailureKind(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe('dns');
    expect(networkFailureKind(new Error('autre chose'))).toBeNull();
  });

  it('mapNetworkError : injoignable (non réessayé automatiquement), certificat, coupure passagère, moteur local', () => {
    expect(mapNetworkError(networkError('EAI_AGAIN'), WEB).code).toBe('AI_SERVER_UNREACHABLE');
    const tls = mapNetworkError(networkError('SELF_SIGNED_CERT_IN_CHAIN'), WEB);
    expect(tls.code).toBe('AI_SERVER_UNREACHABLE');
    expect(tls.message).toMatch(/certificat HTTPS refusé/);
    expect(mapNetworkError(networkError('ECONNRESET'), WEB).code).toBe('AI_SERVER_UNAVAILABLE');
    expect(mapNetworkError(networkError('ECONNREFUSED'), LOCAL).toJSON()).toEqual({ code: 'ENGINE_NOT_RUNNING', message: 'Moteur IA non démarré.', retryable: true });
    // Adresse publique : pas de conseil « Vercel ».
    expect(mapNetworkError(networkError('ECONNREFUSED'), { ...WEB, addressKind: 'public' }).message).not.toMatch(/Vercel/);
  });
});
