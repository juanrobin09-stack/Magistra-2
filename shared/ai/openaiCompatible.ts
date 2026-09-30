// Fournisseur générique compatible OpenAI (/v1/chat/completions) :
// vLLM, llama.cpp server, LM Studio, LocalAI, Ollama (/v1), OVHcloud AI Endpoints, Mistral, Albert, Scaleway…

import { MagistraError } from '../errors.js';
import {
  DEFAULT_AI_SERVER_LABEL, localizeEngineError, mapHttpError, mapNetworkError, statusUnknown, timeoutError, unavailableError,
  type ErrorRecipient, type HttpErrorContext,
} from './errorMapping.js';
import { addressKind } from './presets.js';
import {
  collectStream, type AIProvider, type ChatOptions, type FetchLike, type FinishReason, type GenerateResult,
  type HealthStatus, type ModelInfo, type StreamEvent, type Usage,
} from './provider.js';
import {
  abortedByTimeout, errorDetailFromBody, fetchWithTimeout, isNetworkError, linkSignals, raceAbort, readErrorDetail, readLines,
  readSSE, safeJsonParse, trimSlash, type TimeoutOptions,
} from './streams.js';

// Réexportés pour les modules qui les importaient d'ici (ollama.ts, application Windows, tests).
export {
  aiSubject, DEFAULT_AI_SERVER_LABEL, formatRetryWhen, LOCAL_BAD_RESPONSE_MESSAGE, LOCAL_ENGINE_LABEL, LOCAL_TIMEOUT_MESSAGE,
  localizeEngineError, mapHttpError, mapNetworkError, SHORT_RETRY_AFTER_MS,
  type ErrorRecipient, type HttpErrorContext,
} from './errorMapping.js';

export interface OpenAICompatibleConfig {
  /** URL de base incluant /v1, ex. « https://ia.univ.fr/v1 ». */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Libellé affiché dans les messages d'erreur (« Serveur universitaire »…). Défaut : « Serveur d'IA ». */
  label?: string;
  /** Moteur sur l'ordinateur de l'utilisateur (avec recipient 'poste' : « Moteur IA non démarré »…). */
  local?: boolean;
  /** Destinataire des conseils d'erreur : 'poste' (Windows, défaut) ou 'administrateur' (site web). */
  recipient?: ErrorRecipient;
  /** Fuseau horaire de l'heure de reprise d'un quota (défaut Europe/Paris). */
  timeZone?: string;
  contextTokens?: number;
  timeouts?: Partial<TimeoutOptions>;
  /** Délai de la liste des modèles (/models) quand l'appelant n'en fixe pas (10 s par défaut). */
  listTimeoutMs?: number;
  fetch?: FetchLike;
  /** Horloge (tests). */
  now?: () => number;
}

const DEFAULT_TIMEOUTS: TimeoutOptions = { firstChunkMs: 180_000, idleMs: 90_000 };

interface ChatChunk {
  choices?: {
    delta?: { content?: string | null };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string; type?: string } | string;
}

/**
 * finish_reason → fin normale ou tronquée :
 *  - length, max_tokens, model_length (Mistral : contexte du modèle plein) → 'length' ;
 *  - stop, eos, end_turn, stop_sequence → 'stop' ;
 *  - toute autre valeur (content_filter, error, tool_calls…) → 'unknown' (contenu possiblement incomplet).
 */
export function toFinishReason(value: string | null | undefined): FinishReason | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'length' || v === 'max_tokens' || v === 'model_length') return 'length';
  if (v === 'stop' || v === 'eos' || v === 'end_turn' || v === 'stop_sequence') return 'stop';
  return 'unknown';
}

/**
 * Deux noms désignent-ils le même modèle servi ? Casse ignorée, « :latest » ignoré, et suffixe de routage
 * « :fournisseur » ignoré après un nom contenant « / » (routeur Hugging Face : « org/modele:fastest »).
 */
