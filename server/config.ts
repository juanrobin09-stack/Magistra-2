// Configuration du serveur Magistra, lue depuis les variables d'environnement.
//
// Règles :
//  - aucune valeur secrète (clé Supabase service_role, clé Clerk, clé du serveur d'IA)
//    n'est jamais renvoyée au navigateur ni écrite dans les journaux ;
//  - une variable absente ou invalide ne fait jamais planter le serveur : elle est signalée
//    dans `problems` (journaux de l'administrateur) et la route concernée répond par une
//    erreur claire (AI_NOT_CONFIGURED, SERVER_MISCONFIGURED).

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig } from '../shared/ai/factory.js';
import { CUSTOM_OLLAMA_MODEL_CONTEXT, tierForModel } from '../shared/ai/models.js';
import { DEFAULT_OLLAMA_URL } from '../shared/ai/ollama.js';
import { isOllamaCloudName, ollamaDestination } from '../shared/ai/ollamaRemote.js';
import {
  addressKind, describeAIEndpoint, getPreset, PROVIDER_PRESETS, providerInfoFor, type PresetId, type ProviderPreset,
} from '../shared/ai/presets.js';
import { DEFAULT_RETRY_DELAYS_MS } from '../shared/pipeline.js';
import type { ResearchConfig } from '../shared/research/types.js';
import type { AINotice, ProviderInfo } from '../shared/types.js';
import { parseWebhookSecret } from './clerkWebhook.js';
import { REQUEST_LIMITS } from '../shared/validation.js';
import { normalizeTimeZone } from './time.js';

export type Env = Record<string, string | undefined>;

