// Construction d'un fournisseur d'IA à partir d'une configuration déclarative.

import { MagistraError } from '../errors.js';
import { OllamaProvider, DEFAULT_OLLAMA_URL } from './ollama.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { AIProvider, FetchLike } from './provider.js';

export type ProviderConfig =
  | {
      kind: 'ollama';
      baseUrl?: string;
      model: string;
      label?: string;
      contextTokens?: number;
    }
  | {
      kind: 'openai-compatible';
      baseUrl: string;
      model: string;
      apiKey?: string;
      label?: string;
      contextTokens?: number;
      local?: boolean;
    };

export function createProvider(config: ProviderConfig, fetchImpl?: FetchLike): AIProvider {
  if (!config.model) throw new MagistraError('AI_NOT_CONFIGURED');
  if (config.kind === 'ollama') {
    return new OllamaProvider({
      baseUrl: config.baseUrl || DEFAULT_OLLAMA_URL,
      model: config.model,
      label: config.label,
      contextTokens: config.contextTokens,
      fetch: fetchImpl,
    });
  }
  if (!config.baseUrl) throw new MagistraError('AI_NOT_CONFIGURED');
  return new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    label: config.label,
    contextTokens: config.contextTokens,
    local: config.local,
    fetch: fetchImpl,
  });
}
