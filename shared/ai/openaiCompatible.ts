// Fournisseur générique compatible OpenAI (/v1/chat/completions) :
// vLLM, llama.cpp server, LM Studio, LocalAI, Ollama (/v1), passerelles universitaires…

import { defaultMessage, MagistraError } from '../errors.js';
import {
  collectStream, type AIProvider, type ChatOptions, type FetchLike, type FinishReason, type GenerateResult,
  type HealthStatus, type ModelInfo, type StreamEvent, type Usage,
} from './provider.js';
import {
  fetchWithTimeout, isNetworkError, linkSignals, lowerFirst, readErrorText, readLines, readSSE, safeJsonParse, trimSlash,
  type TimeoutOptions,
} from './streams.js';

export interface OpenAICompatibleConfig {
  /** URL de base incluant /v1, ex. « https://ia.univ.fr/v1 ». */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Libellé affiché dans les messages d'erreur (« Serveur universitaire »…). */
  label?: string;
  local?: boolean;
  contextTokens?: number;
  timeouts?: Partial<TimeoutOptions>;
  fetch?: FetchLike;
}

const DEFAULT_TIMEOUTS: TimeoutOptions = { firstChunkMs: 180_000, idleMs: 90_000 };

export interface HttpErrorContext {
  /** Libellé du service (« Serveur universitaire », « Moteur IA »…). */
  label: string;
  /** Nom technique du modèle. */
  model: string;
  local: boolean;
  /** Nom lisible du modèle (« Magistra Standard ») utilisé quand il n'est pas installé localement. */
  modelLabel?: string;
}

const CONTEXT_RE = /context length|maximum context|context size|context window|too many tokens|prompt is too long|input is too long|exceeds? (the )?(max|available|model)|reduce the length/;
const MEMORY_RE = /out of memory|\boom\b|requires more system memory|insufficient memory|not enough memory|cudamalloc|unable to allocate|failed to allocate|memory allocation/;
const MODEL_RE = /model\b.*\bnot found|model\b.*does not exist|unknown model|no such model|model .*not (available|loaded)|try pulling it/;

/**
 * Traduit une erreur HTTP d'un serveur d'IA en message compréhensible.
 * Le détail technique (`detail`) sert uniquement au diagnostic : il n'est jamais montré.
 */
export function mapHttpError(status: number, detail: string, ctx: HttpErrorContext): MagistraError {
  const d = detail.toLowerCase();
  const service = ctx.label;
  if (status === 401 || status === 403) {
    return new MagistraError('AI_AUTH_FAILED', ctx.local
      ? `${service} a refusé l'accès : vérifiez la clé d'accès dans les réglages.`
      : `${service} a refusé l'accès (clé d'accès refusée). Vérifiez la clé dans les réglages ou contactez l'administrateur.`);
  }
  if (status === 429) {
    return new MagistraError('AI_BUSY', `${service} est surchargé (trop de demandes simultanées). Réessayez dans quelques instants.`);
  }
  if (status === 413 || CONTEXT_RE.test(d)) return new MagistraError('CONTEXT_TOO_LARGE');
  if (MEMORY_RE.test(d)) return new MagistraError('OUT_OF_MEMORY');
  if (MODEL_RE.test(d) || (status === 404 && /\bmodel\b/.test(d))) {
    return new MagistraError('MODEL_NOT_INSTALLED', ctx.local
      ? `Le modèle ${ctx.modelLabel ?? ctx.model} n'est pas encore installé.`
      : `Le modèle « ${ctx.model} » n'est pas disponible sur ${lowerFirst(service)}.`);
  }
  if (status === 404) {
    return new MagistraError('AI_BAD_RESPONSE',
      `${service} : service introuvable à cette adresse. Vérifiez l'adresse du serveur dans les réglages.`);
  }
  if (status === 504 || status === 408) {
    return new MagistraError('AI_TIMEOUT', `${service} n'a pas répondu à temps. Réessayez dans quelques instants.`);
  }
  if (status >= 500) {
    return new MagistraError('AI_SERVER_UNAVAILABLE', ctx.local
      ? `${service} a rencontré une erreur. Réessayez dans quelques instants.`
      : `${service} indisponible. Réessayez dans quelques instants.`);
  }
  return new MagistraError('AI_BAD_RESPONSE');
}

/** Délai dépassé sur l'ordinateur : ce n'est pas « le serveur d'IA » qui est en cause, mais le moteur local. */
export const LOCAL_TIMEOUT_MESSAGE =
  'Le moteur IA local met trop de temps à répondre. Réessayez, choisissez un modèle plus léger (Magistra Léger) ou retirez des documents.';
export const LOCAL_BAD_RESPONSE_MESSAGE =
  'Réponse inattendue du moteur IA local. Réessayez ; si le problème persiste, redémarrez Magistra.';