export function sameServedModel(served: string, wanted: string): boolean {
  const norm = (s: string) => {
    let n = s.trim().toLowerCase().replace(/:latest$/, '');
    const slash = n.lastIndexOf('/');
    const colon = n.lastIndexOf(':');
    if (slash >= 0 && colon > slash) n = n.slice(0, colon);
    return n;
  };
  return norm(served) === norm(wanted);
}

/** Le modèle voulu figure-t-il dans la liste (identifiant ou alias) ? */
export function modelListed(models: readonly ModelInfo[], wanted: string): boolean {
  return models.some(m => sameServedModel(m.name, wanted) || (m.aliases ?? []).some(a => sameServedModel(a, wanted)));
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly kind = 'openai-compatible' as const;
  readonly model: string;
  readonly label: string;
  readonly local: boolean;
  readonly contextTokens: number;
  readonly recipient: ErrorRecipient;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeouts: TimeoutOptions;
  private readonly listTimeoutMs: number;
  private readonly timeZone?: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.baseUrl || !config.model) throw new MagistraError('AI_NOT_CONFIGURED');
    this.baseUrl = trimSlash(config.baseUrl);
    this.model = config.model;
    this.apiKey = config.apiKey || undefined;
    this.label = config.label || DEFAULT_AI_SERVER_LABEL;
    this.local = config.local ?? false;
    this.recipient = config.recipient ?? 'poste';
    this.timeZone = config.timeZone;
    this.contextTokens = config.contextTokens ?? 32_768;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.listTimeoutMs = config.listTimeoutMs ?? 10_000;
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    this.now = config.now ?? (() => Date.now());
  }

  private get ctx(): HttpErrorContext {
    return {
      label: this.label,
      model: this.model,
      local: this.local,
      recipient: this.recipient,
      api: 'openai',
      addressKind: addressKind(this.baseUrl),
      timeZone: this.timeZone,
      now: this.now,
    };
  }

  /** Moteur sur l'ordinateur de l'enseignant (application Windows) : messages propres au moteur local. */
  private get onThisComputer(): boolean {
    return this.local && this.recipient === 'poste';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private chunkError(chunk: ChatChunk): MagistraError {
    const e = chunk.error;
    const { message, codes } = errorDetailFromBody(chunk, '');
    const code = typeof e === 'object' && e ? Number(e.code) : NaN;
    return mapHttpError(Number.isInteger(code) && code >= 400 && code < 600 ? code : 500, { message, codes }, this.ctx);
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const { controller, dispose } = linkSignals(options.signal);
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: this.model,
            messages: options.messages,
            stream: true,
            max_tokens: options.maxTokens,
            temperature: options.temperature ?? 0.4,
          }),
        }, controller, this.timeouts.firstChunkMs);
      } catch (err) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        if (err instanceof MagistraError) throw err;
        if (isNetworkError(err)) throw mapNetworkError(err, this.ctx);
        throw unavailableError(this.ctx, err);
      }

      if (!res.ok) throw mapHttpError(res.status, await readErrorDetail(res, this.now()), this.ctx);
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE');

      // Certains serveurs ignorent « stream: true » et renvoient une réponse JSON complète.
      const contentType = res.headers.get('content-type') ?? '';
      let lines: AsyncIterable<string> = readLines(res.body, controller, this.timeouts, options.signal);
      if (contentType.includes('application/json')) {
        let raw = '';
        for await (const line of lines) raw += `${line}\n`;
        const chunk = safeJsonParse(raw) as ChatChunk | undefined;
        if (chunk && typeof chunk === 'object') {
          if (chunk.error) throw this.chunkError(chunk);
          const choice = chunk.choices?.[0];
          const content = choice?.message?.content ?? choice?.delta?.content;
          if (typeof content === 'string' && content.length > 0) yield { type: 'delta', text: content };
          if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
          yield {
            type: 'end',
            finishReason: toFinishReason(choice?.finish_reason) ?? 'stop',
            usage: chunk.usage ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens } : undefined,
          };
          return;
        }
        if (!/^data:/m.test(raw)) throw new MagistraError('AI_BAD_RESPONSE');
        // En-tête erroné : le corps est en réalité un flux SSE, déjà reçu en entier.
        lines = (async function* () {
          yield* raw.split('\n');
        })();
      }

      const state: { finishReason?: FinishReason; usage?: Usage } = {};
      let sawDone = false;

      /** Applique un morceau au bilan et renvoie le texte produit (éventuellement vide). */
      const apply = (chunk: ChatChunk): string => {
        if (chunk.error) throw this.chunkError(chunk);
        const choice = chunk.choices?.[0];
        const reason = toFinishReason(choice?.finish_reason);
        if (reason) state.finishReason = reason;
        if (chunk.usage) state.usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
        const text = choice?.delta?.content ?? choice?.message?.content;
        return typeof text === 'string' ? text : '';
      };

      for await (const payload of readSSE(lines)) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        // Un serveur non conforme peut envoyer plusieurs objets JSON sur des lignes « data: » consécutives.
        const parts = safeJsonParse(payload) !== undefined || payload.trim() === '[DONE]' ? [payload] : payload.split('\n');
        for (const part of parts) {
          if (part.trim() === '[DONE]') {
            sawDone = true;
            break;
          }
          const chunk = safeJsonParse(part) as ChatChunk | undefined;
          if (!chunk || typeof chunk !== 'object') continue;
          const text = apply(chunk);
          if (text) yield { type: 'delta', text };
        }
        if (sawDone) break;
      }
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      // Sans finish_reason : [DONE] reçu = réponse complète ; ni l'un ni l'autre = flux coupé (« unknown »).
      // Un finish_reason explicite (content_filter → « unknown ») n'est jamais remplacé.
      yield { type: 'end', finishReason: state.finishReason ?? (sawDone ? 'stop' : 'unknown'), usage: state.usage };
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw localizeEngineError(err, this.onThisComputer);
      if (isNetworkError(err)) throw mapNetworkError(err, this.ctx);
      throw localizeEngineError(new MagistraError('AI_BAD_RESPONSE', undefined, { cause: err }), this.onThisComputer);
    } finally {
      dispose();
      // Libère la connexion si l'appelant s'arrête avant la fin (le serveur cesse alors de générer).
      controller.abort();
    }
  }

  generate(options: ChatOptions): Promise<GenerateResult> {
    return collectStream(this, options);
  }

  /**
   * État du serveur, sans jamais rien générer (aucune requête de quota consommée) :
   *  - liste des modèles lue et modèle présent (identifiant ou alias) → { ok: true } ;
   *  - /models absent (404 sur une adresse « /v… », 405), liste vide, délai dépassé → { ok: true, warning: AI_STATUS_UNKNOWN }
   *    (état non vérifié, la génération reste possible) — jamais GENERATION_ABORTED ;
   *  - liste non vide sans le modèle → { ok: true, warning: MODEL_NOT_INSTALLED } (alias ou modèle virtuel possibles) ;
   *  - clé refusée, adresse injoignable, 404 sur une adresse sans /v…, crédits ou quota épuisés → { ok: false, error }.
   */
  async health(signal?: AbortSignal): Promise<HealthStatus> {
    const ctx = this.ctx;
    const res = await this.requestModels(signal);
    if ('error' in res) {
      const e = res.error;
      if (e.code === 'AI_TIMEOUT' || e.code === 'GENERATION_ABORTED') return { ok: true, warning: statusUnknown(ctx, 'timeout') };
      if (e.code === 'AI_BUSY') return { ok: true, warning: { code: e.code, message: e.message } };
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    if (res.status === 405 || (res.status === 404 && this.versionedPath())) {
      return { ok: true, warning: statusUnknown(ctx, 'no-list') };
    }
    if (!res.models) {
      const e = res.failure ?? new MagistraError('AI_BAD_RESPONSE');
      if (e.code === 'AI_BUSY') return { ok: true, warning: { code: e.code, message: e.message } };
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    if (res.models.length === 0) return { ok: true, warning: statusUnknown(ctx, 'empty-list') };
    if (!modelListed(res.models, this.model)) {
      const where = this.recipient === 'administrateur'
        ? "Si la génération échoue, l'administrateur du site doit vérifier AI_MODEL."
        : 'Si la génération échoue, vérifiez son nom dans les réglages.';
      return {
        ok: true,
        warning: {
          code: 'MODEL_NOT_INSTALLED',
          message: `Le modèle « ${this.model} » n'apparaît pas dans la liste des modèles : il peut s'agir d'un alias, la génération reste possible. ${where}`,
        },
      };
    }
    return { ok: true };
  }

  /** L'adresse contient-elle un segment de version (« /v1 », « /v1beta/openai », « /api/v1 »…) ? */
  private versionedPath(): boolean {
    try {
      return /\/v\d+[a-z0-9]*(\/|$)/i.test(new URL(this.baseUrl).pathname);
    } catch {
      return false;
    }
  }

  /**
   * GET {base}/models, sans lever : renvoie soit une erreur réseau / d'annulation (`error`),
   * soit le statut HTTP avec la liste (`models`) ou l'erreur traduite (`failure`).
   */
  private async requestModels(signal?: AbortSignal): Promise<
    | { error: MagistraError }
    | { status: number; models?: ModelInfo[]; failure?: MagistraError }
  > {
    const timeout = AbortSignal.timeout(this.listTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      // raceAbort : rend la main au délai même si l'implémentation de fetch ignore le signal.
      res = await raceAbort(this.fetchImpl(`${this.baseUrl}/models`, { headers: this.headers(), signal: combined }), combined);
    } catch (err) {
      if (signal?.aborted) {
        // Délai de l'appelant (test de santé) : « non vérifié » ; annulation par l'utilisateur : interruption.
        return { error: abortedByTimeout(signal) ? timeoutError(this.ctx) : new MagistraError('GENERATION_ABORTED') };
      }
      // Erreur déjà traduite par un fetch intermédiaire (redirection refusée par l'application Windows…).
      if (err instanceof MagistraError) return { error: err };
      if (timeout.aborted) return { error: this.onThisComputer ? new MagistraError('ENGINE_NOT_RUNNING') : timeoutError(this.ctx) };
      if (isNetworkError(err)) return { error: mapNetworkError(err, this.ctx) };
      if ((err as Error)?.name === 'TimeoutError') return { error: timeoutError(this.ctx) };
      return { error: unavailableError(this.ctx, err) };
    }
    if (!res.ok) return { status: res.status, failure: mapHttpError(res.status, await readErrorDetail(res, this.now()), this.ctx) };
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: unknown; aliases?: unknown }[] };
    const models = (Array.isArray(data.data) ? data.data : [])
      .filter((m): m is { id: string; aliases?: unknown } => typeof m?.id === 'string' && m.id.length > 0)
      .map(m => {
        const aliases = Array.isArray(m.aliases) ? m.aliases.filter((a): a is string => typeof a === 'string' && a.length > 0) : [];
        return aliases.length ? { name: m.id, aliases } : { name: m.id };
      });
    return { status: res.status, models };
  }

  /**
   * Modèles servis (GET /models) : identifiants et alias éventuels (Albert/OpenGateLLM, Mistral).
   * Lève une MagistraError : AI_TIMEOUT si le délai est dépassé (jamais GENERATION_ABORTED pour un simple délai),
   * GENERATION_ABORTED si l'appelant annule, erreur traduite sinon.
   */
  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await this.requestModels(signal);
    if ('error' in res) throw res.error;
    if (!res.models) throw res.failure ?? new MagistraError('AI_BAD_RESPONSE');
    return res.models;
  }
}
