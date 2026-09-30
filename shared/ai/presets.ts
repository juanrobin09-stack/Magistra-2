// Préréglages de fournisseurs d'IA pour le site web, et description honnête du prestataire qui reçoit
// les textes des enseignants. Lu par le serveur (configuration, /api/status), l'interface (affichage) et la
// documentation.
//
// Règles :
//  - aucun fournisseur payant n'est obligatoire : chaque préréglage indique s'il faut une clé et ce qui est gratuit ;
//  - les faits de confidentialité (pays, conservation, entraînement) sont ceux que le prestataire ANNONCE ;
//    quand ils ne sont pas connus, le texte renvoie à ses conditions au lieu d'inventer ;
//  - rien ici n'est secret, mais l'URL de base n'est jamais transmise au navigateur : seul ProviderInfo l'est
//    (voir providerInfoFor), sans URL ni clé.

import type { ProviderInfo } from '../types.js';

export type PresetId = 'ovhcloud' | 'mistral' | 'albert' | 'scaleway' | 'ollama';

/** Ce que le prestataire fait des textes envoyés, tel qu'il l'annonce. */
export interface ProviderPrivacy {
  /** Vrai si les textes partent chez un tiers (service en ligne) ; faux pour une IA locale ou du réseau local. */
  thirdParty: boolean;
  /** Pays ou lieu d'hébergement. */
  country: string;
  /** Conservation des données. */
  retention: string;
  /** Utilisation pour l'entraînement de modèles. */
  training: string;
  /** Page publique du prestataire (conditions, confidentialité, documentation). */
  url?: string;
}

export interface ProviderPreset {
  id: PresetId;
  /** Nom du prestataire, affiché à l'enseignant. */
  label: string;
  /** Valeur de AI_BASE_URL (avec /v1 pour les API compatibles OpenAI, sans /v1 pour Ollama natif). */
  baseUrl: string;
  /** Valeur de AI_MODEL recommandée. */
  model: string;
  /** Modèles de repli possibles chez le même prestataire (à essayer si `model` n'est plus proposé). */
  fallbackModels?: string[];
  /** AI_API_KEY : 'none' (inutile), 'optional' (facultative, plus de débit), 'required' (obligatoire). */
  apiKey: 'none' | 'optional' | 'required';
  /** AI_CONTEXT_TOKENS conseillé côté Magistra (peut être inférieur au maximum du modèle). */
  contextTokens: number;
  /** AI_MAX_OUTPUT_TOKENS conseillé (plafond de sortie du prestataire). */
  maxOutputTokens: number;
  /** AI_PROVIDER : API compatible OpenAI (/v1/chat/completions) ou API native d'Ollama (/api/chat, num_ctx). */
  provider: 'openai-compatible' | 'ollama';
  privacy: ProviderPrivacy;
  /** Conditions d'accès (gratuité, compte, limites), en français, pour l'administrateur. */
  notes: string;
  /**
   * Noms d'hôte reconnus comme ce prestataire (comparaison exacte, ou suffixe quand l'entrée commence par « . »).
   * Sert à describeAIEndpoint quand AI_BASE_URL est saisie à la main.
   */
  hosts: string[];
}

