// Mesures de vitesse du moteur local : durées du dernier objet NDJSON d'Ollama (/api/chat) et placement du modèle
// (/api/ps). Fonctions pures, sans réseau : une valeur absente, négative, non numérique ou absurde est ignorée,
// jamais remplacée par une valeur inventée. Uniquement des nombres et des énumérations : aucun texte de l'utilisateur.

import { normalizeModelName } from './models.js';

/** Durées du moteur pour une requête, en millisecondes (jetons par seconde calculés à partir des durées exactes). */
export interface EngineTimings {
  /** Durée totale de la requête côté moteur. */
  totalMs?: number;
  /** Chargement du modèle en mémoire pendant cette requête (0 : déjà chargé). */
  loadMs?: number;
  /** Lecture de la demande : jetons de la demande (prompt_eval_count), durée et vitesse de lecture. */
  promptTokens?: number;
  /** Parmi eux, jetons déjà en mémoire d'une requête précédente (prompt_eval_cached_count) : non relus, hors de la vitesse. */
  promptCachedTokens?: number;
  promptMs?: number;
  promptTokensPerSecond?: number;
  /** Rédaction : jetons produits, durée et vitesse. */
  outputTokens?: number;
  outputMs?: number;
  tokensPerSecond?: number;
}

export type EngineProcessor = 'gpu' | 'cpu' | 'mixed';

/** Où le modèle chargé s'exécute, d'après la mémoire qu'il occupe (carte graphique ou mémoire de l'ordinateur). */
export interface EnginePlacement {
  processor: EngineProcessor;
  /** Part du modèle en mémoire de carte graphique, en pourcentage entier (0 à 100). */
  gpuPercent: number;
  sizeBytes: number;
  sizeVramBytes: number;
  /** Taille de contexte réellement chargée (context_length d'Ollama), si elle est connue. */
  contextTokens?: number;
}

/** Au-delà, une durée n'est pas une mesure (champ corrompu ou unité inattendue). */
export const MAX_ENGINE_DURATION_MS = 24 * 3_600_000;
const MAX_DURATION_NS = MAX_ENGINE_DURATION_MS * 1_000_000;
const MAX_TOKENS = 100_000_000;
const MAX_TOKENS_PER_SECOND = 1_000_000;
const MAX_BYTES = 2 ** 50;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Durée en nanosecondes (Ollama) : nombre fini, positif ou nul, d'au plus 24 h ; sinon undefined. */
function nanoseconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_NS ? value : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TOKENS ? Math.round(value) : undefined;
}

function nanosToMs(ns: number | undefined): number | undefined {
  return ns === undefined ? undefined : Math.round(ns / 1_000_000);
}

/** Jetons par seconde (un chiffre après la virgule) ; undefined si la durée est nulle ou si rien n'a été compté. */
function perSecond(tokens: number | undefined, ns: number | undefined): number | undefined {
  if (tokens === undefined || tokens <= 0 || ns === undefined || ns <= 0) return undefined;
  const rate = tokens / (ns / 1_000_000_000);
  return Number.isFinite(rate) && rate <= MAX_TOKENS_PER_SECOND ? Math.round(rate * 10) / 10 : undefined;
}

/**
 * Durées du dernier objet NDJSON d'Ollama (« done: true » de /api/chat) : total_duration, load_duration,
 * prompt_eval_count / prompt_eval_duration, eval_count / eval_duration — durées en NANOSECONDES, rendues en
 * millisecondes arrondies. undefined si aucune durée exploitable : les seuls nombres de jetons sont déjà dans `usage`.
 * prompt_eval_count compte aussi les jetons déjà en mémoire d'une requête précédente (prompt_eval_cached_count) : la
 * vitesse de lecture ne porte que sur les jetons réellement lus, sinon elle serait gonflée.
 */
export function ollamaTimingsFromChunk(chunk: unknown): EngineTimings | undefined {
  const c = record(chunk);
  if (!c) return undefined;
  const total = nanoseconds(c.total_duration);
  const load = nanoseconds(c.load_duration);
  const promptNs = nanoseconds(c.prompt_eval_duration);
  const outputNs = nanoseconds(c.eval_duration);
  if (total === undefined && load === undefined && promptNs === undefined && outputNs === undefined) return undefined;
  const promptTokens = tokenCount(c.prompt_eval_count);
  const reported = tokenCount(c.prompt_eval_cached_count);
  const cached = promptTokens !== undefined && reported !== undefined && reported > 0 && reported <= promptTokens ? reported : undefined;
  const outputTokens = tokenCount(c.eval_count);
  const out: EngineTimings = {};
  const set = <K extends keyof EngineTimings>(key: K, value: EngineTimings[K]) => {
    if (value !== undefined) out[key] = value;
  };
  set('totalMs', nanosToMs(total));
  set('loadMs', nanosToMs(load));
  set('promptTokens', promptTokens);
  set('promptCachedTokens', cached);
  set('promptMs', nanosToMs(promptNs));
  set('promptTokensPerSecond', perSecond(promptTokens === undefined ? undefined : promptTokens - (cached ?? 0), promptNs));
  set('outputTokens', outputTokens);
  set('outputMs', nanosToMs(outputNs));
  set('tokensPerSecond', perSecond(outputTokens, outputNs));
  return out;
}

function milliseconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ENGINE_DURATION_MS ? Math.round(value) : undefined;
}

function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TOKENS_PER_SECOND ? Math.round(value * 10) / 10 : undefined;
}

/**
 * Durées déjà exprimées en millisecondes (EngineTimings reçues d'un fournisseur ou d'une autre application) : ne
 * garde que les champs connus, numériques et plausibles. Rien d'autre ne traverse (jamais de texte).
 */
export function cleanEngineTimings(value: unknown): EngineTimings | undefined {
  const v = record(value);
  if (!v) return undefined;
  const out: EngineTimings = {};
  const set = <K extends keyof EngineTimings>(key: K, next: EngineTimings[K]) => {
    if (next !== undefined) out[key] = next;
  };
  set('totalMs', milliseconds(v.totalMs));
  set('loadMs', milliseconds(v.loadMs));
  set('promptTokens', tokenCount(v.promptTokens));
  set('promptCachedTokens', tokenCount(v.promptCachedTokens));
  set('promptMs', milliseconds(v.promptMs));
  set('promptTokensPerSecond', rate(v.promptTokensPerSecond));
  set('outputTokens', tokenCount(v.outputTokens));
  set('outputMs', milliseconds(v.outputMs));
  set('tokensPerSecond', rate(v.tokensPerSecond));
  return Object.keys(out).length > 0 ? out : undefined;
}

function bytes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_BYTES ? Math.round(value) : undefined;
}

function placementOf(sizeBytes: number, sizeVramBytes: number, contextTokens: number | undefined): EnginePlacement {
  const share = Math.min(1, sizeVramBytes / sizeBytes);
  const processor: EngineProcessor = sizeVramBytes >= sizeBytes ? 'gpu' : sizeVramBytes <= 0 ? 'cpu' : 'mixed';
  // Un partage reste « partagé » à l'affichage : jamais 0 % ni 100 % pour un modèle en partie seulement sur la carte.
  const gpuPercent = processor === 'gpu' ? 100 : processor === 'cpu' ? 0 : Math.min(99, Math.max(1, Math.round(share * 100)));
  return { processor, gpuPercent, sizeBytes, sizeVramBytes, ...(contextTokens !== undefined ? { contextTokens } : {}) };
}

/**
 * Placement du modèle d'après la réponse de GET /api/ps (models[] : name / model, size, size_vram, context_length) :
 * l'entrée du modèle demandé (même nom, « :latest » implicite) donne « gpu » (tout en mémoire de carte graphique),
 * « cpu » (rien en mémoire de carte graphique, ou champ absent) ou « mixed ». undefined si le modèle n'est pas listé
 * ou si les tailles sont inexploitables.
 * Limite du moteur : sur les processeurs à instructions AMX (Xeon récents), Ollama compte les poids réorganisés pour
 * ces instructions dans size_vram ; un calcul entièrement sur processeur y apparaît alors « mixed ». Ces processeurs sont
 * absents des ordinateurs d'enseignants courants ; l'affichage reste donc prudent (« d'après le moteur »).
 */
export function placementFromPs(psBody: unknown, model: string): EnginePlacement | undefined {
  const body = record(psBody);
  if (!body || !Array.isArray(body.models) || typeof model !== 'string' || !model.trim()) return undefined;
  const wanted = normalizeModelName(model);
  for (const raw of body.models) {
    const entry = record(raw);
    if (!entry) continue;
    const names = [entry.name, entry.model].filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    if (!names.some(n => normalizeModelName(n) === wanted)) continue;
    const sizeBytes = bytes(entry.size);
    if (sizeBytes === undefined || sizeBytes <= 0) return undefined;
    const vram = entry.size_vram === undefined || entry.size_vram === null ? 0 : bytes(entry.size_vram);
    if (vram === undefined) return undefined;
    return placementOf(sizeBytes, vram, tokenCount(entry.context_length) || undefined);
  }
  return undefined;
}

const PROCESSORS: readonly EngineProcessor[] = ['gpu', 'cpu', 'mixed'];

/** Placement déjà calculé (fournisseur, autre application) : champs connus et cohérents, sinon undefined. */
export function cleanEnginePlacement(value: unknown): EnginePlacement | undefined {
  const v = record(value);
  if (!v || typeof v.processor !== 'string' || !PROCESSORS.includes(v.processor as EngineProcessor)) return undefined;
  const sizeBytes = bytes(v.sizeBytes);
  const sizeVramBytes = bytes(v.sizeVramBytes);
  if (sizeBytes === undefined || sizeBytes <= 0 || sizeVramBytes === undefined) return undefined;
  const placement = placementOf(sizeBytes, sizeVramBytes, tokenCount(v.contextTokens) || undefined);
  return placement.processor === v.processor ? placement : undefined;
}