export interface ClerkConfig {
  secretKey?: string;
  jwtKey?: string;
  authorizedParties?: string[];
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export interface AIServerConfig {
  /** null = aucun serveur d'IA configuré : voir `unavailable` et `autodetect`. */
  provider: ProviderConfig | null;
  /**
   * Libellé affiché aux enseignants : AI_SERVER_LABEL, sinon le nom du préréglage ou du prestataire déduit de
   * l'adresse (« OVHcloud AI Endpoints », « IA locale du serveur Magistra »…), jamais l'adresse d'un serveur interne.
   */
  label: string;
  model?: string;
  contextTokens: number;
  maxOutputTokens: number;
  /** Durée maximale d'une génération complète (recherche + rédaction). */
  timeoutMs: number;
  /** Délai du test de disponibilité affiché par /api/status. */
  healthTimeoutMs: number;
  /** Attentes avant chaque nouvel essai automatique quand le serveur d'IA est surchargé ou indisponible (avant tout texte). */
  retryDelaysMs: readonly number[];
  /** Préréglage utilisé (AI_PRESET, ou valeur de préréglage donnée dans AI_PROVIDER). */
  preset?: PresetId;
  /**
   * Cause précise quand `provider` est null et qu'aucune détection automatique n'est prévue : code et message
   * montrés aux enseignants par /api/status (noms de variables seulement : ni adresse, ni clé).
   */
  unavailable?: AINotice;
  /**
   * Détection automatique d'une IA locale (Ollama, LM Studio) permise : AI_PRESET, AI_BASE_URL et AI_MODEL vides,
   * AI_AUTODETECT ≠ false, et hors Vercel.
   */
  autodetect: boolean;
  /**
   * Valeurs explicitement fixées par l'administrateur, reprises par la détection automatique (prioritaires sur le
   * contexte du niveau détecté). Côté serveur uniquement : jamais transmis au navigateur.
   */
  explicit: { contextTokens?: number; maxOutputTokens?: number; timeoutMs?: number; label?: string; apiKey?: string };
  /** Prestataire qui reçoit les textes (transparence : nom, pays, conservation, entraînement) ; sans URL ni clé. */
  providerInfo?: ProviderInfo;
}

export interface ServerConfig {
  production: boolean;
  ai: AIServerConfig;
  research: ResearchConfig;
  /** Requêtes de génération par minute et par utilisateur (0 = protection désactivée). */
  rateLimitPerMinute: number;
  /** Requêtes de génération par minute pour tout le déploiement, tous utilisateurs confondus (0 = désactivé). */
  rateLimitGlobalPerMinute: number;
  /** Générations en cours par utilisateur, toutes instances confondues (0 = pas de limite). */
  maxConcurrentGenerationsPerUser: number;
  /** Générations en cours sur cette instance du serveur, tous utilisateurs confondus (0 = pas de limite). */
  maxConcurrentGenerations: number;
  clerk: ClerkConfig | null;
  /** Clé de vérification des webhooks Clerk (CLERK_WEBHOOK_SECRET) ; null = route /api/clerk-webhook désactivée. */
  clerkWebhookKey: Uint8Array | null;
  /**
   * Clé PUBLIABLE Clerk (pk_test_… / pk_live_…) lue côté serveur (VITE_CLERK_PUBLISHABLE_KEY ou
   * CLERK_PUBLISHABLE_KEY) et renvoyée par GET /api/mode. Publique par nature ; toute autre valeur est ignorée.
   */
  clerkPublishableKey?: string;
  /** Contact de l'administrateur affiché aux enseignants (MAGISTRA_ADMIN_CONTACT), facultatif. */
  adminContact?: string;
  /** Stockage : MAGISTRA_STORE, sinon Supabase (fichiers en mode personnel : voir storeExplicit). */
  store: 'supabase' | 'memory' | 'file';
  /** Vrai si MAGISTRA_STORE est renseigné ; sinon le mode personnel choisit « file ». */
  storeExplicit: boolean;
  /** Dossier des données du serveur (stockage « file », jeton du mode personnel) : MAGISTRA_DATA_DIR. */
  dataDir: string;
  supabase: SupabaseConfig | null;
  defaultTimeZone: string;
  /** Taille maximale des extraits de documents que le navigateur peut envoyer (caractères). */
  maxDocumentChars: number;
  /** Problèmes de configuration, destinés aux journaux de l'administrateur uniquement. */
  problems: string[];
}

export const DEFAULTS = {
  aiLabel: "Serveur d'IA",
  contextTokens: 32_768,
  /**
   * Contexte d'un modèle Ollama hors catalogue Magistra (API native : num_ctx réellement réservé en mémoire) :
   * valeur du préréglage « ollama » et des niveaux Magistra, supportable sans carte graphique.
   */
  ollamaContextTokens: CUSTOM_OLLAMA_MODEL_CONTEXT,
  maxOutputTokens: 6_000,
  aiTimeoutSeconds: 280,
  /**
   * Durée maximale d'une génération avec une IA de cet ordinateur ou du réseau local, hors Vercel (30 min) :
   * sans carte graphique, un modèle local peut rédiger lentement.
   */
  localAiTimeoutSeconds: 1_800,
  healthTimeoutMs: 10_000,
  researchTimeoutMs: 8_000,
  rateLimitPerMinute: 10,
  rateLimitGlobalPerMinute: 120,
  maxConcurrentGenerationsPerUser: 2,
  maxConcurrentGenerations: 8,
  timeZone: 'Europe/Paris',
} as const;

/**
 * Marge ajoutée à la durée maximale d'une génération (AI_TIMEOUT_SECONDS) avant qu'une génération
 * jamais signalée comme terminée (instance arrêtée brutalement…) cesse de compter dans les limites
 * de concurrence : arrêt du modèle et sauvegarde dans l'historique (60 s au plus).
 */
export const GENERATION_SLOT_MARGIN_SECONDS = 90;

/** Durée (secondes) au-delà de laquelle une génération non libérée ne compte plus comme « en cours ». */
export function generationSlotTtlSeconds(config: { ai: Pick<AIServerConfig, 'timeoutMs'> }): number {
  return Math.ceil(config.ai.timeoutMs / 1_000) + GENERATION_SLOT_MARGIN_SECONDS;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function intVar(env: Env, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = clean(env[name]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} doit être un nombre entier entre ${min} et ${max} : valeur par défaut (${fallback}) utilisée.`);
    return fallback;
  }
  return n;
}

function boolVar(env: Env, name: string, fallback: boolean, problems: string[]): boolean {
  const raw = clean(env[name])?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'oui', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'non', 'off'].includes(raw)) return false;
  problems.push(`${name} doit valoir « true » ou « false » : valeur par défaut (${fallback}) utilisée.`);
  return fallback;
}

function httpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return raw.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Taille des extraits de documents acceptée, déduite de la fenêtre de contexte du modèle. */
export function maxDocumentCharsFor(contextTokens: number): number {
  const chars = Math.floor((contextTokens * 0.55 - 3_000) * 3.2);
  return Math.max(2_000, Math.min(REQUEST_LIMITS.documentsChars, chars));
}

/** Valeurs d'AI_PROVIDER comprises comme « openai-compatible » (serveurs qui exposent l'API compatible OpenAI). */
const OPENAI_COMPATIBLE_ALIASES: ReadonlySet<string> = new Set([
  'openai', 'openai_compatible', 'openaicompatible', 'vllm', 'lmstudio', 'lm-studio', 'lm_studio', 'llamacpp', 'llama.cpp',
  'llama-cpp', 'llama_cpp', 'llama-server', 'localai', 'local-ai', 'litellm', 'tgi', 'sglang',
]);

/** https:// uniquement (lien public de confidentialité affiché à l'enseignant). */
function httpsUrl(raw: string | undefined): string | undefined {
  const url = httpUrl(raw);
  return url && url.startsWith('https://') ? url : undefined;
}

type AIKind = 'openai-compatible' | 'ollama';

/**
 * Serveur d'IA, par ordre de priorité :
 *  1. valeurs explicites : AI_BASE_URL, AI_MODEL, AI_API_KEY, AI_SERVER_LABEL, AI_CONTEXT_TOKENS, AI_MAX_OUTPUT_TOKENS ;
 *  2. préréglage AI_PRESET (ovhcloud, mistral, albert, scaleway, ollama : voir shared/ai/presets.ts) ;
 *  3. si rien n'est renseigné (et hors Vercel) : détection automatique d'une IA locale (voir localAI.ts).
 * Toute configuration incomplète ou impossible donne `provider: null` avec une cause précise (`unavailable`),
 * et une ligne dans `problems` (journal de l'administrateur).
 */
function loadAI(env: Env, problems: string[], timeZone: string): AIServerConfig {
  const vercel = env.VERCEL === '1';
  const adminLabel = clean(env.AI_SERVER_LABEL)?.slice(0, 80);
  const apiKey = clean(env.AI_API_KEY);
  const explicitModel = clean(env.AI_MODEL)?.slice(0, 200);
  const rawBase = clean(env.AI_BASE_URL);
  const presetRaw = clean(env.AI_PRESET);

  // ─── Préréglage ───
  let preset: ProviderPreset | undefined = getPreset(presetRaw);
  const presetUnknown = Boolean(presetRaw && !preset);
  if (presetUnknown) {
    problems.push(`AI_PRESET inconnu (« ${presetRaw!.slice(0, 40)} ») : valeurs possibles ${PROVIDER_PRESETS.map(p => `« ${p.id} »`).join(', ')}.`);
  }

  // ─── Type de serveur (AI_PROVIDER) ───
  const kindRaw = clean(env.AI_PROVIDER)?.toLowerCase();
  let kind: AIKind | null;
  if (!kindRaw) {
    kind = preset?.provider ?? 'openai-compatible';
  } else if (kindRaw === 'ollama' || kindRaw === 'openai-compatible') {
    kind = kindRaw;
  } else if (OPENAI_COMPATIBLE_ALIASES.has(kindRaw)) {
    // Valeur naturelle (lmstudio, vllm, openai…) acceptée, mais signalée : la valeur attendue est « openai-compatible ».
    kind = 'openai-compatible';
    problems.push(`AI_PROVIDER « ${kindRaw.slice(0, 40)} » compris comme « openai-compatible » (API compatible OpenAI : adresse terminée par /v1).`);
  } else if (getPreset(kindRaw)) {
    // « AI_PROVIDER=mistral » : l'administrateur pensait à un préréglage.
    const hinted = getPreset(kindRaw)!;
    kind = hinted.provider;
    if (!preset && !presetRaw) {
      preset = hinted;
      problems.push(`AI_PROVIDER « ${kindRaw} » compris comme le préréglage AI_PRESET=${hinted.id} (${hinted.label}) : écrivez plutôt AI_PRESET=${hinted.id}.`);
    } else {
      problems.push(`AI_PROVIDER « ${kindRaw} » compris comme « ${hinted.provider} ».`);
    }
  } else {
    kind = null;
    problems.push(`AI_PROVIDER inconnu (« ${kindRaw.slice(0, 40)} ») : valeurs possibles « openai-compatible » ou « ollama » (ou AI_PRESET pour un préréglage).`);
  }

  // ─── Modèle et adresse ───
  const model = explicitModel ?? preset?.model;
  const parsedBase = httpUrl(rawBase);
  if (rawBase && !parsedBase) problems.push('AI_BASE_URL doit être une adresse http(s) valide, sans identifiants.');
  let baseUrl = parsedBase ?? (rawBase ? undefined : preset?.baseUrl);
  if (kind === 'ollama' && !rawBase && !baseUrl) baseUrl = DEFAULT_OLLAMA_URL;
  if (kind === 'ollama' && baseUrl && /\/v1$/i.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/v1$/i, '');
    problems.push("AI_PROVIDER=ollama utilise l'API native d'Ollama : « /v1 » a été retiré de la fin d'AI_BASE_URL.");
  }
  const autodetect = !preset && !presetRaw && !rawBase && !explicitModel && !vercel && kind !== null
    && boolVar(env, 'AI_AUTODETECT', true, problems);

  // ─── Réglages numériques (explicites > niveau Magistra pour Ollama > préréglage > défauts) ───
  const tier = model ? tierForModel(model) : undefined;
  const contextDefault = kind === 'ollama'
    ? tier?.contextTokens ?? (preset?.provider === 'ollama' ? preset.contextTokens : DEFAULTS.ollamaContextTokens)
    : preset?.contextTokens ?? DEFAULTS.contextTokens;
  const contextTokens = intVar(env, 'AI_CONTEXT_TOKENS', contextDefault, 2_048, 2_000_000, problems);
  const maxOutputTokens = intVar(env, 'AI_MAX_OUTPUT_TOKENS', preset?.maxOutputTokens ?? DEFAULTS.maxOutputTokens, 256, 200_000, problems);
  const kindOfAddress = baseUrl ? addressKind(baseUrl) : null;
  // IA de cette machine ou du réseau local (hors Vercel) : durée plus longue. Pour une IA détectée
  // automatiquement, la durée est choisie au moment de la détection (voir deps.ts).
  const localAI = kindOfAddress === 'loopback' || kindOfAddress === 'private';
  const timeoutDefault = !vercel && localAI ? DEFAULTS.localAiTimeoutSeconds : DEFAULTS.aiTimeoutSeconds;
  const timeoutMs = intVar(env, 'AI_TIMEOUT_SECONDS', timeoutDefault, 10, 3_600, problems) * 1_000;
  const healthTimeoutMs = intVar(env, 'AI_HEALTH_TIMEOUT_MS', DEFAULTS.healthTimeoutMs, 500, 30_000, problems);

  // ─── Libellé et transparence (jamais l'adresse d'un serveur interne) ───
  const endpoint = baseUrl ? describeAIEndpoint(baseUrl) : undefined;
  // Modèle « cloud » d'Ollama (« gpt-oss:120b-cloud », « kimi-k2.6:cloud ») : même derrière un Ollama local, les
  // textes partent chez Ollama Cloud. Décidé par le NOM, sans contacter le nuage (voir shared/ai/ollamaRemote.ts).
  const cloudModel = kind === 'ollama' && isOllamaCloudName(model);
  const cloudInfo = cloudModel ? ollamaDestination(model, undefined, adminLabel) : undefined;
  if (cloudModel) {
    problems.push(`AI_MODEL « ${model!.slice(0, 80)} » est un modèle en ligne (Ollama Cloud) : Ollama transmet les demandes et extraits de `
      + "documents des enseignants à Ollama Cloud, et l'interface l'annonce. Pour une IA locale, choisissez un modèle installé (par exemple ministral-3:8b).");
  }
  const label = adminLabel
    ?? cloudInfo?.label
    ?? (preset && endpoint?.presetId === preset.id ? preset.label : endpoint?.label)
    ?? DEFAULTS.aiLabel;
  const privacyRaw = clean(env.AI_PROVIDER_PRIVACY_URL);
  const privacyUrl = httpsUrl(privacyRaw);
  if (privacyRaw && !privacyUrl) problems.push('AI_PROVIDER_PRIVACY_URL doit être une adresse https valide : ignorée.');
  const providerInfo: ProviderInfo | undefined = baseUrl
    ? { ...(cloudInfo ?? providerInfoFor(baseUrl, adminLabel)), ...(privacyUrl ? { privacyUrl } : {}) }
    : undefined;

  const explicit = {
    ...(clean(env.AI_CONTEXT_TOKENS) !== undefined ? { contextTokens } : {}),
    ...(clean(env.AI_MAX_OUTPUT_TOKENS) !== undefined ? { maxOutputTokens } : {}),
    ...(clean(env.AI_TIMEOUT_SECONDS) !== undefined ? { timeoutMs } : {}),
    ...(adminLabel ? { label: adminLabel } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
  const base = {
    label, contextTokens, maxOutputTokens, timeoutMs, healthTimeoutMs, retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
    autodetect: false, explicit,
    ...(preset ? { preset: preset.id } : {}),
    ...(providerInfo ? { providerInfo } : {}),
  };
  const unavailable = (code: 'AI_NOT_CONFIGURED' | 'AI_SERVER_UNREACHABLE', message: string): AIServerConfig => ({
    ...base, ...(model ? { model } : {}), provider: null, unavailable: { code, message },
  });

  if (kind === null) {
    return unavailable('AI_NOT_CONFIGURED', "L'administrateur doit corriger AI_PROVIDER (valeurs possibles : openai-compatible ou ollama).");
  }
  if (presetUnknown && !(explicitModel && (parsedBase || kind === 'ollama'))) {
    return unavailable('AI_NOT_CONFIGURED', `AI_PRESET n'est pas reconnu. L'administrateur doit choisir l'un des préréglages : ${PROVIDER_PRESETS.map(p => p.id).join(', ')}.`);
  }
  if (!model && !rawBase) {
    if (autodetect) {
      if (apiKey) {
        problems.push("AI_API_KEY est renseignée, mais aucun service d'IA n'est choisi (AI_PRESET, ou AI_BASE_URL et AI_MODEL) : la clé n'est "
          + "pas utilisée, et l'IA locale détectée (Ollama, LM Studio) ne la reçoit pas. Pour un service en ligne, renseignez AI_PRESET "
          + "(par exemple « mistral ») ; pour un Ollama derrière un proxy à clé, renseignez AI_PROVIDER=ollama et AI_MODEL.");
      }
      return { ...base, provider: null, autodetect: true };
    }
    problems.push("AI_BASE_URL et AI_MODEL manquants (ou AI_PRESET) : aucun serveur d'IA n'est configuré. Solution gratuite la plus simple : AI_PRESET=ovhcloud.");
    return unavailable('AI_NOT_CONFIGURED',
      "Aucune IA n'est branchée sur ce site. L'administrateur doit choisir un service d'IA (AI_PRESET, par exemple « ovhcloud », gratuit) ou renseigner AI_BASE_URL et AI_MODEL.");
  }
  if (rawBase && !parsedBase) {
    return unavailable('AI_NOT_CONFIGURED', "L'adresse du serveur d'IA (AI_BASE_URL) n'est pas une adresse http(s) valide : l'administrateur doit la corriger.");
  }
  if (!model) {
    problems.push("AI_MODEL manquant : aucun serveur d'IA n'est configuré.");
    return unavailable('AI_NOT_CONFIGURED', "L'administrateur doit renseigner AI_MODEL (nom exact du modèle servi par le serveur d'IA).");
  }
  if (!baseUrl) {
    problems.push("AI_BASE_URL manquant : aucun serveur d'IA n'est configuré.");
    return unavailable('AI_NOT_CONFIGURED', "L'administrateur doit renseigner AI_BASE_URL (adresse du serveur d'IA, /v1 inclus).");
  }
  if (vercel && (kindOfAddress === 'loopback' || kindOfAddress === 'private')) {
    problems.push(`AI_BASE_URL désigne ${kindOfAddress === 'loopback' ? 'cette machine (boucle locale)' : 'une adresse privée ou du réseau local'}, `
      + "injoignable depuis Vercel : choisissez un service d'IA joignable depuis Internet (par exemple AI_PRESET=ovhcloud) ou le serveur autonome.");
    return unavailable('AI_SERVER_UNREACHABLE',
      "Le serveur d'IA configuré a une adresse locale ou privée, injoignable depuis ce site en ligne. L'administrateur doit choisir un service "
      + "d'IA joignable depuis Internet (par exemple AI_PRESET=ovhcloud) ou installer Magistra sur un serveur de l'établissement.");
  }
  const vendor = endpoint?.presetId ? getPreset(endpoint.presetId) : undefined;
  if (vendor?.apiKey === 'required' && !apiKey) {
    problems.push(`AI_API_KEY manquante : ${vendor.label} exige une clé d'accès.`);
    return unavailable('AI_NOT_CONFIGURED', `Le service d'IA « ${vendor.label} » exige une clé d'accès : l'administrateur doit renseigner AI_API_KEY.`);
  }
  if (vendor?.apiKey === 'optional' && !apiKey && vendor.privacy.thirdParty) {
    problems.push(`${vendor.label} sans AI_API_KEY : accès anonyme gratuit, au débit très limité (2 requêtes par minute et par adresse IP pour OVHcloud)`
      + `${vercel ? ", adresse IP de sortie de Vercel possiblement partagée" : ''} : créez une clé dès que plusieurs enseignants utilisent le site.`);
  }
  if (endpoint?.kind === 'unknown' && !adminLabel) {
    problems.push(`AI_SERVER_LABEL vide : le prestataire d'IA est présenté aux enseignants comme « ${label} ». Renseignez AI_SERVER_LABEL pour le nommer.`);
  }
  if (kind === 'openai-compatible' && (kindOfAddress === 'loopback' || kindOfAddress === 'private') && /:11434(\/|$)/.test(baseUrl)) {
    problems.push("AI_BASE_URL semble désigner Ollama par son API compatible OpenAI : la taille de contexte n'y est pas transmise (documents tronqués). "
      + "Préférez AI_PROVIDER=ollama avec l'adresse sans /v1, ou réglez OLLAMA_CONTEXT_LENGTH sur le serveur Ollama.");
  }

  const provider: ProviderConfig = kind === 'ollama'
    ? {
        kind: 'ollama', baseUrl, model, label, ...(apiKey ? { apiKey } : {}), contextTokens, recipient: 'administrateur', timeZone,
      }
    : {
        kind: 'openai-compatible', baseUrl, model, apiKey, label, contextTokens, local: false, recipient: 'administrateur', timeZone,
      };
  return { ...base, model, provider };
}

function loadResearch(env: Env, problems: string[]): ResearchConfig {
  const rawSearx = clean(env.SEARXNG_URL);
  const searxngUrl = httpUrl(rawSearx);
  if (rawSearx && !searxngUrl) problems.push('SEARXNG_URL doit être une adresse http(s) valide : recherche web désactivée.');
  const mailto = clean(env.CROSSREF_MAILTO);
  const validMailto = mailto && /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,}$/i.test(mailto) ? mailto : undefined;
  if (mailto && !validMailto) problems.push('CROSSREF_MAILTO doit être une adresse électronique valide : ignorée.');
  return {
    academic: boolVar(env, 'RESEARCH_ACADEMIC', true, problems),
    wikipedia: boolVar(env, 'RESEARCH_WIKIPEDIA', true, problems),
    searxngUrl,
    crossrefMailto: validMailto,
    timeoutMs: intVar(env, 'RESEARCH_TIMEOUT_MS', DEFAULTS.researchTimeoutMs, 1_000, 60_000, problems),
  };
}

