// Détection automatique d'une IA installée sur la machine du serveur (serveur autonome et npm run dev, JAMAIS sur
// Vercel) : utilisée quand AI_PRESET, AI_BASE_URL et AI_MODEL sont tous vides et que AI_AUTODETECT ≠ false.
//
//  1. Ollama   http://127.0.0.1:11434 : /api/version, /api/tags (modèles installés), /api/ps (modèles chargés) ;
//  2. LM Studio http://127.0.0.1:1234  : /api/v0/models (type, état, contexte), à défaut /v1/models.
//
// Adresses FIXES, en boucle locale uniquement : aucune adresse fournie par une requête n'est jamais sondée (pas de
// SSRF). Aucun téléchargement de modèle : on conseille seulement « ollama pull ministral-3:8b ».
// Choix du modèle : un niveau Magistra installé (alias compris), de préférence déjà chargé en mémoire et adapté à
// la mémoire vive ; sinon le premier modèle de conversation (les modèles d'embedding et de reranking sont écartés).
// Les modèles « en ligne » d'Ollama (nom « :cloud » / « -cloud », ou remote_host dans /api/tags : voir
// shared/ai/ollamaRemote.ts) ne sont JAMAIS retenus : Ollama relaierait les textes vers Internet alors que
// l'interface annonce une IA locale.
// Fournisseur Ollama NATIF (taille de contexte transmise : num_ctx), avec le contexte du niveau.

import os from 'node:os';
import type { ProviderConfig } from '../shared/ai/factory.js';
import {
  CUSTOM_OLLAMA_MODEL_CONTEXT, installedTiers, MODEL_TIERS, ollamaVersionStatus, MIN_OLLAMA_VERSION, type ModelTier,
} from '../shared/ai/models.js';
import { DEFAULT_OLLAMA_URL, sameModel } from '../shared/ai/ollama.js';
import { isRemoteOllamaModel, remoteHostOf } from '../shared/ai/ollamaRemote.js';
import type { FetchLike } from '../shared/ai/provider.js';

export const LOCAL_OLLAMA_URL = DEFAULT_OLLAMA_URL;
export const LOCAL_LMSTUDIO_URL = 'http://127.0.0.1:1234';
/** Conseil affiché quand rien n'est détecté. */
export const LOCAL_AI_HINT = 'installez Ollama (https://ollama.com) puis « ollama pull ministral-3:8b »';
/**
 * Contexte retenu pour un modèle de LM Studio (prudent : son contexte chargé n'est pas réglable par l'API). Pour Ollama,
 * un modèle hors catalogue reçoit CUSTOM_OLLAMA_MODEL_CONTEXT, comme lorsqu'il est déclaré par AI_MODEL.
 */
export const UNKNOWN_MODEL_CONTEXT = 8_192;

/** Modèles qui ne savent pas converser (embeddings, reranking, audio, vision seule). */
const NON_CHAT_RE = /embed|bge-|\bbge\b|nomic|minilm|e5-|gte-|rerank|whisper|clip|colbert|jina-emb|snowflake-arctic-embed/i;

export type LocalEngine = 'ollama' | 'lmstudio';

export type LocalAIResult =
  | {
      found: true;
      engine: LocalEngine;
      /** Version d'Ollama, si connue. */
      version?: string;
      /** Nom du modèle à passer au serveur (nom réellement installé). */
      model: string;
      /** Niveau Magistra reconnu, s'il y en a un. */
      tier?: ModelTier;
      /** Modèle déjà chargé en mémoire. */
      loaded: boolean;
      contextTokens: number;
      label: string;
      provider: ProviderConfig;
      /** Phrase pour le journal (« IA locale détectée : … »). */
      summary: string;
      /** Avertissements (Ollama trop ancien, contexte de LM Studio à vérifier…). */
      warnings: string[];
    }
  | {
      found: false;
      /** Moteur trouvé sans modèle utilisable, s'il y en a un. */
      engine?: LocalEngine;
      /** Ollama n'a que des modèles « en ligne » (Ollama Cloud, hôte distant) : jamais utilisés automatiquement. */
      onlyRemoteModels?: boolean;
      summary: string;
    };

