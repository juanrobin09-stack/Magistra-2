// Construction d'un fournisseur d'IA à partir d'une configuration déclarative.

import { MagistraError } from '../errors.js';
import type { ErrorRecipient } from './errorMapping.js';
import { OllamaProvider, DEFAULT_OLLAMA_URL } from './ollama.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { AIProvider, FetchLike } from './provider.js';

export type ProviderConfig =
  | {
      kind: 'ollama';
      baseUrl?: string;
      model: string;
      /** Libellé affiché (voir OllamaProviderConfig.label : niveau Magistra → nom du modèle, sinon nom du serveur). */
      label?: string;
      /** Nom lisible du modèle dans les messages (défaut : niveau du catalogue, sinon le nom technique). */
      modelLabel?: string;
      /** Nom du serveur dans les messages (défaut : « Le moteur IA local » sur ce poste, « Serveur d'IA » sinon). */
      serverLabel?: string;
      /** AI_API_KEY : « Authorization: Bearer » sur /api/version, /api/tags, /api/chat, /api/pull (proxy à clé). */
      apiKey?: string;
      /** Destinataire des conseils d'erreur : 'administrateur' pour le site web, 'poste' (défaut) pour Windows. */
      recipient?: ErrorRecipient;
      contextTokens?: number;
      keepAlive?: string;
      /** Fuseau horaire des messages de quota (défaut Europe/Paris). */
      timeZone?: string;
    }
  | {
      kind: 'openai-compatible';
      baseUrl: string;
      model: string;
      apiKey?: string;
      label?: string;
      contextTokens?: number;
      local?: boolean;
      /** Destinataire des conseils d'erreur : 'administrateur' pour le site web, 'poste' (défaut) pour Windows. */
      recipient?: ErrorRecipient;
      /** Fuseau horaire des messages de quota (défaut Europe/Paris). */
      timeZone?: string;
    };

export function createProvider(config: ProviderConfig, fetchImpl?: FetchLike): AIProvider {
  if (!config.model) throw new MagistraError('AI_NOT_CONFIGURED');
  if (config.kind === 'ollama') {
    return new OllamaProvider({
      baseUrl: config.baseUrl || DEFAULT_OLLAMA_URL,
      model: config.model,
      label: config.label,
      modelLabel: config.modelLabel,
      serverLabel: config.serverLabel,
      apiKey: config.apiKey,
      recipient: config.recipient,
      contextTokens: config.contextTokens,
      keepAlive: config.keepAlive,
      timeZone: config.timeZone,
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
    recipient: config.recipient,
    timeZone: config.timeZone,
    fetch: fetchImpl,
  });
}