function loadClerk(env: Env, problems: string[]): ClerkConfig | null {
  const secretKey = clean(env.CLERK_SECRET_KEY);
  // Clé PEM : les hébergeurs stockent souvent les retours à la ligne sous la forme « \n ».
  const jwtKey = clean(env.CLERK_JWT_KEY)?.replace(/\\n/g, '\n');
  if (!secretKey && !jwtKey) {
    problems.push('CLERK_SECRET_KEY (ou CLERK_JWT_KEY) manquante : impossible de vérifier les sessions.');
    return null;
  }
  const parties = clean(env.CLERK_AUTHORIZED_PARTIES)
    ?.split(/[\s,]+/)
    .map(p => p.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return { secretKey, jwtKey, authorizedParties: parties && parties.length ? parties : undefined };
}

function loadClerkWebhook(env: Env, clerk: ClerkConfig | null, problems: string[]): Uint8Array | null {
  const raw = clean(env.CLERK_WEBHOOK_SECRET);
  if (!raw) {
    if (clerk) problems.push('CLERK_WEBHOOK_SECRET manquant : les données d’un compte supprimé depuis Clerk ne sont pas effacées automatiquement (voir README).');
    return null;
  }
  const key = parseWebhookSecret(raw);
  if (!key) problems.push('CLERK_WEBHOOK_SECRET invalide (format attendu : whsec_…) : webhook Clerk désactivé.');
  return key;
}

function loadSupabase(env: Env, problems: string[]): SupabaseConfig | null {
  const url = httpUrl(clean(env.SUPABASE_URL));
  const serviceRoleKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    problems.push('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires pour enregistrer l’historique.');
    return null;
  }
  return { url, serviceRoleKey };
}