export interface LocalAIDetectorOptions {
  /** Adresses sondées (tests uniquement ; en service, toujours les adresses fixes ci-dessus). */
  ollamaUrl?: string;
  lmStudioUrl?: string;
  fetch?: FetchLike;
  /** AI_CONTEXT_TOKENS explicite : prioritaire sur le contexte du niveau. */
  contextTokens?: number;
  /** AI_SERVER_LABEL explicite. */
  label?: string;
  // Pas d'AI_API_KEY : la clé n'est jamais transmise à une IA détectée automatiquement (un autre programme, ou un
  // autre compte de la machine, pourrait occuper ces ports). Un Ollama derrière un proxy à clé se déclare explicitement
  // (AI_PROVIDER=ollama, AI_MODEL, et au besoin AI_BASE_URL).
  timeZone?: string;
  /** Mémoire vive totale (Go), pour préférer un niveau adapté. */
  totalRamGB?: number;
  /** Durée de validité d'une détection réussie (30 s) et d'un échec (5 s). */
  ttlMs?: number;
  failTtlMs?: number;
  /** Délai de chaque sonde (ms). */
  probeTimeoutMs?: number;
  now?: () => number;
}

async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

function chatModels(names: readonly string[]): string[] {
  return names.filter(n => n && !NON_CHAT_RE.test(n));
}

/**
 * Niveau Magistra à utiliser parmi ceux installés : celui déjà chargé en mémoire s'il y en a un ; sinon le plus
 * riche qui tient dans la mémoire vive ; sinon le plus léger.
 */
export function pickTier(
  installed: readonly { tier: ModelTier; model: string }[],
  loaded: readonly string[],
  totalRamGB: number,
): { tier: ModelTier; model: string; loaded: boolean } | undefined {
  if (!installed.length) return undefined;
  const inMemory = installed.find(t => loaded.some(l => sameModel(l, t.model)));
  if (inMemory) return { ...inMemory, loaded: true };
  const fitting = [...installed].reverse().find(t => totalRamGB >= t.tier.minRamGB);
  const choice = fitting ?? installed[0];
  return { ...choice, loaded: false };
}

export class LocalAIDetector {
  private readonly ollamaUrl: string;
  private readonly lmStudioUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly options: LocalAIDetectorOptions;
  private readonly now: () => number;
  private cached: { at: number; result: LocalAIResult } | null = null;
  private pending: Promise<LocalAIResult> | null = null;

