// Client et fournisseur Ollama (API native).
// L'API native est utilisée plutôt que /v1 car elle permet de régler la taille de contexte (num_ctx),
// indispensable pour exploiter les documents de l'enseignant, et d'installer les modèles (/api/pull).

import { MagistraError } from '../errors.js';
import {
  aiSubject, DEFAULT_AI_SERVER_LABEL, LOCAL_ENGINE_LABEL, localizeEngineError, mapHttpError, mapNetworkError, statusUnknown, timeoutError,
  unavailableError, type ErrorRecipient, type HttpErrorContext,
} from './errorMapping.js';
import { isLoopbackUrl } from './loopback.js';
import { MODEL_TIERS, normalizeModelName, tierForModel } from './models.js';
import { addressKind } from './presets.js';
import {
  collectStream, type AIProvider, type ChatMessage, type ChatOptions, type FetchLike, type FinishReason, type GenerateResult,
  type HealthStatus, type ModelInfo, type PreloadOptions, type PreloadResult, type StreamEvent, type Usage,
} from './provider.js';
import {
  abortedByTimeout, fetchWithTimeout, isNetworkError, linkSignals, lowerFirst, raceAbort, readErrorDetail, readLines, safeJsonParse,
  trimSlash, type TimeoutOptions,
} from './streams.js';
import { ollamaTimingsFromChunk, placementFromPs, type EnginePlacement } from './timings.js';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Attente du premier mot par défaut (chargement du modèle + lecture du prompt). */
export const OLLAMA_FIRST_CHUNK_MS = 300_000;
/** Plafond de l'attente du premier mot pour le moteur local, même avec un très long prompt. */
export const LOCAL_FIRST_CHUNK_MAX_MS = 30 * 60_000;
/** Vitesse de lecture du prompt retenue pour un PC sans carte graphique (prudente : 10 tokens/s). */
export const LOCAL_PROMPT_TOKENS_PER_SECOND = 10;
/** Silence toléré pendant un téléchargement de modèle. */
export const PULL_IDLE_MS = 300_000;
/** Silence toléré pendant « verifying sha256 digest » : Ollama vérifie toutes les couches sans rien émettre. */
export const PULL_VERIFY_IDLE_MS = 15 * 60_000;
/** Délai maximal du préchargement d'un modèle en mémoire (preload). */
export const PRELOAD_TIMEOUT_MS = 10 * 60_000;
/** Délai de la lecture des modèles chargés (GET /api/ps) : une mesure facultative, jamais une attente. */
export const RUNNING_TIMEOUT_MS = 3_000;

export { isLoopbackUrl };

/** Estimation prudente (plutôt haute) du nombre de tokens d'une conversation : ≈ 3 caractères par token. */
export function estimatePromptTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((n, m) => n + Math.ceil((m.content?.length ?? 0) / 3) + 8, 0);
}

/**
 * Attente du premier mot pour le moteur de CET ordinateur, adaptée à la taille du prompt :
 * max(300 s, 120 s + tokens du prompt / 10 tokens/s), plafonnée à 30 min. Ollama n'envoie rien avant le premier
 * mot (chargement du modèle puis lecture de tout le prompt) : sur un PC sans carte graphique, avec des documents,
 * 300 s ne suffisent pas toujours.
 */
export function localFirstChunkTimeoutMs(promptTokens: number): number {
  const tokens = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0;
  const ms = 120_000 + (tokens / LOCAL_PROMPT_TOKENS_PER_SECOND) * 1_000;
  return Math.min(LOCAL_FIRST_CHUNK_MAX_MS, Math.max(OLLAMA_FIRST_CHUNK_MS, Math.round(ms)));
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
  /**
   * Hôte vers lequel Ollama relaie ce modèle (« remote_host » de /api/tags : modèle « cloud » ou OLLAMA_REMOTES) :
   * les textes ne restent alors pas sur la machine d'Ollama (voir ollamaRemote.ts).
   */
  remoteHost?: string;
}