/** Remplace les messages génériques « serveur d'IA » par des messages propres au moteur local. */
export function localizeEngineError(err: MagistraError, local: boolean): MagistraError {
  if (!local || err.message !== defaultMessage(err.code)) return err;
  if (err.code === 'AI_TIMEOUT') return new MagistraError('AI_TIMEOUT', LOCAL_TIMEOUT_MESSAGE, { cause: err });
  if (err.code === 'AI_BAD_RESPONSE') return new MagistraError('AI_BAD_RESPONSE', LOCAL_BAD_RESPONSE_MESSAGE, { cause: err });
  return err;
}

interface ChatChunk {
  choices?: {
    delta?: { content?: string | null };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string } | string;
}

function toFinishReason(value: string | null | undefined): FinishReason | undefined {
  if (!value) return undefined;
  return value === 'length' || value === 'max_tokens' ? 'length' : 'stop';
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly kind = 'openai-compatible' as const;
  readonly model: string;
  readonly label: string;
  readonly local: boolean;
  readonly contextTokens: number;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeouts: TimeoutOptions;
  private readonly fetchImpl: FetchLike;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.baseUrl || !config.model) throw new MagistraError('AI_NOT_CONFIGURED');
    this.baseUrl = trimSlash(config.baseUrl);
    this.model = config.model;
    this.apiKey = config.apiKey || undefined;
    this.label = config.label || "Serveur d'IA";
    this.local = config.local ?? false;
    this.contextTokens = config.contextTokens ?? 32_768;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  private get ctx(): HttpErrorContext {
    return { label: this.label, model: this.model, local: this.local };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private unreachable(): MagistraError {
    return this.local
      ? new MagistraError('ENGINE_NOT_RUNNING')
      : new MagistraError('AI_SERVER_UNAVAILABLE', `${this.label} indisponible. Réessayez dans quelques instants.`);
  }

  private chunkError(chunk: ChatChunk): MagistraError {
    const e = chunk.error;
    const msg = typeof e === 'string' ? e : e?.message ?? '';
    const code = typeof e === 'object' && e ? Number(e.code) : NaN;
    return mapHttpError(Number.isInteger(code) && code >= 400 ? code : 500, msg, this.ctx);
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
        if (isNetworkError(err)) throw this.unreachable();
        throw new MagistraError('AI_SERVER_UNAVAILABLE', `${this.label} indisponible. Réessayez dans quelques instants.`, { cause: err });
      }

      if (!res.ok) {
        const detail = await readErrorText(res);
        throw mapHttpError(res.status, detail, this.ctx);
      }
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

      const state: { finishReason: FinishReason; usage?: Usage } = { finishReason: 'unknown' };
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
      // [DONE] reçu sans finish_reason : réponse complète. Ni l'un ni l'autre : flux coupé (« unknown »).
      if (sawDone && state.finishReason === 'unknown') state.finishReason = 'stop';
      yield { type: 'end', finishReason: state.finishReason, usage: state.usage };
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw localizeEngineError(err, this.local);
      if (isNetworkError(err)) throw this.unreachable();
      throw localizeEngineError(new MagistraError('AI_BAD_RESPONSE', undefined, { cause: err }), this.local);
    } finally {
      dispose();
      // Libère la connexion si l'appelant s'arrête avant la fin (le serveur cesse alors de générer).
      controller.abort();
    }
  }

  generate(options: ChatOptions): Promise<GenerateResult> {
    return collectStream(this, options);
  }

  async health(signal?: AbortSignal): Promise<HealthStatus> {
    try {
      const models = await this.listModels(signal);
      if (models.length > 0 && !models.some(m => sameModelName(m.name, this.model))) {
        return {
          ok: false,
          error: { code: 'MODEL_NOT_INSTALLED', message: `Le modèle « ${this.model} » n'est pas disponible sur ${lowerFirst(this.label)}.` },
        };
      }
      return { ok: true };
    } catch (err) {
      const e = err instanceof MagistraError ? err : this.unreachable();
      return { ok: false, error: { code: e.code, message: e.message } };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    let res: Response;
    const timeout = AbortSignal.timeout(10_000);
    try {
      res = await this.fetchImpl(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (timeout.aborted) {
        throw this.local ? new MagistraError('ENGINE_NOT_RUNNING') : new MagistraError('AI_TIMEOUT', `${this.label} n'a pas répondu à temps.`);
      }
      if (isNetworkError(err) || (err as Error)?.name === 'TimeoutError') throw this.unreachable();
      throw new MagistraError('AI_SERVER_UNAVAILABLE', `${this.label} indisponible. Réessayez dans quelques instants.`, { cause: err });
    }
    if (!res.ok) throw mapHttpError(res.status, await readErrorText(res), this.ctx);
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
    return (Array.isArray(data.data) ? data.data : [])
      .filter((m): m is { id: string } => typeof m?.id === 'string' && m.id.length > 0)
      .map(m => ({ name: m.id }));
  }
}

/** « modele » et « modele:latest » désignent le même modèle ; la casse est ignorée. */
function sameModelName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/:latest$/, '');
  return norm(a) === norm(b);
}