/** Dossier racine du projet (voisin de server/ et de dist-server/). */
export function defaultProjectRoot(): string {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return process.cwd();
  }
}

/** Dossier de données par défaut : <racine du projet>/.magistra-data (ignoré par git). */
export const DEFAULT_DATA_DIR_NAME = '.magistra-data';

/**
 * Dossier de données quand MAGISTRA_DATA_DIR est vide :
 *  - Linux, macOS : <racine du projet>/.magistra-data (fichiers en 0600, dossier en 0700) ;
 *  - Windows : %LOCALAPPDATA%\Magistra\serveur, protégé par le profil de l'utilisateur. Les droits POSIX y sont sans
 *    effet : un projet placé hors du profil (C:\Magistra) aurait laissé le jeton et l'historique lisibles par les
 *    autres comptes. Un ancien dossier <racine du projet>\.magistra-data est conservé (historique et jeton existants),
 *    et son ACL est restreinte au démarrage (voir restrictDataDirAcl dans personal.ts).
 * Distinct de %APPDATA%\Magistra (données de l'application Windows).
 */
export function defaultDataDir(env: Env, options: LoadConfigOptions = {}): string {
  const root = options.projectRoot ?? defaultProjectRoot();
  if ((options.platform ?? process.platform) !== 'win32') return path.join(root, DEFAULT_DATA_DIR_NAME);
  const win = path.win32;
  const legacy = win.join(root, DEFAULT_DATA_DIR_NAME);
  if ((options.exists ?? existsSync)(legacy)) return legacy;
  const localAppData = clean(env.LOCALAPPDATA) ?? win.join(options.homedir ?? os.homedir(), 'AppData', 'Local');
  return win.join(localAppData, 'Magistra', 'serveur');
}

