// Abstraction unique des moteurs d'IA.
// Le reste de Magistra ne sait jamais s'il parle à Ollama, vLLM ou un autre serveur compatible OpenAI.

import type { ErrorCode } from '../errors.js';

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
  sizeBytes?: number;
  parameterSize?: string;
  family?: string;
}

export interface HealthStatus {
  ok: boolean;
  version?: string;
  error?: { code: ErrorCode; message: string };
}

export type ProviderKind = 'ollama' | 'openai-compatible' | 'mock';

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
  health(signal?: AbortSignal): Promise<HealthStatus>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
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