/**
 * Catalogue des préréglages. Le premier est la « solution gratuite la plus simple » pour un site en ligne :
 * OVHcloud AI Endpoints en accès anonyme (sans compte ni clé), hébergé en France.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'ovhcloud',
    label: 'OVHcloud AI Endpoints',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    model: 'Mistral-Small-3.2-24B-Instruct-2506',
    fallbackModels: ['Mistral-Nemo-Instruct-2407'],
    apiKey: 'optional',
    // Le modèle accepte 131k tokens ; 32 768 suffisent à Magistra et limitent le temps de lecture.
    contextTokens: 32_768,
    // La sortie est plafonnée à environ 4 000 tokens chez OVHcloud.
    maxOutputTokens: 4_000,
    provider: 'openai-compatible',
    privacy: {
      thirdParty: true,
      country: 'France (centre de données de Gravelines)',
      retention: 'Aucune conservation des données (annoncé par OVHcloud)',
      training: "Aucune utilisation des textes pour l'entraînement (annoncé par OVHcloud)",
      url: 'https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities',
    },
    notes:
      "Gratuit sans compte ni clé : accès anonyme limité à 2 requêtes par minute par adresse IP et par modèle. "
      + "Une clé (projet Public Cloud, paiement à l'usage de quelques centimes) relève la limite à 400 requêtes par minute : "
      + "conseillée dès que plusieurs enseignants utilisent le site, car l'adresse IP de sortie d'un hébergeur peut être partagée.",
    hosts: ['oai.endpoints.kepler.ai.cloud.ovh.net', '.endpoints.kepler.ai.cloud.ovh.net'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI (La Plateforme)',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'ministral-14b-2512',
    fallbackModels: ['ministral-8b-2512'],
    apiKey: 'required',
    contextTokens: 32_768,
    maxOutputTokens: 6_000,
    provider: 'openai-compatible',
    privacy: {
      thirdParty: true,
      country: 'Union européenne (Mistral AI, France)',
      retention: 'Selon les conditions de Mistral AI',
      training:
        "Offre gratuite (Experiment) : les demandes et les réponses peuvent servir à entraîner les modèles de Mistral AI, "
        + "sauf si l'administrateur le refuse dans l'Admin Console (rubrique Privacy)",
      url: 'https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training',
    },
    notes:
      "Clé obligatoire. Offre Experiment gratuite (numéro de téléphone vérifié, sans carte bancaire, débit limité). "
      + "Avant d'y envoyer des textes d'élèves, refuser l'utilisation pour l'entraînement dans l'Admin Console de Mistral.",
    hosts: ['api.mistral.ai'],
  },
  {
    id: 'albert',
    label: "Albert API (IA de l'État, DINUM)",
    baseUrl: 'https://albert.api.etalab.gouv.fr/v1',
    model: 'openweight-medium',
    fallbackModels: ['openweight-small'],
    apiKey: 'required',
    contextTokens: 32_768,
    maxOutputTokens: 6_000,
    provider: 'openai-compatible',
    privacy: {
      thirdParty: true,
      country: 'France (hébergement qualifié SecNumCloud)',
      retention: "Selon les conditions d'utilisation d'Albert API",
      training: "Selon les conditions d'utilisation d'Albert API",
      url: 'https://guides.ia.numerique.gouv.fr/albert-api',
    },
    notes:
      "Réservé aux agents de la fonction publique d'État (enseignants inclus), sur demande (formulaire ou ProConnect). "
      + "Gratuit en expérimentation, clé valable deux mois (prolongeable), quotas par minute et par jour. "
      + "Les noms « openweight-… » sont des alias qui peuvent changer de modèle cible.",
    hosts: ['albert.api.etalab.gouv.fr'],
  },
  {
    id: 'scaleway',
    label: 'Scaleway Generative APIs',
    baseUrl: 'https://api.scaleway.ai/v1',
    model: 'mistral-small-3.2-24b-instruct-2506',
    apiKey: 'required',
    contextTokens: 32_768,
    maxOutputTokens: 6_000,
    provider: 'openai-compatible',
    privacy: {
      thirdParty: true,
      country: 'France',
      retention: 'Contenus ni collectés ni réutilisés (annoncé par Scaleway)',
      training: "Aucune utilisation des textes pour l'entraînement (annoncé par Scaleway)",
      url: 'https://www.scaleway.com/en/news/scaleway-launches-generative-apis-a-drop-in-alternative-to-openai-apis-100percent-made-in-europe/',
    },
    notes:
      "Clé secrète IAM obligatoire. 1 000 000 de tokens offerts à chaque nouveau client, puis paiement à l'usage "
      + '(un moyen de paiement enregistré est demandé).',
    hosts: ['api.scaleway.ai'],
  },
  {
    id: 'ollama',
    label: 'Ollama (auto-hébergé)',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'ministral-3:14b',
    fallbackModels: ['ministral-3:8b'],
    // Ollama n'a pas d'authentification : une clé n'a de sens que derrière un proxy inverse qui l'exige.
    apiKey: 'optional',
    contextTokens: 12_288,
    maxOutputTokens: 4_096,
    provider: 'ollama',
    privacy: {
      thirdParty: false,
      country: "Serveur choisi par l'administrateur",
      retention: "Aucune transmission à un service d'IA en ligne",
      training: 'Aucun entraînement par un tiers',
      url: 'https://docs.ollama.com/faq',
    },
    notes:
      "Gratuit, données chez vous : Ollama installé sur le serveur Magistra (ou sur une machine du réseau). "
      + "Utiliser l'API native (AI_PROVIDER=ollama, adresse SANS /v1) pour régler la taille de contexte. "
      + "Un site hébergé en ligne (Vercel) ne peut pas joindre une adresse locale ou privée.",
    hosts: [],
  },
];

/** Préréglage conseillé pour un site en ligne sans budget : gratuit, sans compte, hébergé en France. */
export const DEFAULT_WEB_PRESET: PresetId = 'ovhcloud';