function loadStore(env: Env, problems: string[]): { store: ServerConfig['store']; storeExplicit: boolean } {
  const raw = clean(env.MAGISTRA_STORE)?.toLowerCase();
  if (!raw) return { store: 'supabase', storeExplicit: false };
  if (raw === 'file' && env.VERCEL === '1') {
    problems.push('MAGISTRA_STORE=file est impossible sur Vercel (disque éphémère) : Supabase est utilisé.');
    return { store: 'supabase', storeExplicit: true };
  }
  if (raw === 'memory' || raw === 'supabase' || raw === 'file') return { store: raw, storeExplicit: true };
  problems.push('MAGISTRA_STORE doit valoir « supabase », « file » ou « memory ».');
  return { store: 'supabase', storeExplicit: false };
}

/** Texte court et sans caractère de contrôle (contact affiché aux enseignants). */
function shortText(raw: string | undefined, max: number): string | undefined {
  const text = raw ? [...raw].filter(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').trim() : '';
  return text ? text.slice(0, max) : undefined;
}

export interface LoadConfigOptions {
  /** Racine du projet (dossier de données par défaut) ; défaut : dossier parent de server/ ou de dist-server/. */
  projectRoot?: string;
  /** Système (tests) : défaut process.platform. */
  platform?: NodeJS.Platform;
  /** Présence d'un dossier (tests) : défaut existsSync. */
  exists?: (dir: string) => boolean;
  /** Dossier personnel (tests, Windows sans LOCALAPPDATA) : défaut os.homedir(). */
  homedir?: string;
}

export function loadConfig(env: Env, options: LoadConfigOptions = {}): ServerConfig {
  const problems: string[] = [];
  const tzRaw = clean(env.DEFAULT_TIMEZONE);
  const defaultTimeZone = (tzRaw && normalizeTimeZone(tzRaw)) || DEFAULTS.timeZone;
  if (tzRaw && !normalizeTimeZone(tzRaw)) problems.push('DEFAULT_TIMEZONE inconnu : Europe/Paris utilisé.');
  const ai = loadAI(env, problems, defaultTimeZone);
  const research = loadResearch(env, problems);
  const clerk = loadClerk(env, problems);
  const clerkWebhookKey = loadClerkWebhook(env, clerk, problems);
  const { store, storeExplicit } = loadStore(env, problems);
  const supabase = store === 'supabase' ? loadSupabase(env, problems) : null;
  const pk = clean(env.VITE_CLERK_PUBLISHABLE_KEY) ?? clean(env.CLERK_PUBLISHABLE_KEY);
  const clerkPublishableKey = pk && /^pk_(test|live)_[A-Za-z0-9+/=_.$-]{8,512}$/.test(pk) ? pk : undefined;
  // La valeur n'est jamais recopiée : une clé secrète collée ici par erreur ne doit pas finir dans un journal.
  if (pk && !clerkPublishableKey) problems.push('VITE_CLERK_PUBLISHABLE_KEY invalide (format attendu : pk_test_… ou pk_live_…) : ignorée.');
  const dataDirRaw = clean(env.MAGISTRA_DATA_DIR);
  const dataDir = dataDirRaw ? path.resolve(dataDirRaw) : defaultDataDir(env, options);
  const adminContact = shortText(env.MAGISTRA_ADMIN_CONTACT, 200);

  return {
    production: env.NODE_ENV === 'production' || env.VERCEL === '1',
    ai,
    research,
    rateLimitPerMinute: intVar(env, 'RATE_LIMIT_PER_MINUTE', DEFAULTS.rateLimitPerMinute, 0, 10_000, problems),
    rateLimitGlobalPerMinute: intVar(env, 'RATE_LIMIT_GLOBAL_PER_MINUTE', DEFAULTS.rateLimitGlobalPerMinute, 0, 1_000_000, problems),
    maxConcurrentGenerationsPerUser: intVar(env, 'MAX_CONCURRENT_GENERATIONS_PER_USER', DEFAULTS.maxConcurrentGenerationsPerUser, 0, 100, problems),
    maxConcurrentGenerations: intVar(env, 'MAX_CONCURRENT_GENERATIONS', DEFAULTS.maxConcurrentGenerations, 0, 1_000, problems),
    clerk,
    clerkWebhookKey,
    ...(clerkPublishableKey ? { clerkPublishableKey } : {}),
    ...(adminContact ? { adminContact } : {}),
    store,
    storeExplicit,
    dataDir,
    supabase,
    defaultTimeZone,
    maxDocumentChars: maxDocumentCharsFor(ai.contextTokens),
    problems,
  };
}