export interface OllamaClientOptions {
  /**
   * Clé d'accès (AI_API_KEY) : Ollama n'a pas d'authentification, mais un proxy inverse placé devant
   * (ou Ollama Cloud) peut en exiger une. Envoyée en « Authorization: Bearer » sur toutes les requêtes.
   */
  apiKey?: string;
  /** Libellé du serveur dans les messages (défaut : « Le moteur IA local » sur ce poste, « Serveur d'IA » sinon). */
  label?: string;
  /** Destinataire des conseils d'erreur ('poste' par défaut). */
  recipient?: ErrorRecipient;
  /** Délais du téléchargement de modèle (tests) : premier octet, silence normal, silence pendant la vérification. */
  pullTimeouts?: Partial<{ firstChunkMs: number; idleMs: number; verifyIdleMs: number }>;
}

export class OllamaClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiKey?: string;
  private readonly recipient: ErrorRecipient;
  private readonly label: string;
  private readonly pullTimeouts: { firstChunkMs: number; idleMs: number; verifyIdleMs: number };

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL, fetchImpl?: FetchLike, options: OllamaClientOptions = {}) {
    this.baseUrl = trimSlash(baseUrl);
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.apiKey = options.apiKey || undefined;
    this.recipient = options.recipient ?? 'poste';
    this.label = options.label ?? (this.onThisComputer ? LOCAL_ENGINE_LABEL : DEFAULT_AI_SERVER_LABEL);
    this.pullTimeouts = { firstChunkMs: 120_000, idleMs: PULL_IDLE_MS, verifyIdleMs: PULL_VERIFY_IDLE_MS, ...options.pullTimeouts };
  }

  get local(): boolean {
    return isLoopbackUrl(this.baseUrl);
  }

  /** Moteur de l'ordinateur de l'enseignant (application Windows). */
  private get onThisComputer(): boolean {
    return this.local && this.recipient === 'poste';
  }

  private get ctx(): HttpErrorContext {
    return { label: this.label, model: '', local: this.local, recipient: this.recipient, api: 'ollama', addressKind: addressKind(this.baseUrl) };
  }

  /** En-têtes d'une requête : ceux fournis, plus « Authorization: Bearer » si une clé est configurée. */
  headers(extra?: RequestInit['headers']): Record<string, string> {
    const out: Record<string, string> = {};
    new Headers(extra ?? {}).forEach((value, key) => {
      out[key] = value;
    });
    if (this.apiKey) out.authorization = `Bearer ${this.apiKey}`;
    return out;
  }

  async request(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const external = init.signal ?? undefined;
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;
    try {
      // raceAbort : rend la main au délai même si l'implémentation de fetch ignore le signal.
      return await raceAbort(this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: this.headers(init.headers), signal }), signal);
    } catch (err) {
      if (external?.aborted) throw abortedByTimeout(external) ? timeoutError(this.ctx) : new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw err;
      // Délai dépassé : sur ce poste, le moteur ne répond pas (arrêté, ou en cours de démarrage).
      if (timeout.aborted) throw this.onThisComputer ? new MagistraError('ENGINE_NOT_RUNNING') : timeoutError(this.ctx);
      // Connexion refusée, hôte introuvable… : moteur arrêté (ce poste) ou serveur injoignable.
      if (isNetworkError(err)) throw mapNetworkError(err, this.ctx);
      throw unavailableError(this.ctx, err);
    }
  }

  /**
   * Version du serveur Ollama (« inconnue » si la réponse n'en donne pas). Lève une MagistraError :
   * ENGINE_NOT_RUNNING (moteur de ce poste arrêté), AI_SERVER_UNREACHABLE, AI_AUTH_FAILED (401/403 : clé refusée
   * par le proxy), AI_BAD_RESPONSE (404 : pas un serveur Ollama à cette adresse), AI_TIMEOUT, GENERATION_ABORTED.
   * Délai : 3 s sur ce poste, 10 s pour un serveur distant.
   */
  async checkVersion(signal?: AbortSignal, timeoutMs: number = this.local ? 3_000 : 10_000): Promise<string> {
    const res = await this.request('/api/version', { signal }, timeoutMs);
    if (!res.ok) throw mapHttpError(res.status, await readErrorDetail(res), this.ctx);
    const data = (await res.json().catch(() => ({}))) as { version?: unknown };
    return typeof data.version === 'string' && data.version ? data.version : 'inconnue';
  }

  /** Version du serveur Ollama, ou null s'il ne répond pas (ou refuse l'accès). */
  async version(signal?: AbortSignal): Promise<string | null> {
    try {
      return await this.checkVersion(signal);
    } catch {
      return null;
    }
  }

  /**
   * Modèles actuellement chargés en mémoire (GET /api/ps), tels que les décrit Ollama (voir placementFromPs,
   * shared/ai/timings.ts : carte graphique, processeur ou les deux). Mesure facultative : délai court (3 s) et
   * jamais d'erreur — `undefined` si le moteur ne répond pas, refuse l'accès ou ne renvoie pas du JSON.
   * Ne contacte que le moteur configuré (même adresse que les autres requêtes).
   */
  async running(signal?: AbortSignal, timeoutMs: number = RUNNING_TIMEOUT_MS): Promise<unknown> {
    try {
      const res = await this.request('/api/ps', { signal }, timeoutMs);
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      return await res.json();
    } catch {
      return undefined;
    }
  }

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const res = await this.request('/api/tags', { signal }, 10_000);
    if (!res.ok) throw mapHttpError(res.status, await readErrorDetail(res), this.ctx);
    const data = (await res.json().catch(() => ({}))) as {
      models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string; family?: string }; remote_host?: unknown }[];
    };
    return (Array.isArray(data.models) ? data.models : []).map(m => ({
      name: m.name ?? m.model ?? '',
      size: m.size ?? 0,
      parameterSize: m.details?.parameter_size,
      family: m.details?.family,
      ...(typeof m.remote_host === 'string' && m.remote_host.trim() ? { remoteHost: m.remote_host.trim() } : {}),
    })).filter(m => m.name);
  }

  async hasModel(model: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => sameModel(m.name, model));
  }

  /**
   * Télécharge un modèle en rapportant la progression.
   * Un téléchargement interrompu reprend là où il s'était arrêté (Ollama conserve les couches déjà reçues).
   * Pendant « verifying sha256 digest », Ollama ne dit plus rien jusqu'à la fin de la vérification :
   * le silence toléré passe alors de 5 à 15 minutes (PULL_VERIFY_IDLE_MS).
   * Moteur trop ancien pour ce modèle (412 du registre) → ENGINE_OUTDATED.
   */
  async pull(model: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
    const { controller, dispose } = linkSignals(signal);
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/api/pull`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ model, stream: true }),
        }, controller, this.pullTimeouts.firstChunkMs);
      } catch (err) {
        if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED', 'Téléchargement interrompu.');
        if (err instanceof MagistraError) throw err;
        if (isNetworkError(err)) throw mapNetworkError(err, this.ctx);
        throw err;
      }
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        if (res.status === 401 || res.status === 403) throw mapHttpError(res.status, detail, this.ctx);
        throw pullError(detail.message, res.status);
      }
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.');
      let success = false;
      // Objet relu par readLines avant chaque attente : modifier idleMs change le silence toléré suivant.
      const { firstChunkMs, idleMs, verifyIdleMs } = this.pullTimeouts;
      const timeouts: TimeoutOptions = { firstChunkMs, idleMs };
      for await (const line of readLines(res.body, controller, timeouts, signal)) {
        if (!line.trim()) continue;
        const msg = safeJsonParse(line) as { status?: string; completed?: number; total?: number; digest?: string; error?: string } | undefined;
        if (!msg) continue;
        if (msg.error) throw pullError(msg.error);
        if (msg.status) {
          timeouts.idleMs = msg.status.toLowerCase().startsWith('verifying') ? verifyIdleMs : idleMs;
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
      if (err instanceof MagistraError && err.code === 'AI_TIMEOUT') {
        throw new MagistraError('AI_TIMEOUT', 'Le téléchargement du modèle ne progresse plus. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
      }
      if (err instanceof MagistraError) throw err;
      throw new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
    } finally {
      dispose();
      controller.abort();
    }
  }
}

/** Message d'échec d'un téléchargement de modèle (ligne { error } d'Ollama, ou statut HTTP). */
export function pullError(detail: string, status?: number): MagistraError {
  const d = detail.toLowerCase();
  if (status === 412 || /newer version|requires a newer|upgrade ollama/.test(d)) {
    return new MagistraError('ENGINE_OUTDATED', "Ce modèle nécessite une version plus récente du moteur IA (Ollama) : mettez-le à jour, puis relancez l'installation du modèle.");
  }
  if (/no space|disk full|not enough space/.test(d)) {
    return new MagistraError('AI_BAD_RESPONSE', "Espace disque insuffisant pour installer ce modèle.");
  }
  if (/\bforbidden\b|\b403\b|proxy/.test(d)) {
    return new MagistraError('NETWORK_ERROR', "Téléchargement bloqué par le réseau (proxy ou filtrage de l'établissement ?) : vérifiez votre connexion Internet ou essayez depuis un autre réseau. Il reprendra où il s'est arrêté.");
  }
  if (/dial tcp|lookup |no such host|timeout|connection|network|tls|max retries|unexpected eof|\beof\b/.test(d)) {
    return new MagistraError('NETWORK_ERROR', "Téléchargement impossible : vérifiez votre connexion Internet (sur le réseau d'un établissement, un proxy peut bloquer le téléchargement). Il reprendra où il s'est arrêté.");
  }
  if (/file does not exist|not found|manifest unknown/.test(d)) {
    return new MagistraError('AI_BAD_RESPONSE', "Ce modèle est introuvable dans la bibliothèque Ollama. Vérifiez son nom dans les réglages avancés.");
  }
  return new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.');
}

/**
 * « x » et « x:latest » désignent le même modèle, de même que « registry.ollama.ai/library/x:tag » et « x:tag ».
 * La casse est ignorée ; « ministral-3:8b » et « ministral-3:14b » restent distincts.
 * Pour reconnaître aussi les alias d'un niveau Magistra (« ministral-3:latest » pour Léger), voir
 * installedModelForTier / modelMatchesTier (shared/ai/models.ts).
 */
export function sameModel(a: string, b: string): boolean {
  return normalizeModelName(a) === normalizeModelName(b);
}

export interface OllamaProviderConfig {
  baseUrl?: string;
  model: string;
  /**
   * Libellé affiché (AIProvider.label). Compatibilité : s'il désigne un niveau Magistra (« Magistra Standard »)
   * ou le modèle lui-même, il sert aussi de `modelLabel` ; sinon, il sert de `serverLabel` (« Serveur universitaire »).
   * Défaut : `modelLabel` pour le moteur de ce poste, `serverLabel` sinon.
   */
  label?: string;
  /** Nom lisible du modèle dans les messages. Défaut : niveau du catalogue (alias compris), sinon le nom technique. */
  modelLabel?: string;
  /** Nom du serveur dans les messages. Défaut : « Le moteur IA local » sur ce poste, « Serveur d'IA » ailleurs. */
  serverLabel?: string;
  /** Clé d'accès (proxy inverse devant Ollama, Ollama Cloud) : « Authorization: Bearer » sur toutes les requêtes. */
  apiKey?: string;
  /** Destinataire des conseils d'erreur : 'poste' (Windows, défaut) ou 'administrateur' (site web). */
  recipient?: ErrorRecipient;
  contextTokens?: number;
  keepAlive?: string;
  /**
   * Délais. Si `firstChunkMs` n'est pas fixé et que le moteur est sur la boucle locale, l'attente du premier mot
   * est adaptée à la taille du prompt (localFirstChunkTimeoutMs) ; sinon 300 s.
   */
  timeouts?: Partial<TimeoutOptions>;
  /** Fuseau horaire des messages de quota (défaut Europe/Paris). */
  timeZone?: string;
  fetch?: FetchLike;
  /** Horloge en millisecondes (tests) : défaut performance.now(). */
  now?: () => number;
}

export class OllamaProvider implements AIProvider {
  readonly kind = 'ollama' as const;
  readonly model: string;
  readonly label: string;
  /** Nom lisible du modèle (« Magistra Standard »), utilisé dans « Le modèle … n'est pas encore installé. ». */
  readonly modelLabel: string;
  /** Nom du serveur (« Serveur universitaire »), utilisé dans les messages d'un serveur distant. */
  readonly serverLabel: string;
  readonly recipient: ErrorRecipient;
  readonly contextTokens: number;
  readonly client: OllamaClient;
  private readonly keepAlive: string;
  private readonly timeouts: TimeoutOptions;
  private readonly adaptiveFirstChunk: boolean;
  private readonly timeZone?: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(config: OllamaProviderConfig) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    this.now = config.now ?? (() => performance.now());
    this.model = config.model;
    this.recipient = config.recipient ?? 'poste';
    const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_URL;
    const here = isLoopbackUrl(baseUrl) && this.recipient === 'poste';
    const labelIsModel = Boolean(config.label) && (config.label === config.model || MODEL_TIERS.some(t => t.label === config.label));
    this.modelLabel = config.modelLabel ?? (labelIsModel ? config.label! : undefined) ?? tierForModel(config.model)?.label ?? config.model;
    this.serverLabel = config.serverLabel ?? (config.label && !labelIsModel ? config.label : here ? LOCAL_ENGINE_LABEL : DEFAULT_AI_SERVER_LABEL);
    this.label = config.label ?? (here ? this.modelLabel : this.serverLabel);
    this.client = new OllamaClient(baseUrl, this.fetchImpl, {
      apiKey: config.apiKey,
      label: here ? LOCAL_ENGINE_LABEL : this.serverLabel,
      recipient: this.recipient,
    });
    this.contextTokens = config.contextTokens ?? 12_288;
    this.keepAlive = config.keepAlive ?? '15m';
    this.timeZone = config.timeZone;
    // Le premier token peut être long : chargement du modèle et lecture du prompt sur un PC sans carte graphique.
    this.adaptiveFirstChunk = config.timeouts?.firstChunkMs === undefined;
    this.timeouts = { firstChunkMs: OLLAMA_FIRST_CHUNK_MS, idleMs: 120_000, ...config.timeouts };
  }

  get local(): boolean {
    return this.client.local;
  }

  /** Moteur de l'ordinateur de l'enseignant (application Windows) : messages du moteur local. */
  private get onThisComputer(): boolean {
    return this.local && this.recipient === 'poste';
  }

  /** Contexte des messages d'erreur : « Le moteur IA local » sur ce poste, libellé du serveur sinon. */
  private get errorContext(): HttpErrorContext {
    return {
      label: this.onThisComputer ? LOCAL_ENGINE_LABEL : this.serverLabel,
      model: this.model,
      local: this.local,
      modelLabel: this.modelLabel,
      recipient: this.recipient,
      api: 'ollama',
      addressKind: addressKind(this.client.baseUrl),
      timeZone: this.timeZone,
    };
  }

  /** Attente du premier mot pour cette conversation (adaptée à la taille du prompt pour le moteur local). */
  firstChunkTimeoutMs(messages: readonly ChatMessage[]): number {
    return this.adaptiveFirstChunk && this.local
      ? localFirstChunkTimeoutMs(estimatePromptTokens(messages))
      : this.timeouts.firstChunkMs;
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const { controller, dispose } = linkSignals(options.signal);
    const ctx = this.errorContext;
    const timeouts: TimeoutOptions = { firstChunkMs: this.firstChunkTimeoutMs(options.messages), idleMs: this.timeouts.idleMs };
    const startedAt = this.now();
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.client.baseUrl}/api/chat`, {
          method: 'POST',
          headers: this.client.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model: this.model,
            messages: options.messages,
            stream: true,
            // Pas de « réflexion » préalable (modèles à raisonnement du mode avancé) : elle serait invisible,
            // retarderait le premier mot et consommerait le budget num_predict. Accepté par tous les modèles.
            think: false,
            keep_alive: this.keepAlive,
            options: {
              num_ctx: this.contextTokens,
              num_predict: options.maxTokens ?? -1,
              temperature: options.temperature ?? 0.4,
            },
          }),
        }, controller, timeouts.firstChunkMs);
      } catch (err) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        if (err instanceof MagistraError) throw err;
        // Connexion refusée (moteur arrêté), hôte injoignable…
        throw mapNetworkError(err, ctx);
      }
      if (!res.ok) throw mapHttpError(res.status, await readErrorDetail(res), ctx);
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE');

      let finishReason: FinishReason = 'unknown';
      let usage: Usage | undefined;
      let firstDeltaMs: number | undefined;
      // Placement du modèle (GET /api/ps), relevé en tâche de fond après le premier mot : la rédaction n'attend jamais
      // cette mesure ; si elle n'est pas revenue à la fin, elle est simplement absente.
      const probe: { placement?: EnginePlacement } = {};
      for await (const line of readLines(res.body, controller, timeouts, options.signal)) {
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
        if (typeof text === 'string' && text.length > 0) {
          if (firstDeltaMs === undefined) {
            firstDeltaMs = Math.max(0, Math.round(this.now() - startedAt));
            if (this.onThisComputer) {
              void this.client.running(controller.signal).then(body => {
                probe.placement = placementFromPs(body, this.model);
              }).catch(() => undefined);
            }
          }
          yield { type: 'delta', text };
        }
        if (msg.done) {
          finishReason = msg.done_reason === 'length' ? 'length' : 'stop';
          const timings = ollamaTimingsFromChunk(msg);
          usage = { promptTokens: msg.prompt_eval_count, completionTokens: msg.eval_count, ...(timings ? { timings } : {}) };
          break;
        }
      }
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (usage && (firstDeltaMs !== undefined || probe.placement)) {
        usage = { ...usage, ...(firstDeltaMs !== undefined ? { timeToFirstDeltaMs: firstDeltaMs } : {}), ...(probe.placement ? { placement: probe.placement } : {}) };
      }
      yield { type: 'end', finishReason, usage };
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw localizeEngineError(err, this.onThisComputer);
      if (isNetworkError(err)) throw mapNetworkError(err, ctx);
      throw localizeEngineError(new MagistraError('AI_BAD_RESPONSE', undefined, { cause: err }), this.onThisComputer);
    } finally {
      dispose();
      // Si l'appelant s'arrête avant la fin, la connexion est coupée : Ollama cesse de générer.
      controller.abort();
    }
  }

  generate(options: ChatOptions): Promise<GenerateResult> {
    return collectStream(this, options);
  }

  /**
   * Charge le modèle en mémoire sans rien générer : POST /api/chat avec messages [] (Ollama répond
   * done_reason « load » une fois le modèle chargé), avec le même num_ctx que la génération pour ne pas
   * provoquer un second chargement. À afficher avec le statut « Chargement du modèle… ».
   * Lève MODEL_NOT_INSTALLED, OUT_OF_MEMORY, ENGINE_NOT_RUNNING, AI_TIMEOUT (au-delà de 10 min par défaut)…
   */
  async preload(options: PreloadOptions = {}): Promise<PreloadResult | void> {
    const { controller, dispose } = linkSignals(options.signal);
    const ctx = this.errorContext;
    const timeoutMs = options.timeoutMs ?? PRELOAD_TIMEOUT_MS;
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(this.fetchImpl, `${this.client.baseUrl}/api/chat`, {
          method: 'POST',
          headers: this.client.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ model: this.model, messages: [], stream: false, keep_alive: this.keepAlive, options: { num_ctx: this.contextTokens } }),
        }, controller, timeoutMs);
      } catch (err) {
        if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        if (err instanceof MagistraError) throw err;
        throw mapNetworkError(err, ctx);
      }
      if (!res.ok) throw mapHttpError(res.status, await readErrorDetail(res), ctx);
      if (!res.body) return;
      // Réponse attendue : un seul objet JSON { done: true, done_reason: 'load' }. Un serveur qui répondrait par un
      // flux est accepté aussi : la première ligne valide suffit à savoir que le modèle est chargé.
      let loadMs: number | undefined;
      for await (const line of readLines(res.body, controller, { firstChunkMs: timeoutMs, idleMs: this.timeouts.idleMs }, options.signal)) {
        if (!line.trim()) continue;
        const msg = safeJsonParse(line) as { error?: unknown } | undefined;
        if (!msg || typeof msg !== 'object') continue;
        if (msg.error) throw mapHttpError(500, String(msg.error), ctx);
        // Durée de chargement annoncée par le moteur (load_duration, en nanosecondes) : le vrai coût du chargement,
        // même quand il s'est fait pendant la préparation de la demande.
        loadMs = ollamaTimingsFromChunk(msg)?.loadMs;
        break;
      }
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      return loadMs !== undefined ? { loadMs } : undefined;
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw localizeEngineError(err, this.onThisComputer);
      if (isNetworkError(err)) throw mapNetworkError(err, ctx);
      throw localizeEngineError(new MagistraError('AI_BAD_RESPONSE', undefined, { cause: err }), this.onThisComputer);
    } finally {
      dispose();
      controller.abort();
    }
  }

  /**
   * État du moteur : version (/api/version) puis présence du modèle (/api/tags), sans rien générer.
   * Respecte `signal` : s'il expire (délai du test de santé), l'état est « non vérifié » (ok vrai + AI_STATUS_UNKNOWN).
   * Ne lève jamais et ne renvoie jamais GENERATION_ABORTED.
   */
  async health(signal?: AbortSignal): Promise<HealthStatus> {
    const ctx = this.errorContext;
    const unknown = (err: unknown): boolean => {
      if (signal?.aborted) return true;
      // Sur ce poste, un moteur qui ne répond pas est « non démarré » (déjà traduit par le client).
      return !this.onThisComputer && err instanceof MagistraError && err.code === 'AI_TIMEOUT';
    };
    let version: string;
    try {
      version = await this.client.checkVersion(signal);
    } catch (err) {
      if (unknown(err)) return { ok: true, warning: statusUnknown(ctx, 'timeout') };
      const e = err instanceof MagistraError ? err : unavailableError(ctx, err);
      return { ok: false, error: { code: e.code, message: e.message } };
    }
    try {
      const models = await this.client.listModels(signal);
      if (!models.some(m => sameModel(m.name, this.model))) {
        const where = lowerFirst(aiSubject(ctx.label));
        const message = this.onThisComputer
          ? `Le modèle ${this.modelLabel} n'est pas encore installé.`
          : this.recipient === 'administrateur'
            ? `Le modèle « ${this.model} » n'est pas installé sur ${where}. L'administrateur du site doit l'installer (ollama pull ${this.model}) ou corriger AI_MODEL.`
            : `Le modèle « ${this.model} » n'est pas installé sur ${where} : vérifiez son nom dans les réglages.`;
        return { ok: false, version, error: { code: 'MODEL_NOT_INSTALLED', message } };
      }
    } catch (err) {
      if (unknown(err)) return { ok: true, version, warning: statusUnknown(ctx, 'timeout') };
      const e = err instanceof MagistraError ? err : unavailableError(ctx, err);
      return { ok: false, version, error: { code: e.code, message: e.message } };
    }
    return { ok: true, version };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const models = await this.client.listModels(signal);
    return models.map(m => ({ name: m.name, sizeBytes: m.size, parameterSize: m.parameterSize, family: m.family }));
  }
}