  constructor(options: LocalAIDetectorOptions = {}) {
    this.options = options;
    this.ollamaUrl = (options.ollamaUrl ?? LOCAL_OLLAMA_URL).replace(/\/+$/, '');
    this.lmStudioUrl = (options.lmStudioUrl ?? LOCAL_LMSTUDIO_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
  }

  /** Oublie la dernière détection (après une panne de génération : l'IA a pu être arrêtée ou changée). */
  invalidate(): void {
    this.cached = null;
  }

  /** Dernier résultat connu, sans nouvelle sonde. */
  get last(): LocalAIResult | null {
    return this.cached?.result ?? null;
  }

  /** Détection, mise en cache 30 s (5 s après un échec). Ne lève jamais. */
  async detect(): Promise<LocalAIResult> {
    const ttl = this.cached?.result.found ? this.options.ttlMs ?? 30_000 : this.options.failTtlMs ?? 5_000;
    if (this.cached && this.now() - this.cached.at < ttl) return this.cached.result;
    this.pending ??= this.probe()
      .catch((): LocalAIResult => ({ found: false, summary: `Aucune IA locale détectée : ${LOCAL_AI_HINT}.` }))
      .then(result => {
        this.cached = { at: this.now(), result };
        return result;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private get probeTimeoutMs(): number {
    return this.options.probeTimeoutMs ?? 2_500;
  }

  private async probe(): Promise<LocalAIResult> {
    const ollama = await this.probeOllama();
    if (ollama?.found) return ollama;
    const lmStudio = await this.probeLmStudio();
    if (lmStudio?.found) return lmStudio;
    return ollama ?? lmStudio ?? {
      found: false,
      summary: `Aucune IA locale détectée (ni Ollama sur ${this.ollamaUrl}, ni LM Studio sur ${this.lmStudioUrl}) : ${LOCAL_AI_HINT}.`,
    };
  }

  private async probeOllama(): Promise<LocalAIResult | null> {
    const t = this.probeTimeoutMs;
    const version = (await getJson(this.fetchImpl, `${this.ollamaUrl}/api/version`, t)) as { version?: unknown } | null;
    if (!version || typeof version !== 'object' || typeof version.version !== 'string') return null;
    const v = version.version;
    const [tags, ps] = await Promise.all([
      getJson(this.fetchImpl, `${this.ollamaUrl}/api/tags`, t * 2) as Promise<{ models?: { name?: unknown; model?: unknown }[] } | null>,
      getJson(this.fetchImpl, `${this.ollamaUrl}/api/ps`, t) as Promise<{ models?: { name?: unknown; model?: unknown }[] } | null>,
    ]);
    const entries = (Array.isArray(tags?.models) ? tags.models : [])
      .map(m => ({ name: typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : '', remoteHost: remoteHostOf(m) }))
      .filter(m => m.name);
    // Modèles exécutés par CET Ollama seulement (avant la recherche des niveaux : un alias peut copier un modèle cloud).
    const names = entries.filter(m => !isRemoteOllamaModel(m.name, m.remoteHost)).map(m => m.name);
    const remoteOnly = entries.length > 0 && names.length === 0;
    const loaded = (Array.isArray(ps?.models) ? ps.models : [])
      .map(m => (typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : ''))
      .filter(Boolean);
    const warnings: string[] = [];
    if (ollamaVersionStatus(v) === 'outdated') {
      warnings.push(`Ollama ${v} est trop ancien pour les modèles Magistra (version ${MIN_OLLAMA_VERSION} au moins) : mettez-le à jour.`);
    }
    const ram = this.options.totalRamGB ?? os.totalmem() / 1024 ** 3;
    const tierPick = pickTier(installedTiers(names), loaded, ram);
    let model: string | undefined;
    let tier: ModelTier | undefined;
    let isLoaded: boolean;
    if (tierPick) {
      ({ model, tier } = tierPick);
      isLoaded = tierPick.loaded;
    } else {
      const chat = chatModels(names);
      model = chat.find(n => loaded.some(l => sameModel(l, n))) ?? chat[0];
      isLoaded = Boolean(model && loaded.some(l => sameModel(l, model!)));
    }
    if (!model) {
      if (remoteOnly) {
        return {
          found: false,
          engine: 'ollama',
          onlyRemoteModels: true,
          summary: `Ollama ${v} détecté sur ${this.ollamaUrl}, mais seuls des modèles en ligne (Ollama Cloud) sont installés : Magistra ne les `
            + "utilise pas automatiquement, car les textes partiraient sur Internet. Installez un modèle local : « ollama pull ministral-3:8b ».",
        };
      }
      return {
        found: false,
        engine: 'ollama',
        summary: `Ollama ${v} détecté sur ${this.ollamaUrl}, mais aucun modèle de conversation n'est installé : exécutez « ollama pull ministral-3:8b ».`,
      };
    }
    const contextTokens = this.options.contextTokens ?? tier?.contextTokens ?? CUSTOM_OLLAMA_MODEL_CONTEXT;
    const modelName = tier?.label ?? model;
    const label = this.options.label ?? `IA locale (Ollama – ${modelName})`;
    const provider: ProviderConfig = {
      kind: 'ollama',
      baseUrl: this.ollamaUrl,
      model,
      label,
      serverLabel: this.options.label ?? 'IA locale (Ollama)',
      ...(tier ? { modelLabel: tier.label } : {}),
      contextTokens,
      recipient: 'administrateur',
      ...(this.options.timeZone ? { timeZone: this.options.timeZone } : {}),
    };
    const tierText = tier ? ` (${tier.label})` : ' (modèle hors catalogue Magistra)';
    return {
      found: true,
      engine: 'ollama',
      version: v,
      model,
      ...(tier ? { tier } : {}),
      loaded: isLoaded,
      contextTokens,
      label,
      provider,
      summary: `IA locale détectée : Ollama ${v} sur ${this.ollamaUrl}, modèle « ${model} »${tierText}${isLoaded ? ', déjà chargé' : ''}, contexte ${contextTokens} tokens.`,
      warnings,
    };
  }

  private async probeLmStudio(): Promise<LocalAIResult | null> {
    const t = this.probeTimeoutMs;
    type V0Model = { id?: unknown; type?: unknown; state?: unknown; max_context_length?: unknown; loaded_context_length?: unknown };
    const v0 = (await getJson(this.fetchImpl, `${this.lmStudioUrl}/api/v0/models`, t)) as { data?: V0Model[] } | null;
    let candidates: { id: string; loaded: boolean; context?: number }[] = [];
    let answered = false;
    if (v0 && Array.isArray(v0.data)) {
      answered = true;
      candidates = v0.data
        .filter(m => typeof m?.id === 'string' && (m.type === undefined || m.type === 'llm' || m.type === 'vlm'))
        .map(m => {
          const loadedCtx = typeof m.loaded_context_length === 'number' ? m.loaded_context_length : undefined;
          const maxCtx = typeof m.max_context_length === 'number' ? m.max_context_length : undefined;
          return { id: m.id as string, loaded: m.state === 'loaded', context: loadedCtx ?? maxCtx };
        })
        .filter(m => !NON_CHAT_RE.test(m.id));
    } else {
      const v1 = (await getJson(this.fetchImpl, `${this.lmStudioUrl}/v1/models`, t)) as { data?: { id?: unknown }[] } | null;
      if (v1 && Array.isArray(v1.data)) {
        answered = true;
        candidates = chatModels(v1.data.map(m => (typeof m?.id === 'string' ? m.id : ''))).map(id => ({ id, loaded: false }));
      }
    }
    if (!answered) return null;
    const pick = candidates.find(c => c.loaded) ?? candidates[0];
    if (!pick) {
      return {
        found: false,
        engine: 'lmstudio',
        summary: `LM Studio détecté sur ${this.lmStudioUrl}, mais aucun modèle de conversation n'est disponible : téléchargez-en un dans LM Studio.`,
      };
    }
    const tier = MODEL_TIERS.find(tr => sameModel(tr.model, pick.id));
    // Le contexte réellement chargé par LM Studio n'est pas réglable par l'API compatible OpenAI : valeur prudente.
    const contextTokens = this.options.contextTokens ?? Math.min(pick.context ?? UNKNOWN_MODEL_CONTEXT, UNKNOWN_MODEL_CONTEXT);
    const label = this.options.label ?? `IA locale (LM Studio – ${tier?.label ?? pick.id})`;
    const provider: ProviderConfig = {
      kind: 'openai-compatible',
      baseUrl: `${this.lmStudioUrl}/v1`,
      model: pick.id,
      label,
      contextTokens,
      local: true,
      recipient: 'administrateur',
      ...(this.options.timeZone ? { timeZone: this.options.timeZone } : {}),
    };
    return {
      found: true,
      engine: 'lmstudio',
      model: pick.id,
      ...(tier ? { tier } : {}),
      loaded: pick.loaded,
      contextTokens,
      label,
      provider,
      summary: `IA locale détectée : LM Studio sur ${this.lmStudioUrl}, modèle « ${pick.id} »${pick.loaded ? ', déjà chargé' : ''}, contexte ${contextTokens} tokens.`,
      warnings: [`Vérifiez dans LM Studio que la longueur de contexte chargée atteint au moins ${contextTokens} tokens (sinon les documents seraient tronqués).`],
    };
  }
}
