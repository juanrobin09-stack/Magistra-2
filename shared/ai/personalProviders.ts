// API personnelles dans l'application Windows. Aucune clé ni configuration de compte ici.
// Formats vérifiés dans les documentations officielles des fournisseurs le 10 octobre 2026.
export type PersonalProviderId = 'openai' | 'mistral' | 'gemini' | 'anthropic';

export const PERSONAL_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'gemini', label: 'Gemini (Google)', kind: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', keyUrl: 'https://platform.claude.com/settings/keys' },
] as const;

/** Reconnaissance exacte : un serveur personnalisé ne doit jamais hériter de la clé d'un fournisseur. */
export function personalProviderFor(remote?: { kind: string; baseUrl: string }) {
  if (!remote) return undefined;
  return PERSONAL_PROVIDERS.find(p => p.kind === remote.kind && p.baseUrl === remote.baseUrl.replace(/\/+$/, ''));
}
