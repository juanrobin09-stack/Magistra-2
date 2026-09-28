// Client et fournisseur Ollama (API native).
// L'API native est utilisée plutôt que /v1 car elle permet de régler la taille de contexte (num_ctx),
// indispensable pour exploiter les documents de l'enseignant, et d'installer les modèles (/api/pull).

import { MagistraError } from '../errors.js';
import {
  collectStream, type AIProvider, type ChatOptions, type FetchLike, type FinishReason, type GenerateResult,
  type HealthStatus, type ModelInfo, type StreamEvent, type Usage,
} from './provider.js';
import { localizeEngineError, mapHttpError, type HttpErrorContext } from './openaiCompatible.js';
import {
  fetchWithTimeout, isNetworkError, linkSignals, lowerFirst, readErrorText, readLines, safeJsonParse, trimSlash, type TimeoutOptions,
} from './streams.js';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}

export interface PullProgress {
  status: string;
  /** Octets téléchargés / total, pour la couche en cours. */
  completed?: number;
  total?: number;
  digest?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  parameterSize?: string;
  family?: string;
}

export class OllamaClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL, fetchImpl?: FetchLike) {
    this.baseUrl = trimSlash(baseUrl);
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get local(): boolean {
    return isLoopbackUrl(this.baseUrl);
  }

  private unreachable(): MagistraError {
    return this.local ? new MagistraError('ENGINE_NOT_RUNNING') : new MagistraError('AI_SERVER_UNAVAILABLE');
  }

  async request(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal });
    } catch {
      if (init.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      // Connexion refusée, délai dépassé, hôte introuvable… : le moteur ne répond pas.
      throw this.unreachable();
    }
  }

  /** Version du serveur Ollama, ou null s'il ne répond pas. */
  async version(): Promise<string | null> {
    try {
      const res = await this.request('/api/version', {}, 3_000);
      if (!res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as { version?: unknown };
      return typeof data.version === 'string' && data.version ? data.version : 'inconnue';
    } catch {
      return null;
    }
  }

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const res = await this.request('/api/tags', { signal }, 10_000);
    if (!res.ok) throw mapHttpError(res.status, await readErrorText(res), { label: 'Ollama', model: '', local: this.local });
    const data = (await res.json().catch(() => ({}))) as {
      models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string; family?: string } }[];
    };
    return (Array.isArray(data.models) ? data.models : []).map(m => ({
      name: m.name ?? m.model ?? '',
      size: m.size ?? 0,
      parameterSize: m.details?.parameter_size,
      family: m.details?.family,
    })).filter(m => m.name);
  }

  async hasModel(model: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => sameModel(m.name, model));
  }

  /**
   * Télécharge un modèle en rapportant la progression.
   * Un téléchargement interrompu reprend là où il s'était arrêté (Ollama conserve les couches déjà reçues).
   */
  async pull(model: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
    const { controller, dispose } = linkSignals(signal);
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: true }),
        }, controller, 120_000);
      } catch (err) {
        if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED', 'Téléchargement interrompu.');
        if (err instanceof MagistraError) throw err;
        if (isNetworkError(err)) throw this.unreachable();
        throw err;
      }
      if (!res.ok) throw pullError(await readErrorText(res));
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.');
      let success = false;
      for await (const line of readLines(res.body, controller, { firstChunkMs: 120_000, idleMs: 300_000 }, signal)) {
        if (!line.trim()) continue;
        const msg = safeJsonParse(line) as { status?: string; completed?: number; total?: number; digest?: string; error?: string } | undefined;
        if (!msg) continue;
        if (msg.error) throw pullError(msg.error);
        if (msg.status) {
          onProgress({ status: msg.status, completed: msg.completed, total: msg.total, digest: msg.digest });
          if (msg.status === 'success') success = true;
        }
      }
      if (!success) {
        if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED', 'Téléchargement interrompu.');
        throw new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle ne s’est pas terminé. Relancez-le : il reprendra où il s’est arrêté.');
      }
    } catch (err) {
      if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED', 'Téléchargement interrompu.');
      if (err instanceof MagistraError) throw err;
      throw new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
    } finally {
      dispose();
      controller.abort();
    }
  }
}

function pullError(detail: string): MagistraError {
  const d = detail.toLowerCase();
  if (/no space|disk full|not enough space/.test(d)) {
    return new MagistraError('AI_BAD_RESPONSE', "Espace disque insuffisant pour installer ce modèle.");
  }
  if (/newer version|requires a newer|upgrade ollama/.test(d)) {
    return new MagistraError('AI_BAD_RESPONSE', "Ce modèle nécessite une version plus récente du moteur IA (Ollama). Mettez-le à jour puis relancez l'installation.");
  }
  if (/dial tcp|lookup |no such host|timeout|connection|network|tls|max retries|unexpected eof|\beof\b/.test(d)) {
    return new MagistraError('NETWORK_ERROR', "Téléchargement impossible : vérifiez votre connexion Internet. Il reprendra où il s'est arrêté.");
  }
  if (/file does not exist|not found|manifest unknown/.test(d)) {
    return new MagistraError('AI_BAD_RESPONSE', "Ce modèle est introuvable dans la bibliothèque Ollama. Vérifiez son nom dans les réglages avancés.");
  }
  return new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.');
}

/**
 * « x » et « x:latest » désignent le même modèle, de même que « registry.ollama.ai/library/x:tag » et « x:tag ».
 * La casse est ignorée ; « ministral-3:8b » et « ministral-3:14b » restent distincts.
 */