const PRESET_ALIASES: Record<string, PresetId> = {
  ovh: 'ovhcloud',
  'ovh-cloud': 'ovhcloud',
  'mistral-ai': 'mistral',
  mistralai: 'mistral',
  'la-plateforme': 'mistral',
  etalab: 'albert',
};

/** Préréglage par identifiant (casse ignorée ; « ovh » = « ovhcloud »), ou undefined. */
export function getPreset(id: string | null | undefined): ProviderPreset | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  const resolved = PRESET_ALIASES[key] ?? key;
  return PROVIDER_PRESETS.find(p => p.id === resolved);
}

// ─── Nature de l'adresse ────────────────────────────────────────────────────

export type AddressKind = 'loopback' | 'private' | 'public';

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n <= 255) ? parts : null;
}

/**
 * Nature d'un nom d'hôte (sans crochets ni port) :
 *  - 'loopback' : cette machine (localhost, 127.0.0.0/8, ::1) ;
 *  - 'private'  : réseau local ou privé, injoignable depuis Internet (RFC 1918, 100.64.0.0/10, lien local,
 *                 fc00::/7, fe80::/10, noms en .local / .lan / .internal / .home.arpa, nom sans point
 *                 comme « ollama » dans Docker) ;
 *  - 'public'   : tout le reste.
 */
export function hostAddressKind(hostname: string): AddressKind {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0:0:0:0:0:0:0:1') return 'loopback';
  const v4 = ipv4Parts(host.startsWith('::ffff:') ? host.slice(7) : host);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    if (a === 169 && b === 254) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    if (a === 0) return 'private';
    return 'public';
  }
  if (host.includes(':')) {
    // IPv6 : unique local (fc00::/7) et lien local (fe80::/10).
    if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host)) return 'private';
    return 'public';
  }
  if (!host.includes('.')) return 'private';
  if (/\.(local|lan|internal|intranet|home\.arpa|home|corp)$/.test(host)) return 'private';
  return 'public';
}

/** Nature de l'adresse d'une URL (voir hostAddressKind), ou null si l'URL est illisible. */
export function addressKind(url: string): AddressKind | null {
  try {
    return hostAddressKind(new URL(url).hostname);
  } catch {
    return null;
  }
}

// ─── Prestataire déduit de l'adresse ────────────────────────────────────────

export interface AIEndpointInfo {
  /**
   * - 'preset'  : hôte d'un préréglage (OVHcloud, Mistral, Albert, Scaleway) ;
   * - 'known'   : autre prestataire en ligne identifié (Hugging Face, OpenRouter, Groq…) ;
   * - 'unknown' : hôte public non identifié (tiers dont Magistra ignore les conditions) ;
   * - 'private' : serveur du réseau local ou privé ;
   * - 'loopback': même machine que le serveur Magistra.
   */
  kind: 'preset' | 'known' | 'unknown' | 'private' | 'loopback';
  /** Nom lisible du prestataire (jamais l'URL complète). */
  label: string;
  presetId?: PresetId;
  privacy: ProviderPrivacy;
}

const TERMS_OF_PROVIDER = 'Selon les conditions du prestataire';

