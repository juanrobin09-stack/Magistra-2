// Modèles Ollama qui ne tournent PAS sur la machine d'Ollama : les textes partent ailleurs.
//
// Ollama (0.12 et suivants, vérifié avec la 0.34.4) relaie certaines conversations vers un autre serveur :
//  - les modèles « cloud » (nom terminé par « :cloud » ou « -cloud », par exemple « gpt-oss:120b-cloud »,
//    « kimi-k2.6:cloud ») : /api/chat est transmis à ollama.com (Ollama Cloud), même sans « ollama signin » (le texte
//    part avant le contrôle d'identité). Un tel nom est relayé même s'il n'apparaît pas dans /api/tags ;
//  - les modèles installés avec un hôte distant (champ « remote_host » de /api/tags, OLLAMA_REMOTES) : transmis à
//    cet hôte.
// Pour un nom « cloud », /api/show est lui-même relayé et ne renvoie pas remote_host : seul le NOM permet de le
// reconnaître. Pour un modèle à hôte distant, /api/tags (réponse locale, jamais relayée) donne remote_host.
// Toute décision se prend donc SANS contacter le nuage : nom du modèle, puis entrée de /api/tags.
//
// Usage : la détection automatique ne retient jamais un tel modèle (serveur), l'application Windows les refuse, et
// une configuration explicite est annoncée honnêtement (« Ollama Cloud », prestataire tiers).

import type { ProviderInfo } from '../types.js';
import { providerInfoFor } from './presets.js';
import type { FetchLike } from './provider.js';

/** Adresse du service Ollama Cloud (hôte connu : « Ollama Cloud », prestataire tiers). */
export const OLLAMA_CLOUD_URL = 'https://ollama.com';

/**
 * Vrai si Ollama relaie ce nom vers Ollama Cloud : même règle que parseSourceSuffix d'Ollama (dernière partie après
 * « : », en minuscules et sans espaces, égale à « cloud » ou terminée par « -cloud », sans « / »).
 */
export function isOllamaCloudName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  const i = n.lastIndexOf(':');
  if (i < 0) return false;
  const suffix = n.slice(i + 1).trim().toLowerCase();
  if (!suffix || suffix.includes('/')) return false;
  return suffix === 'cloud' || suffix.endsWith('-cloud');
}

/** Hôte distant d'une entrée de /api/tags (« remote_host » non vide), sinon undefined. */
export function remoteHostOf(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const host = (entry as { remote_host?: unknown }).remote_host;
  return typeof host === 'string' && host.trim() ? host.trim() : undefined;
}

/** Vrai si ce modèle n'est pas exécuté par l'Ollama interrogé (nom « cloud » ou hôte distant). */
export function isRemoteOllamaModel(name: string | null | undefined, remoteHost?: string): boolean {
  return Boolean(remoteHost) || isOllamaCloudName(name);
}

/** Adresse utilisable par providerInfoFor (« ollama.com:443 » → « https://ollama.com:443 »). */
function asUrl(host: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`;
}

/**
 * Prestataire qui reçoit réellement les textes d'un modèle Ollama relayé : l'hôte distant s'il est connu (un
 * OLLAMA_REMOTES d'établissement en réseau privé reste décrit comme « réseau local »), sinon Ollama Cloud pour un nom
 * « cloud ». undefined pour un modèle exécuté par l'Ollama interrogé.
 */
export function ollamaDestination(name: string | null | undefined, remoteHost?: string, adminLabel?: string): ProviderInfo | undefined {
  if (remoteHost) return providerInfoFor(asUrl(remoteHost), adminLabel);
  if (isOllamaCloudName(name)) return providerInfoFor(OLLAMA_CLOUD_URL, adminLabel);
  return undefined;
}

/** Message commun : modèle en ligne refusé là où seuls les modèles de la machine sont acceptés. */
export const REMOTE_MODEL_REFUSED =
  'Ce modèle fonctionne sur Internet (Ollama Cloud ou autre serveur) et non sur cet ordinateur : les textes partiraient '
  + 'en ligne. Magistra n’utilise ici que des modèles installés sur cet ordinateur (par exemple « ollama pull ministral-3:8b »).';

/**
 * Hôte distant du modèle `model` d'après /api/tags de l'Ollama `baseUrl` (réponse locale, jamais relayée) :
 * chaîne = modèle relayé vers cet hôte ; '' = modèle exécuté par cet Ollama (ou absent de la liste) ;
 * null = liste illisible (Ollama injoignable…). Aucune clé n'est jamais incluse dans le résultat.
 */
export async function fetchOllamaRemoteHost(
  fetchImpl: FetchLike,
  baseUrl: string,
  model: string,
  options: { apiKey?: string; timeoutMs?: number; sameModel?: (a: string, b: string) => boolean } = {},
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
      headers: { Accept: 'application/json', ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const data = (await res.json()) as { models?: unknown };
    const list = Array.isArray(data?.models) ? data.models : [];
    const same = options.sameModel ?? ((a: string, b: string) => a === b);
    const entry = list.find(m => {
      const n = (m as { name?: unknown; model?: unknown })?.name ?? (m as { model?: unknown })?.model;
      return typeof n === 'string' && same(n, model);
    });
    return remoteHostOf(entry) ?? '';
  } catch {
    return null;
  }
}