export function sameModel(a: string, b: string): boolean {
  const norm = (s: string) => {
    const name = s.trim().toLowerCase().replace(/^registry\.ollama\.ai\/library\//, '').replace(/^library\//, '');
    const lastSegment = name.slice(name.lastIndexOf('/') + 1);
    return lastSegment.includes(':') ? name : `${name}:latest`;
  };
  return norm(a) === norm(b);
}

export interface OllamaProviderConfig {
  baseUrl?: string;
  model: string;
  /**
   * Libellé lisible : nom du modèle en local (« Magistra Standard »),
   * nom du serveur pour une instance distante (« Serveur universitaire »).
   */
  label?: string;
  contextTokens?: number;
  keepAlive?: string;
  timeouts?: Partial<TimeoutOptions>;
  fetch?: FetchLike;
}

export class OllamaProvider implements AIProvider {
  readonly kind = 'ollama' as const;
  readonly model: string;
  readonly label: string;
  readonly contextTokens: number;
  readonly client: OllamaClient;
  private readonly keepAlive: string;
  private readonly timeouts: TimeoutOptions;
  private readonly fetchImpl: FetchLike;

  constructor(config: OllamaProviderConfig) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    this.client = new OllamaClient(config.baseUrl ?? DEFAULT_OLLAMA_URL, this.fetchImpl);
    this.model = config.model;
    this.label = config.label ?? config.model;
    this.contextTokens = config.contextTokens ?? 12_288;
    this.keepAlive = config.keepAlive ?? '15m';
    // Le premier token peut être long : chargement du modèle en mémoire sur un PC sans carte graphique.
    this.timeouts = { firstChunkMs: 300_000, idleMs: 120_000, ...config.timeouts };
  }

  get local(): boolean {
    return this.client.local;
  }

  /** Contexte des messages d'erreur : « Moteur IA » en local, libellé du serveur à distance. */
  private get errorContext(): HttpErrorContext {
    return this.local
      ? { label: 'Le moteur IA local', model: this.model, local: true, modelLabel: this.label }
      : { label: this.serverLabel, model: this.model, local: false };
  }

  /** Libellé du serveur distant (le libellé fourni, ou « Serveur Ollama » par défaut). */
  private get serverLabel(): string {
    return this.label === this.model ? 'Serveur Ollama' : this.label;
  }

  private unreachable(): MagistraError {
    if (this.local) return new MagistraError('ENGINE_NOT_RUNNING');
    return new MagistraError('AI_SERVER_UNAVAILABLE', `${this.serverLabel} indisponible. Réessayez dans quelques instants.`);
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const { controller, dispose } = linkSignals(options.signal);
    const ctx = this.errorContext;
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.client.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            messages: options.messages,
            stream: true,
            keep_alive: this.keepAlive,
            options: {
              num_ctx: this.contextTokens,
              num_predict: options.maxTokens ?? -1,
              temperature: options.temperature ?? 0.4,
            },
          }),
        }, controller, this.timeouts.firstChunkMs);
      } catch (err) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        if (err instanceof MagistraError) throw err;
        // Connexion refusée (moteur arrêté), hôte injoignable…
        throw this.unreachable();
      }
      if (!res.ok) throw mapHttpError(res.status, await readErrorText(res), ctx);
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE');

      let finishReason: FinishReason = 'unknown';
      let usage: Usage | undefined;
      for await (const line of readLines(res.body, controller, this.timeouts, options.signal)) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        if (!line.trim()) continue;
        const msg = safeJsonParse(line) as {
          // « thinking » (modèles à raisonnement) est volontairement ignoré : seul « content » est affiché.
          message?: { content?: string; thinking?: string };
          done?: boolean;
          done_reason?: string;
          prompt_eval_count?: number;
          eval_count?: number;
          error?: string;
        } | undefined;
        if (!msg || typeof msg !== 'object') continue;
        if (msg.error) throw mapHttpError(500, String(msg.error), ctx);
        const text = msg.message?.content;
        if (typeof text === 'string' && text.length > 0) yield { type: 'delta', text };
        if (msg.done) {
          finishReason = msg.done_reason === 'length' ? 'length' : 'stop';
          usage = { promptTokens: msg.prompt_eval_count, completionTokens: msg.eval_count };
          break;
        }
      }
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      yield { type: 'end', finishReason, usage };
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw localizeEngineError(err, this.local);
      if (isNetworkError(err)) throw this.unreachable();
      throw localizeEngineError(new MagistraError('AI_BAD_RESPONSE', undefined, { cause: err }), this.local);
    } finally {
      dispose();
      // Si l'appelant s'arrête avant la fin, la connexion est coupée : Ollama cesse de générer.
      controller.abort();
    }
  }

  generate(options: ChatOptions): Promise<GenerateResult> {
    return collectStream(this, options);
  }

  async health(): Promise<HealthStatus> {
    const version = await this.client.version();
    if (!version) {
      const e = this.unreachable();
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    try {
      if (!(await this.client.hasModel(this.model))) {
        const message = this.local
          ? `Le modèle ${this.label} n'est pas encore installé.`
          : `Le modèle « ${this.model} » n'est pas disponible sur ${lowerFirst(this.serverLabel)}.`;
        return { ok: false, version, error: { code: 'MODEL_NOT_INSTALLED', message } };
      }
    } catch (err) {
      const e = err instanceof MagistraError ? err : this.unreachable();
      return { ok: false, version, error: { code: e.code, message: e.message } };
    }
    return { ok: true, version };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const models = await this.client.listModels(signal);
    return models.map(m => ({ name: m.name, sizeBytes: m.size, parameterSize: m.parameterSize, family: m.family }));
  }
}