/** Prestataires en ligne connus sans préréglage (déconseillés pour des textes d'élèves : hors UE ou quotas minuscules). */
const KNOWN_HOSTS: { hosts: string[]; label: string; country: string; url?: string }[] = [
  { hosts: ['router.huggingface.co', 'api-inference.huggingface.co'], label: 'Hugging Face Inference Providers', country: 'Variable selon le fournisseur choisi', url: 'https://huggingface.co/docs/inference-providers/index' },
  { hosts: ['openrouter.ai'], label: 'OpenRouter', country: 'Variable selon le fournisseur (surtout aux États-Unis)', url: 'https://openrouter.ai/docs/api_reference/limits' },
  { hosts: ['api.groq.com'], label: 'Groq', country: 'États-Unis', url: 'https://console.groq.com/docs/rate-limits' },
  { hosts: ['api.cloudflare.com'], label: 'Cloudflare Workers AI', country: 'Réseau mondial de Cloudflare', url: 'https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility' },
  { hosts: ['api.openai.com'], label: 'OpenAI', country: 'États-Unis' },
  { hosts: ['generativelanguage.googleapis.com'], label: 'Google Gemini', country: 'États-Unis' },
  { hosts: ['ollama.com'], label: 'Ollama Cloud', country: 'Non précisé', url: 'https://docs.ollama.com/cloud' },
];

function hostMatches(host: string, patterns: readonly string[]): boolean {
  return patterns.some(p => (p.startsWith('.') ? host.endsWith(p) || host === p.slice(1) : host === p));
}

/**
 * Décrit le prestataire qui recevra les textes, d'après AI_BASE_URL (quand aucun préréglage n'est choisi) :
 * hôte d'un préréglage → ce prestataire ; hôte connu → son nom ; hôte public inconnu → « tiers non identifié »
 * (le nom d'hôte seul est cité, jamais le chemin ni la clé) ; boucle locale ou réseau privé → IA locale.
 */
export function describeAIEndpoint(baseUrl: string): AIEndpointInfo {
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    host = '';
  }
  const preset = host ? PROVIDER_PRESETS.find(p => hostMatches(host, p.hosts)) : undefined;
  if (preset) return { kind: 'preset', label: preset.label, presetId: preset.id, privacy: { ...preset.privacy } };

  const kind = host ? hostAddressKind(host) : 'public';
  if (kind === 'loopback') {
    return {
      kind: 'loopback',
      label: 'IA locale du serveur Magistra',
      privacy: {
        thirdParty: false,
        country: 'Même machine que le serveur Magistra',
        retention: "Aucune transmission à un service d'IA en ligne",
        training: 'Aucun entraînement par un tiers',
      },
    };
  }
  if (kind === 'private') {
    return {
      kind: 'private',
      label: "Serveur d'IA du réseau local",
      privacy: {
        thirdParty: false,
        country: 'Réseau local (établissement)',
        retention: "Selon la configuration du serveur d'IA de l'établissement",
        training: 'Aucun entraînement par un tiers',
      },
    };
  }
  const known = KNOWN_HOSTS.find(k => hostMatches(host, k.hosts));
  if (known) {
    return {
      kind: 'known',
      label: known.label,
      privacy: { thirdParty: true, country: known.country, retention: TERMS_OF_PROVIDER, training: TERMS_OF_PROVIDER, ...(known.url ? { url: known.url } : {}) },
    };
  }
  return {
    kind: 'unknown',
    label: host ? `Service d'IA en ligne non identifié (${host})` : "Service d'IA en ligne non identifié",
    privacy: { thirdParty: true, country: 'Inconnu', retention: TERMS_OF_PROVIDER, training: TERMS_OF_PROVIDER },
  };
}

/**
 * Informations de transparence transmises au navigateur (ServerStatus.ai.providerInfo, Capabilities.providerInfo).
 * `adminLabel` (AI_SERVER_LABEL) ne masque jamais un prestataire identifié : « Libellé (Prestataire) ».
 * Ne contient ni l'URL de base ni la clé.
 */
export function providerInfoFor(baseUrl: string, adminLabel?: string): ProviderInfo {
  const info = describeAIEndpoint(baseUrl);
  const custom = adminLabel?.trim();
  let label = info.label;
  if (custom) {
    // Prestataire identifié : son nom reste visible, sauf si le libellé de l'administrateur le cite déjà.
    const identified = info.kind === 'preset' || info.kind === 'known';
    const vendorWord = info.label.split(/\s/)[0].toLowerCase();
    label = identified && !custom.toLowerCase().includes(vendorWord) ? `${custom} (${info.label})` : custom;
  }
  return {
    label,
    thirdParty: info.privacy.thirdParty,
    country: info.privacy.country,
    retention: info.privacy.retention,
    training: info.privacy.training,
    ...(info.privacy.url ? { privacyUrl: info.privacy.url } : {}),
  };
}
