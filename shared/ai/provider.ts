// Abstraction unique des moteurs d'IA.
// Le reste de Magistra ne sait jamais s'il parle à Ollama, vLLM ou un autre serveur compatible OpenAI.

import type { ErrorCode } from '../errors.js';
import type { EnginePlacement, EngineTimings } from './timings.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** Nombre maximal de tokens produits. */
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export type FinishReason = 'stop' | 'length' | 'unknown';

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  /** Durées mesurées par le moteur (Ollama : dernier objet du flux), pour la fenêtre « Détails de vitesse ». */
  timings?: EngineTimings;
  /** Délai mesuré côté client entre l'envoi de la requête et le premier mot reçu. */
  timeToFirstDeltaMs?: number;
  /** Où le modèle s'exécute (carte graphique, processeur), relevé une fois pendant la génération (moteur local). */
  placement?: EnginePlacement;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'end'; finishReason: FinishReason; usage?: Usage };

export interface GenerateResult {
  text: string;
  finishReason: FinishReason;
  usage?: Usage;
  model: string;
}

export interface ModelInfo {
  name: string;
  /** Autres noms acceptés par le serveur pour ce modèle (champ « aliases » d'Albert/OpenGateLLM, de Mistral…). */
  aliases?: string[];
  sizeBytes?: number;
  parameterSize?: string;
  family?: string;
}

/**
 * État d'un fournisseur (test de santé, jamais de génération).
 *  - ok vrai sans `warning` : prêt ;
 *  - ok vrai avec `warning` : génération possible, mais avertissement NON bloquant à afficher :
 *      AI_STATUS_UNKNOWN (état non vérifié : liste des modèles absente, vide, ou délai dépassé),
 *      MODEL_NOT_INSTALLED (modèle absent de la liste, alias possible), AI_BUSY (surcharge passagère) ;
 *  - ok faux : `error` donne la cause bloquante (clé refusée, adresse injoignable, modèle non installé…).
 * Un test de santé ne renvoie JAMAIS GENERATION_ABORTED.
 */
export interface HealthStatus {
  ok: boolean;
  version?: string;
  error?: { code: ErrorCode; message: string };
  warning?: { code: ErrorCode; message: string };
}

/** Ce que le moteur annonce à la fin d'un préchargement : durée de chargement du modèle, en millisecondes. */
export interface PreloadResult {
  loadMs?: number;
}

export interface PreloadOptions {
  signal?: AbortSignal;
  /** Délai maximal du chargement (défaut propre au fournisseur, 10 min pour Ollama). */
  timeoutMs?: number;
}

export type ProviderKind = 'ollama' | 'openai-compatible' | 'anthropic' | 'mock';

export interface AIProvider {
  readonly kind: ProviderKind;
  /** Nom technique du modèle (ex. « ministral-3:14b »). */
  readonly model: string;
  /** Libellé lisible (ex. « Magistra Standard » ou « Serveur universitaire »). */
  readonly label: string;
  /** Vrai si le moteur tourne sur cette machine (aucune donnée ne sort). */
  readonly local: boolean;
  /** Taille de contexte (tokens) que Magistra doit respecter. */
  readonly contextTokens: number;
  stream(options: ChatOptions): AsyncIterable<StreamEvent>;
  generate(options: ChatOptions): Promise<GenerateResult>;
  /** Test de santé : ne lève jamais, respecte `signal` (un délai dépassé donne « état non vérifié »). */
  health(signal?: AbortSignal): Promise<HealthStatus>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  /**
   * Facultatif : charge le modèle en mémoire sans rien générer (moteur Ollama), pour que le délai d'attente du
   * premier mot ne compte plus le chargement. Lève une MagistraError (MODEL_NOT_INSTALLED, OUT_OF_MEMORY…).
   * La pipeline l'appelle si PipelineDeps.preloadModel est vrai, avec le statut « Chargement du modèle… ».
   */
  preload?(options?: PreloadOptions): Promise<PreloadResult | void>;
}

/** Implémentation générique de generate() à partir de stream(). */
export async function collectStream(provider: AIProvider, options: ChatOptions): Promise<GenerateResult> {
  let text = '';
  let finishReason: FinishReason = 'unknown';
  let usage: Usage | undefined;
  for await (const event of provider.stream(options)) {
    if (event.type === 'delta') text += event.text;
    else {
      finishReason = event.finishReason;
      usage = event.usage;
    }
  }
  return { text, finishReason, usage, model: provider.model };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
